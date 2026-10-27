import { exchange, finishAuth, startAuth, ticket } from './auth'
import { checkUser } from './check'
import type { Env } from './env'
import { fanOut, fromSelf } from './fanout'
import { caller } from './firebase'
import { HttpError, json, problem, readBody } from './http'
import { Net, type FetchFn } from './net'
import { disconnect, forget, listAccounts, registerPush, setupAi, sync, token, unregisterPush, watch } from './routes'
import type { Ctx } from './session'
import { D1Store, type Store } from './store'

/**
 * The Worker's requests and its cron, with the outside world passed in so the
 * tests can stand in for Google, Firestore and the database.
 */

/** How long a scheduled check waits for the model before leaving the rest for the next run. */
export const CRON_AI_MS = 4.5 * 60_000

export interface Deps {
  fetch: FetchFn
  store?: Store
  now?: () => number
}

// Bearer tokens, not cookies, so any origin may ask; nothing is sent on its own.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
}

function context(env: Env, deps: Deps): Ctx {
  return { env, store: deps.store ?? new D1Store(env.DB), net: new Net(deps.fetch), now: (deps.now ?? Date.now)() }
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const url = new URL(request.url)
  const ctx = context(env, deps)
  const route = `${request.method} ${url.pathname}`
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    // The browser's half of signing in.
    if (route === 'GET /auth/start') return await startAuth(ctx, url)
    if (route === 'GET /auth/callback') return await finishAuth(ctx, url)
    if (route === 'GET /') return json({ name: 'Cairn', ok: true })

    // The Worker calling itself, for the cron's fan-out.
    if (route === 'POST /internal/run' || route === 'POST /internal/fan') {
      if (!(await fromSelf(request, env))) throw new HttpError(403, 'forbidden', 'Not for you.')
      if (route === 'POST /internal/fan') {
        const { uids } = await readBody<{ uids?: string[] }>(request)
        await fanOut(env, Array.isArray(uids) ? uids.filter((u) => typeof u === 'string') : [], ctx.net.fetch)
        return json({ ok: true })
      }
      const { uid } = await readBody<{ uid?: string }>(request)
      if (typeof uid !== 'string') throw new HttpError(400, 'bad_request', 'Whose check?')
      const result = await checkUser(ctx, uid, { aiUntil: Date.now() + CRON_AI_MS })
      return json(result)
    }

    const response = await device(route, request, url, ctx)
    for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value)
    return response
  } catch (error) {
    const response = error instanceof HttpError ? problem(error) : json({ error: 'internal', message: 'Something went wrong on Cairn’s server.' }, 500)
    if (!(error instanceof HttpError)) console.error(route, error)
    for (const [key, value] of Object.entries(CORS)) response.headers.set(key, value)
    return response
  }
}

/** The apps' requests. All but the code exchange need a signed-in caller. */
async function device(route: string, request: Request, url: URL, ctx: Ctx): Promise<Response> {
  if (route === 'POST /auth/exchange') return exchange(ctx, request)
  const known = [
    'POST /auth/ticket',
    'GET /token',
    'POST /sync',
    'POST /setup/ai',
    'GET /accounts',
    'POST /accounts',
    'DELETE /accounts',
    'DELETE /me',
    'POST /push/register',
    'DELETE /push/register',
  ]
  if (!known.includes(route)) throw new HttpError(404, 'not_found', 'Nothing here.')
  const { uid } = await caller(request, ctx.env, ctx.net.fetch, ctx.now)
  switch (route) {
    case 'POST /auth/ticket':
      return ticket(ctx, uid)
    case 'GET /token':
      return token(ctx, uid, url)
    case 'POST /sync':
      return sync(ctx, uid)
    case 'POST /setup/ai':
      return setupAi(ctx, uid, request)
    case 'GET /accounts':
      return listAccounts(ctx, uid)
    case 'POST /accounts':
      return watch(ctx, uid, request)
    case 'DELETE /accounts':
      return disconnect(ctx, uid, url)
    case 'DELETE /me':
      return forget(ctx, uid)
    case 'POST /push/register':
      return registerPush(ctx, uid, request)
    default:
      return unregisterPush(ctx, uid, request)
  }
}

/** Every ten minutes: everyone with an account, checked. */
export async function cron(env: Env, deps: Deps): Promise<void> {
  const store = deps.store ?? new D1Store(env.DB)
  await fanOut(env, await store.userIds(), deps.fetch)
}
