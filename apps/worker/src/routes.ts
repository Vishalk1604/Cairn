import { storedAiSetup } from '@cairn/sync/ai'
import type { TokenPurpose, WorkerAccount } from '@cairn/sync/worker'
import { accountsDoc, aiContext, aiSetupOf, publishAccounts } from './accounts'
import { checkUser } from './check'
import { open, seal } from './crypto'
import { purposeScopes, revoke } from './google'
import { HttpError, json, readBody } from './http'
import { accessToken, refreshContext, type Ctx } from './session'
import { zoneName } from './zone'

/**
 * What the apps ask of the Worker once signed in. Every caller is a Firebase
 * user (checked in index.ts), and everything here is theirs alone: an
 * account address is only ever looked up under their own uid.
 */

/** A Sync waits this long for the model before answering; the rest is sorted on the next run. */
const SYNC_AI_MS = 20_000
const NVIDIA_KEY = /^nvapi-[A-Za-z0-9_-]{20,200}$/

/** A short-lived token for one of the caller's own accounts, narrowed to what it is for. */
export async function token(ctx: Ctx, uid: string, url: URL): Promise<Response> {
  const email = url.searchParams.get('account') ?? ''
  const purpose = url.searchParams.get('purpose') as TokenPurpose
  if (purpose !== 'drive' && purpose !== 'classroomFiles') throw new HttpError(400, 'bad_request', 'Ask for a token for drive or classroomFiles.')
  const account = await ctx.store.account(uid, email)
  if (!account) throw new HttpError(404, 'unknown_account', `${email || 'That account'} is not connected to Cairn.`)
  const scopes = purposeScopes(purpose, account.scopes)
  if (!scopes) {
    throw new HttpError(
      403,
      'consent',
      purpose === 'drive' ? `Cairn was not allowed into ${email}'s Drive.` : `Google has not let Cairn read the files your classes share with ${email}.`,
    )
  }
  const issued = await accessToken(ctx, account, purpose, scopes)
  return json({ accessToken: issued.accessToken, expiresAt: issued.expiresAt })
}

export async function sync(ctx: Ctx, uid: string): Promise<Response> {
  const result = await checkUser(ctx, uid, { aiUntil: Date.now() + SYNC_AI_MS })
  return json({ checkedAt: result.checkedAt, found: result.found, ...(result.busy ? { busy: true } : {}), ...(result.errors.length ? { errors: result.errors } : {}) })
}

export async function setupAi(ctx: Ctx, uid: string, request: Request): Promise<Response> {
  const body = await readBody<{ setup?: unknown }>(request)
  if (body.setup === null) {
    await ctx.store.setAi(uid, null)
  } else {
    const setup = storedAiSetup(JSON.stringify(body.setup ?? null))
    if (!setup || !NVIDIA_KEY.test(setup.key)) throw new HttpError(400, 'bad_key', 'That is not an NVIDIA key. They start with nvapi-.')
    await ctx.store.setAi(uid, await seal(ctx.env, JSON.stringify(setup), aiContext(uid)))
  }
  const doc = await publishAccounts(ctx, uid).catch(async () => accountsDoc(await ctx.store.accounts(uid), await aiSetupOf(ctx.env, await ctx.store.user(uid)), ctx.now))
  return json(doc.ai ?? { on: false })
}

export async function listAccounts(ctx: Ctx, uid: string): Promise<Response> {
  const [rows, user] = await Promise.all([ctx.store.accounts(uid), ctx.store.user(uid)])
  return json(accountsDoc(rows, await aiSetupOf(ctx.env, user), ctx.now))
}

/** What to read from one account. */
export async function watch(ctx: Ctx, uid: string, request: Request): Promise<Response> {
  const body = await readBody<{ account?: string; watch?: Partial<WorkerAccount['watch']> }>(request)
  const account = await ctx.store.account(uid, body.account ?? '')
  if (!account) throw new HttpError(404, 'unknown_account', 'That account is not connected to Cairn.')
  await ctx.store.putAccount({
    ...account,
    watchMail: typeof body.watch?.mail === 'boolean' ? body.watch.mail : account.watchMail,
    watchClassroom: typeof body.watch?.classroom === 'boolean' ? body.watch.classroom : account.watchClassroom,
  })
  return json(await publishAccounts(ctx, uid))
}

/** Forgets a source account and gives its permission back to Google. The owner goes only with everything else. */
export async function disconnect(ctx: Ctx, uid: string, url: URL): Promise<Response> {
  const email = url.searchParams.get('account') ?? ''
  const account = await ctx.store.account(uid, email)
  if (!account) throw new HttpError(404, 'unknown_account', 'That account is not connected to Cairn.')
  if (account.role === 'owner') throw new HttpError(400, 'owner', 'That account holds your notes. Use “Stop and forget everything” to disconnect it.')
  await revoke(await open(ctx.env, account.refresh, refreshContext(uid, email)), ctx.net.fetch)
  await ctx.store.deleteAccount(uid, email)
  return json(await publishAccounts(ctx, uid))
}

/** Stops every check for the caller, gives every permission back to Google and deletes all the Worker holds for them. */
export async function forget(ctx: Ctx, uid: string): Promise<Response> {
  for (const account of await ctx.store.accounts(uid)) {
    await revoke(await open(ctx.env, account.refresh, refreshContext(uid, account.email)).catch(() => ''), ctx.net.fetch)
  }
  await ctx.store.forget(uid)
  return json({ forgotten: true })
}

export async function registerPush(ctx: Ctx, uid: string, request: Request): Promise<Response> {
  const body = await readBody<{ token?: string; platform?: string; timeZone?: string }>(request)
  if (typeof body.token !== 'string' || body.token.length < 20 || body.token.length > 4096) throw new HttpError(400, 'bad_request', 'That is not a push token.')
  await ctx.store.putPush(body.token, uid, body.platform === 'android' ? 'android' : 'other', ctx.now)
  if (body.timeZone) await ctx.store.setTimeZone(uid, zoneName(body.timeZone))
  return json({ registered: true })
}

export async function unregisterPush(ctx: Ctx, uid: string, request: Request): Promise<Response> {
  const body = await readBody<{ token?: string }>(request)
  // Only the caller's own token goes.
  if (typeof body.token === 'string' && (await ctx.store.pushTokens(uid)).includes(body.token)) await ctx.store.deletePush(body.token)
  return json({ registered: false })
}
