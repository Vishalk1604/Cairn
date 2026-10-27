import { createPkce, randomState, readRedirect, webCrypto } from '@cairn/auth'
import type { AccountsDoc, Service, Want, WorkerAccount, WorkerClient } from '@cairn/sync'
import type { Platform } from './platform'

/**
 * Google accounts, as the apps see them now that the Worker holds them.
 *
 * A device never keeps a Google refresh token. Signing in, adding a college
 * account or granting one more permission all run the Worker's consent flow
 * in the browser; the Worker keeps the grant and the device gets back only
 * who signed in — and, when signing in, the ID token for Firebase. What each
 * account is connected for is in settings/accounts, which the Worker writes
 * and both apps show.
 */

export type { Service, Want, WorkerAccount }

export const SERVICE_NAMES: Record<Service, string> = {
  drive: 'Drive',
  mail: 'Gmail',
  classroom: 'Classroom',
  announcements: 'Classroom announcements',
  files: 'Classroom files',
}

/** Where the older apps kept refresh tokens on the device. Cleared on first launch: the Worker holds them now. */
export const LEGACY_ACCOUNTS_KEY = 'google-accounts'

export class ConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectError'
  }
}

const WORKER_ERRORS: Record<string, string> = {
  expired: 'That sign-in took too long. Try again.',
  exchange_failed: 'Google did not finish the sign-in. Try again.',
  no_identity: 'Google did not say which account that was. Try again.',
  firebase_refused: 'Cairn could not sign in with that account. Try again in a minute.',
  no_refresh_token: 'Google withheld the long-term permission Cairn needs. Try again and tick every box.',
  unknown_user: 'Sign in on your phone first.',
  google_error: 'Google refused the sign-in. Try again.',
}

/**
 * Runs the Worker's consent flow in the browser and returns who it was.
 *
 * `link` joins the grant to the signed-in person (a college account, or more
 * permission for one already connected) rather than signing in. `add` shows
 * Google's account chooser even with a hint.
 */
export async function consentThroughWorker(
  platform: Pick<Platform, 'authorize'>,
  worker: WorkerClient,
  options: { want: readonly Want[]; hint?: string; link?: boolean; add?: boolean },
): Promise<{ uid: string; email: string; idToken?: string }> {
  const pkce = await createPkce(webCrypto)
  const state = randomState(webCrypto)
  const ticket = options.link ? await worker.ticket() : undefined
  const redirect = await platform.authorize((redirectUri) =>
    worker.authUrl({
      redirect: redirectUri,
      state,
      challenge: pkce.challenge,
      want: options.want,
      ...(options.hint ? { hint: options.hint } : {}),
      ...(ticket ? { ticket } : {}),
      ...(options.add ? { add: true } : {}),
    }),
  )
  const error = /[?&]error=([^&#]+)/.exec(redirect)?.[1]
  if (error && WORKER_ERRORS[error]) throw new ConnectError(WORKER_ERRORS[error]!)
  const code = readRedirect(redirect, state)
  const result = await worker.exchange(code, pkce.verifier)
  if (options.hint && result.email.toLowerCase() !== options.hint.toLowerCase()) {
    throw new ConnectError(`That was ${result.email}, not ${options.hint}. Pick ${options.hint} when Google asks.`)
  }
  return result
}

export function owner(accounts: readonly WorkerAccount[]): WorkerAccount | undefined {
  return accounts.find((a) => a.role === 'owner')
}

export function sources(accounts: readonly WorkerAccount[]): WorkerAccount[] {
  return accounts.filter((a) => a.role === 'source')
}

export function accountsOf(doc: AccountsDoc | null | undefined): WorkerAccount[] {
  return Array.isArray(doc?.accounts) ? doc.accounts.filter((a) => typeof a?.email === 'string') : []
}

/** Whether Gmail or Classroom is being read for an account: granted, and chosen. */
export function reading(account: WorkerAccount, what: 'mail' | 'classroom'): boolean {
  return account.services.includes(what) && account.watch[what]
}

/** Accounts whose Classroom files may be saved: granted Drive read access as well as Classroom. */
export function fileReaders(accounts: readonly WorkerAccount[]): WorkerAccount[] {
  return accounts.filter((a) => a.services.includes('files'))
}

/** "Gmail and Classroom", "Classroom", "nothing yet": what an account is read for, in a line. */
export function describeReading(account: WorkerAccount): string {
  const parts = [reading(account, 'mail') ? 'Gmail' : '', reading(account, 'classroom') ? 'Classroom' : ''].filter(Boolean)
  return parts.length ? parts.join(' and ') : 'nothing yet'
}
