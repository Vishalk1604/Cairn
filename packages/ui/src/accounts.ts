import {
  authorizeUrl,
  createPkce,
  exchangeCode,
  isExpired,
  randomState,
  readIdToken,
  readRedirect,
  refreshTokens,
  webCrypto,
  type GoogleIdentity,
  type TokenSet,
} from '@cairn/auth'
import { GOOGLE_SCOPES } from '@cairn/sync'
import type { Platform, SecretStore } from './platform'

/**
 * Every connected account, encrypted together in the host's secret store:
 * DPAPI on Windows, the keystore on Android.
 */
const ACCOUNTS_KEY = 'google-accounts'

/**
 * What the token endpoint is told about this client. Both halves come from
 * the host because only the host knows them: Google requires a "secret" at
 * the token exchange for a Desktop client even alongside PKCE, and requires
 * none at all for an Android one.
 */
function credentials(platform: Platform): { clientId: string; clientSecret?: string } {
  return { clientId: platform.googleClientId, clientSecret: platform.googleClientSecret() }
}

/**
 * The account Cairn belongs to, or one it only reads from.
 *
 * Exactly one account is the owner: it holds the notes, the reminders and
 * the Drive files. Any other is a source — a second inbox to watch, such as
 * a university account — and nothing is ever written to it. That separation
 * is what lets a university account be read for as long as it exists without
 * taking your notes with it when it is closed.
 */
export type AccountRole = 'owner' | 'source'

export interface Account {
  identity: GoogleIdentity
  role: AccountRole
  /** What Google actually granted, which can be less than was asked for. */
  scopes: string[]
  refreshToken: string
}

/** What a source account is being read for. */
export interface SourceFeatures {
  mail: boolean
  classroom: boolean
  /** Downloading the files teachers attach in Classroom, on the desktop. Implies Classroom. */
  files?: boolean
}

interface Stored {
  version: 1
  accounts: Account[]
}

export async function loadAccounts(secrets: SecretStore): Promise<Account[]> {
  const raw = await secrets.get(ACCOUNTS_KEY)
  if (!raw) return []
  try {
    const stored = JSON.parse(raw) as Partial<Stored>
    if (stored.version !== 1 || !Array.isArray(stored.accounts)) return []
    return stored.accounts.filter((a) => a?.refreshToken && a.identity?.sub)
  } catch {
    return []
  }
}

async function save(secrets: SecretStore, accounts: readonly Account[]): Promise<void> {
  const stored: Stored = { version: 1, accounts: [...accounts] }
  await secrets.set(ACCOUNTS_KEY, JSON.stringify(stored))
}

export function owner(accounts: readonly Account[]): Account | undefined {
  return accounts.find((a) => a.role === 'owner')
}

export function sources(accounts: readonly Account[]): Account[] {
  return accounts.filter((a) => a.role === 'source')
}

/** Whether Classroom announcements can be read too. Accounts that turned Classroom on before Cairn read them have to be asked again. */
export function readsAnnouncements(account: Account): boolean {
  return account.scopes.includes('https://www.googleapis.com/auth/classroom.announcements.readonly')
}

/** Which features this account has granted Google permission for. Whether they are switched on is a separate, local choice. */
export function featuresOf(account: Account): SourceFeatures {
  const has = (scope: string) => account.scopes.includes(scope)
  return {
    mail: GOOGLE_SCOPES.mail.every(has),
    // Accounts connected before the scope list was trimmed hold the older
    // synonym for coursework; either one is enough to read submissions.
    classroom:
      has('https://www.googleapis.com/auth/classroom.courses.readonly') &&
      (has('https://www.googleapis.com/auth/classroom.coursework.me.readonly') ||
        has('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly')),
    files: has('https://www.googleapis.com/auth/classroom.courses.readonly') && has('https://www.googleapis.com/auth/drive.readonly'),
  }
}

export function scopesFor(role: AccountRole, features: SourceFeatures, already: readonly string[] = []): string[] {
  const wanted = new Set<string>([...already, ...GOOGLE_SCOPES.identity])
  // The owner keeps the attachments, so it is the only one that needs Drive.
  if (role === 'owner') for (const s of GOOGLE_SCOPES.media) wanted.add(s)
  if (features.mail) for (const s of GOOGLE_SCOPES.mail) wanted.add(s)
  if (features.classroom || features.files) for (const s of GOOGLE_SCOPES.classroom) wanted.add(s)
  if (features.files) for (const s of GOOGLE_SCOPES.classroomFiles) wanted.add(s)
  return [...wanted]
}

