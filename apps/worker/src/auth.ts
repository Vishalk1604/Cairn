import { authorizeUrl, base64url, createPkce, exchangeCode, readIdToken, webCrypto, type TokenSet } from '@cairn/auth'
import type { Want } from '@cairn/sync/worker'
import { publishAccounts } from './accounts'
import { openJson, randomToken, readClaim, sealJson, sha256, signClaim } from './crypto'
import { APP_SCHEME, USER_LIMIT } from './env'
import { signInWithGoogle, type FirebaseSession } from './firebase'
import { Firestore } from './firestore'
import { callbackUrl, revoke, scopesFor, servicesOf } from './google'
import { HttpError, json, page, readBody, redirect } from './http'
import { sealRefresh, type Ctx } from './session'
import type { AccountRow } from './store'

/**
 * Signing in, and connecting more Google accounts, through the Worker.
 *
 * The Worker is a confidential Web client: Google sends the browser back to
 * /auth/callback, the Worker trades the code for tokens with its secret and
 * keeps the refresh token, and the app gets only a one-time code. The app
 * trades that at /auth/exchange — proving with its own PKCE verifier that it
 * is the app that started — for the Google ID token it signs in to Firebase
 * with. A device never holds a Google refresh token.
 *
 * Connecting a second account, or granting more, carries a ticket: a signed,
 * short-lived note of which Cairn account it is for, fetched by the app
 * while signed in.
 */

const FLOW_MS = 10 * 60_000
const CODE_MS = 5 * 60_000
const TICKET_MS = 10 * 60_000
const WANTS: readonly Want[] = ['drive', 'mail', 'classroom', 'files']

/** Only the app may be sent back to: the phone's own scheme, or a loopback port on the computer. */
export function allowedRedirect(uri: string): boolean {
  if (uri.length > 300) return false
  if (uri.startsWith(`${APP_SCHEME}:/`)) return /^[A-Za-z0-9.:/_-]+$/.test(uri)
  return /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}(\/[A-Za-z0-9/_-]*)?$/.test(uri)
}

/** What travels, sealed, through Google and back as `state`. */
interface Flow {
  /** Where to send the browser back to. */
  r: string
  /** The app's own state, echoed back so it knows the reply is to its request. */
  s: string
  /** The app's PKCE challenge, checked at the exchange. */
  c: string
  /** The Worker's own PKCE verifier with Google. */
  v: string
  w: Want[]
  /** The Cairn account a new grant joins; absent when signing in. */
  u?: string
  x: number
}

/** What a one-time code stands for. */
interface Handoff {
  uid: string
  email: string
  challenge: string
  /** Only when signing in: the Google ID token for Firebase. */
  idToken?: string
}

function back(uri: string, params: Record<string, string>): string {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return `${uri}${uri.includes('?') ? '&' : '?'}${query}`
}

