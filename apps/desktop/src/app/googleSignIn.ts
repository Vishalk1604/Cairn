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
import { GOOGLE_CLIENTS, GOOGLE_SCOPES, type ScopeGroup } from '@cairn/sync'
import type { Platform, SecretStore } from '../platform'

/** Where the owner account's refresh token lives, under DPAPI. */
const SESSION_KEY = 'google-owner'

/**
 * Google requires this at the token exchange for a Desktop client, even
 * alongside PKCE. It is not confidential for an installed app — it ships in
 * the executable — but it is kept out of the repository and injected at
 * build time all the same. See .env.example.
 */
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET

function credentials(): { clientId: string; clientSecret: string } {
  if (!CLIENT_SECRET) {
    throw new Error(
      'This build has no Google client secret. Copy apps/desktop/.env.example to .env.local, fill it in, and rebuild.',
    )
  }
  return { clientId: GOOGLE_CLIENTS.desktop, clientSecret: CLIENT_SECRET }
}

export interface Session {
  identity: GoogleIdentity
  /** What Google actually granted, which can be less than was asked for. */
  scopes: string[]
  refreshToken: string
}

interface StoredSession extends Session {
  version: 1
}

export async function loadSession(secrets: SecretStore): Promise<Session | null> {
  const raw = await secrets.get(SESSION_KEY)
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as Partial<StoredSession>
    if (stored.version !== 1 || !stored.refreshToken || !stored.identity) return null
    return { identity: stored.identity, scopes: stored.scopes ?? [], refreshToken: stored.refreshToken }
  } catch {
    return null
  }
}

async function saveSession(secrets: SecretStore, session: Session): Promise<void> {
  await secrets.set(SESSION_KEY, JSON.stringify({ version: 1, ...session } satisfies StoredSession))
}

export async function forgetSession(secrets: SecretStore): Promise<void> {
  await secrets.delete(SESSION_KEY)
}

/**
 * Signs in with Google in the real browser and keeps the refresh token.
 *
 * Only identity is asked for here. Drive, Gmail and Classroom are requested
 * later, each when its feature is first used, so the first screen a person
 * sees is not a demand for their whole inbox.
 */
export async function signIn(platform: Platform, extraScopes: readonly string[] = []): Promise<{ session: Session; tokens: TokenSet }> {
  const pkce = await createPkce(webCrypto)
  const state = randomState(webCrypto)
  const scopes = [...GOOGLE_SCOPES.identity, ...extraScopes]

  let redirectUri = ''
  const redirect = await platform.authorize((uri) => {
    redirectUri = uri
    return authorizeUrl({
      clientId: GOOGLE_CLIENTS.desktop,
      redirectUri: uri,
      scopes,
      challenge: pkce.challenge,
      state,
      // Forced, because Google withholds a refresh token on a repeat consent
      // and the connection would then die at the first token expiry.
      prompt: 'consent',
      includeGrantedScopes: true,
    })
  })

  const code = readRedirect(redirect, state)
  const tokens = await exchangeCode({ ...credentials(), redirectUri, code, verifier: pkce.verifier })

  if (!tokens.idToken) throw new Error('Google did not say who signed in')
  if (!tokens.refreshToken) {
    throw new Error('Google withheld the long-term permission Cairn needs. Try signing in again.')
  }

  const session: Session = {
    identity: readIdToken(tokens.idToken),
    scopes: tokens.scopes,
    refreshToken: tokens.refreshToken,
  }
  await saveSession(platform.secrets, session)
  return { session, tokens }
}

/**
 * Asks for one more group of scopes on an existing account, keeping those
 * already granted.
 */
export async function requestScopes(platform: Platform, session: Session, group: ScopeGroup): Promise<Session> {
  const wanted = GOOGLE_SCOPES[group]
  if (wanted.every((scope) => session.scopes.includes(scope))) return session
  const { session: updated } = await signIn(platform, [...session.scopes, ...wanted])
  return updated
}

const cache = new Map<string, TokenSet>()

/**
 * A usable access token, refreshed if the one in hand has expired. Kept in
 * memory per account so a burst of calls costs one refresh, not several.
 */
export async function accessToken(platform: Platform, session: Session): Promise<TokenSet> {
  const held = cache.get(session.identity.sub)
  if (held && !isExpired(held, Date.now())) return held

  const tokens = await refreshTokens({ ...credentials(), refreshToken: session.refreshToken })
  cache.set(session.identity.sub, tokens)
  // Google can hand back a different refresh token; storing it keeps the
  // next launch working.
  if (tokens.refreshToken && tokens.refreshToken !== session.refreshToken) {
    await saveSession(platform.secrets, { ...session, refreshToken: tokens.refreshToken })
  }
  return tokens
}

export function forgetCachedTokens(): void {
  cache.clear()
}