export class ConnectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConnectError'
  }
}

/**
 * Runs the Google consent flow and records the account.
 *
 * Reconnecting an account that is already known updates it in place, keyed
 * on Google's stable id rather than the address, so changing an email does
 * not silently create a second entry.
 */
export async function connect(
  platform: Platform,
  options: { role: AccountRole; features?: SourceFeatures; expect?: GoogleIdentity },
): Promise<Account[]> {
  const existing = await loadAccounts(platform.secrets)
  const already = options.expect ? (existing.find((a) => a.identity.sub === options.expect!.sub)?.scopes ?? []) : []
  const scopes = scopesFor(options.role, options.features ?? { mail: false, classroom: false }, already)

  const pkce = await createPkce(webCrypto)
  const state = randomState(webCrypto)

  let redirectUri = ''
  const redirect = await platform.authorize((uri) => {
    redirectUri = uri
    return authorizeUrl({
      clientId: platform.googleClientId,
      redirectUri: uri,
      scopes,
      challenge: pkce.challenge,
      state,
      // Consent is forced because Google withholds a refresh token on a
      // repeat consent, and the connection would die at the first expiry.
      // Adding another account also needs the account chooser, which a
      // login hint would skip past.
      prompt: options.expect ? 'consent' : 'select_account consent',
      includeGrantedScopes: true,
      ...(options.expect ? { loginHint: options.expect.email } : {}),
    })
  })

  const code = readRedirect(redirect, state)
  const tokens = await exchangeCode({ ...credentials(platform), redirectUri, code, verifier: pkce.verifier })
  if (!tokens.idToken) throw new ConnectError('Google did not say which account that was')
  if (!tokens.refreshToken) {
    throw new ConnectError('Google withheld the long-term permission Cairn needs. Try connecting again.')
  }

  const identity = readIdToken(tokens.idToken)
  if (options.expect && identity.sub !== options.expect.sub) {
    throw new ConnectError(`That is ${identity.email}, not ${options.expect.email}. Pick the other account.`)
  }
  // Signing in again as an account already connected for reading should not
  // demote the owner or duplicate the entry.
  const previous = existing.find((a) => a.identity.sub === identity.sub)
  const role = previous?.role ?? options.role

  const account: Account = { identity, role, scopes: tokens.scopes, refreshToken: tokens.refreshToken }
  const accounts = previous
    ? existing.map((a) => (a.identity.sub === identity.sub ? account : a))
    : [...existing, account]

  await save(platform.secrets, accounts)
  forgetToken(identity.sub)
  return accounts
}

/** Forgets a source account. The owner can only be dropped by signing out. */
export async function disconnect(platform: Platform, sub: string): Promise<Account[]> {
  const existing = await loadAccounts(platform.secrets)
  const going = existing.find((a) => a.identity.sub === sub)
  if (going?.role === 'owner') {
    throw new ConnectError('That account holds your notes. Sign out to disconnect it.')
  }
  const remaining = existing.filter((a) => a.identity.sub !== sub)
  await save(platform.secrets, remaining)
  forgetToken(sub)
  return remaining
}

export async function forgetAllAccounts(platform: Platform): Promise<void> {
  await platform.secrets.delete(ACCOUNTS_KEY)
  tokens.clear()
}

const tokens = new Map<string, TokenSet>()

/**
 * A usable access token for one account, refreshed when stale. Held per
 * account so a burst of calls costs one refresh rather than several.
 */
export async function accessTokenFor(platform: Platform, account: Account): Promise<TokenSet> {
  const held = tokens.get(account.identity.sub)
  if (held && !isExpired(held, Date.now())) return held

  const fresh = await refreshTokens({ ...credentials(platform), refreshToken: account.refreshToken })
  tokens.set(account.identity.sub, fresh)

  // Google can hand back a different refresh token; storing it keeps the
  // next launch working.
  if (fresh.refreshToken && fresh.refreshToken !== account.refreshToken) {
    const all = await loadAccounts(platform.secrets)
    await save(
      platform.secrets,
      all.map((a) => (a.identity.sub === account.identity.sub ? { ...a, refreshToken: fresh.refreshToken! } : a)),
    )
  }
  return fresh
}

function forgetToken(sub: string): void {
  tokens.delete(sub)
}