export async function startAuth(ctx: Ctx, url: URL): Promise<Response> {
  const { env, now } = ctx
  const q = url.searchParams
  const redirectUri = q.get('redirect') ?? ''
  const appState = q.get('state') ?? ''
  const challenge = q.get('challenge') ?? ''
  if (!allowedRedirect(redirectUri)) return page('That sign-in link is not Cairn’s', 'Start signing in again from the Cairn app.', 400)
  if (!appState || appState.length > 200 || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return page('That sign-in link is incomplete', 'Start signing in again from the Cairn app.', 400)
  const want = (q.get('want') ?? '').split(',').filter((w): w is Want => (WANTS as readonly string[]).includes(w))
  const ticket = q.get('ticket')
  let uid: string | undefined
  if (ticket) {
    const claim = await readClaim<{ uid: string }>(env, 'ticket', ticket, now)
    if (!claim) return page('That link has expired', 'Go back to Cairn and try again.', 400)
    uid = claim.uid
  }
  const hint = q.get('hint') ?? undefined
  const pkce = await createPkce(webCrypto)
  const flow: Flow = { r: redirectUri, s: appState, c: challenge, v: pkce.verifier, w: want, ...(uid ? { u: uid } : {}), x: now + FLOW_MS }
  return redirect(
    authorizeUrl({
      clientId: env.GOOGLE_CLIENT_ID,
      redirectUri: callbackUrl(env),
      scopes: scopesFor(want),
      challenge: pkce.challenge,
      state: await sealJson(env, flow, 'flow'),
      // Consent is always asked, since Google withholds the refresh token
      // otherwise; with a hint for a known account, the chooser is skipped.
      prompt: hint && !q.get('add') ? 'consent' : 'select_account consent',
      includeGrantedScopes: true,
      ...(hint ? { loginHint: hint } : {}),
    }),
  )
}

export async function finishAuth(ctx: Ctx, url: URL): Promise<Response> {
  const { env, store, now } = ctx
  const q = url.searchParams
  let flow: Flow
  try {
    flow = await openJson<Flow>(env, q.get('state') ?? '', 'flow')
  } catch {
    return page('That sign-in did not come from Cairn', 'Start again from the Cairn app.', 400)
  }
  if (flow.x < now) return redirect(back(flow.r, { error: 'expired', state: flow.s }))
  const error = q.get('error')
  if (error) return redirect(back(flow.r, { error: error === 'access_denied' ? 'access_denied' : 'google_error', state: flow.s }))

  let tokens: TokenSet
  try {
    tokens = await exchangeCode(
      { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, redirectUri: callbackUrl(env), code: q.get('code') ?? '', verifier: flow.v },
      { fetch: ctx.net.fetch as never, now: () => now },
    )
  } catch (e) {
    console.warn('Code exchange failed', e)
    return redirect(back(flow.r, { error: 'exchange_failed', state: flow.s }))
  }
  if (!tokens.idToken) return redirect(back(flow.r, { error: 'no_identity', state: flow.s }))
  const identity = readIdToken(tokens.idToken)

  // Signing in as a new person needs an invite. A college account joining
  // someone already signed in (flow.u) does not: that person was invited.
  if (!flow.u && !(await store.invited(identity.email))) {
    // Nothing is kept, and Google's permission goes straight back.
    await revoke(tokens.refreshToken ?? tokens.accessToken, ctx.net.fetch)
    return redirect(back(flow.r, { error: 'not_invited', state: flow.s }))
  }

  // Signing in: Firebase says which person this Google account is.
  let session: FirebaseSession | null = null
  let uid = flow.u
  if (!uid) {
    try {
      session = await signInWithGoogle(env, tokens.idToken, ctx.net.fetch, now)
    } catch (e) {
      console.warn('Firebase sign-in failed', e)
      return redirect(back(flow.r, { error: 'firebase_refused', state: flow.s }))
    }
    uid = session.uid
  }

  const user = await store.user(uid)
  if (!user) {
    if (flow.u) return redirect(back(flow.r, { error: 'unknown_user', state: flow.s }))
    // Google lets an unverified app with Gmail access have a hundred people.
    if ((await store.countUsers()) >= USER_LIMIT) return page('Cairn is full', 'Cairn can only have 100 people while Google reviews it. Your account was not changed.', 403)
    await store.putUser(uid, identity.email, now)
  }

  const existing = await store.account(uid, identity.email)
  // A grant narrower than the one held (the computer signing in, say) does
  // not replace it: Google's include_granted_scopes normally makes a new
  // grant a superset, but if not, the wider one is kept.
  const wider = !!tokens.refreshToken && (!existing || existing.scopes.every((s) => tokens.scopes.includes(s)))
  if (!wider && !existing) return redirect(back(flow.r, { error: 'no_refresh_token', state: flow.s }))
  const scopes = wider ? tokens.scopes : existing!.scopes
  const before = new Set(existing ? servicesOf(existing.scopes) : [])
  const after = new Set(servicesOf(scopes))
  const role = existing?.role ?? (!flow.u || identity.email === user?.email ? 'owner' : 'source')
  const row: AccountRow = {
    uid,
    email: identity.email,
    sub: identity.sub,
    role,
    scopes,
    refresh: wider ? await sealRefresh(env, uid, identity.email, tokens.refreshToken!) : existing!.refresh,
    // Reading switches on with the permission for it, the moment it is granted.
    watchMail: existing ? existing.watchMail || (after.has('mail') && !before.has('mail')) : after.has('mail'),
    watchClassroom: existing ? existing.watchClassroom || (after.has('classroom') && !before.has('classroom')) : after.has('classroom'),
    problem: null,
    createdAt: existing?.createdAt ?? now,
  }
  await store.putAccount(row)
  await store.dropTokens(uid, identity.email)

  try {
    const firestore = session ? new Firestore(env.FIREBASE_PROJECT_ID, session.idToken, ctx.net.fetch) : undefined
    await publishAccounts(ctx, uid, firestore)
  } catch (e) {
    // The apps can still ask /accounts; the next run writes it again.
    console.warn('Could not write the accounts document', e)
  }

  const code = randomToken()
  const handoff: Handoff = { uid, email: identity.email, challenge: flow.c, ...(session ? { idToken: tokens.idToken } : {}) }
  await store.putCode(code, await sealJson(env, handoff, 'code'), now + CODE_MS, now)
  return redirect(back(flow.r, { code, state: flow.s }))
}

export async function exchange(ctx: Ctx, request: Request): Promise<Response> {
  const { env, store, now } = ctx
  const body = await readBody<{ code?: string; verifier?: string }>(request)
  if (typeof body.code !== 'string' || typeof body.verifier !== 'string') throw new HttpError(400, 'bad_request', 'A code and its verifier are needed.')
  const sealed = await store.takeCode(body.code, now)
  if (!sealed) throw new HttpError(400, 'expired', 'That sign-in has expired. Try again.')
  const handoff = await openJson<Handoff>(env, sealed, 'code')
  if (base64url(await sha256(body.verifier)) !== handoff.challenge) throw new HttpError(400, 'wrong_verifier', 'That sign-in belongs to another app.')
  return json({ uid: handoff.uid, email: handoff.email, ...(handoff.idToken ? { idToken: handoff.idToken } : {}) })
}

export async function ticket(ctx: Ctx, uid: string): Promise<Response> {
  return json({ ticket: await signClaim(ctx.env, 'ticket', { uid }, ctx.now + TICKET_MS) })
}
