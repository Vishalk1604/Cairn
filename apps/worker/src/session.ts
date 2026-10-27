import { TokenError } from '@cairn/auth'
import { GOOGLE_SCOPES } from '@cairn/sync/scopes'
import { open, openJson, seal, sealJson } from './crypto'
import type { Env } from './env'
import { signInWithGoogle, type FirebaseSession } from './firebase'
import { Firestore } from './firestore'
import { refresh } from './google'
import type { Net } from './net'
import type { AccountRow, Store } from './store'

/** What every piece of work in one invocation shares. */
export interface Ctx {
  env: Env
  store: Store
  net: Net
  now: number
}

/** A token is renewed this long before it runs out, so a slow run never holds a dead one. */
const EARLY_MS = 3 * 60_000
/** Firebase sessions last an hour; this one is used for fifty minutes. */
const FIREBASE_MS = 50 * 60_000

export const refreshContext = (uid: string, email: string) => `refresh:${uid}:${email}`
const tokenContext = (uid: string, email: string, purpose: string) => `token:${uid}:${email}:${purpose}`

/** Google refused the account's refresh token: it was revoked or expired, and only a new consent brings it back. */
export class AccountSignedOut extends Error {
  constructor(readonly email: string) {
    super(`Google signed Cairn out of ${email}. Connect it again on your phone.`)
    this.name = 'AccountSignedOut'
  }
}

export async function sealRefresh(env: Env, uid: string, email: string, token: string): Promise<string> {
  return seal(env, token, refreshContext(uid, email))
}

/**
 * A fresh grant from Google for one account. A refused refresh token marks
 * the account as needing to be connected again, which the phone shows.
 */
async function refreshAccount(ctx: Ctx, account: AccountRow, scopes?: readonly string[]) {
  const { env, store, now } = ctx
  const refreshToken = await open(env, account.refresh, refreshContext(account.uid, account.email))
  let fresh
  try {
    fresh = await refresh(env, refreshToken, ctx.net.fetch, now, scopes)
  } catch (error) {
    if (error instanceof TokenError && error.needsReconsent) {
      const problem = `Google signed Cairn out of ${account.email}. Connect it again on your phone.`
      if (account.problem !== problem) await store.putAccount({ ...account, problem })
      throw new AccountSignedOut(account.email)
    }
    throw error
  }
  // Google can hand back a new refresh token; the old one may stop working.
  if (fresh.refreshToken && fresh.refreshToken !== refreshToken) {
    await store.putAccount({ ...account, refresh: await sealRefresh(env, account.uid, account.email, fresh.refreshToken), problem: null })
  } else if (account.problem) {
    await store.putAccount({ ...account, problem: null })
  }
  return fresh
}

/**
 * An access token for one account, from the cache or freshly from Google.
 * `purpose` keeps tokens for different jobs apart: a run's token carries the
 * whole grant, a device's only what its job needs.
 */
export async function accessToken(ctx: Ctx, account: AccountRow, purpose: string, scopes?: readonly string[]): Promise<{ accessToken: string; expiresAt: number }> {
  const { env, store, now } = ctx
  const context = tokenContext(account.uid, account.email, purpose)
  const cached = await store.token(account.uid, account.email, purpose)
  if (cached && cached.expiresAt - EARLY_MS > now) {
    try {
      return await openJson(env, cached.token, context)
    } catch {
      // Sealed under an old key: fetch a new one.
    }
  }
  const fresh = await refreshAccount(ctx, account, scopes)
  const kept = { accessToken: fresh.accessToken, expiresAt: fresh.expiresAt }
  await store.putToken(account.uid, account.email, purpose, await sealJson(env, kept, context), fresh.expiresAt)
  return kept
}

/**
 * A Firebase session for the person, so the Worker can write to their
 * Firestore as them: a Google ID token from the owner account's refresh
 * token, traded at Identity Toolkit, kept for fifty minutes.
 */
export async function firebaseSession(ctx: Ctx, uid: string, owner?: AccountRow): Promise<FirebaseSession> {
  const { env, store, now } = ctx
  const holder = owner ?? (await store.accounts(uid)).find((a) => a.role === 'owner')
  if (!holder) throw new Error('No account holds this person’s data')
  const cached = await store.token(uid, holder.email, 'firebase')
  if (cached && cached.expiresAt - EARLY_MS > now) {
    try {
      return await openJson<FirebaseSession>(env, cached.token, tokenContext(uid, holder.email, 'firebase'))
    } catch {
      // Fetch a new one.
    }
  }
  const { idToken } = await refreshAccount(ctx, holder, GOOGLE_SCOPES.identity)
  if (!idToken) throw new Error('Google did not say who the account is')
  const session = await signInWithGoogle(env, idToken, ctx.net.fetch, now)
  if (session.uid !== uid) throw new Error('That Google account signs in as someone else')
  const kept = { ...session, expiresAt: Math.min(session.expiresAt, now + FIREBASE_MS) }
  await store.putToken(uid, holder.email, 'firebase', await sealJson(env, kept, tokenContext(uid, holder.email, 'firebase')), kept.expiresAt)
  return kept
}

export async function firestoreFor(ctx: Ctx, uid: string, owner?: AccountRow): Promise<Firestore> {
  const session = await firebaseSession(ctx, uid, owner)
  return new Firestore(ctx.env.FIREBASE_PROJECT_ID, session.idToken, ctx.net.fetch)
}
