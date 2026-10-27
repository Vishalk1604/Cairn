const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

/** A token is treated as expired slightly early, so a call never races the clock. */
const EXPIRY_SKEW_MS = 60_000

export interface TokenSet {
  accessToken: string
  /** Absent on a refresh: Google only issues one at first consent. */
  refreshToken?: string
  /** When the access token stops working, in epoch milliseconds. */
  expiresAt: number
  /** What was actually granted, which can be less than what was asked for. */
  scopes: string[]
  /** Proof of who signed in; exchanged for a Firebase session. */
  idToken?: string
}

export interface TokenExchange {
  clientId: string
  /** Installed apps get one, and Google does not treat it as confidential. */
  clientSecret?: string
  redirectUri: string
  code: string
  verifier: string
}

export interface TokenRefresh {
  clientId: string
  clientSecret?: string
  refreshToken: string
  /**
   * Fewer scopes than were granted, for a token that can do only what one
   * job needs. Absent, the token carries everything granted.
   */
  scopes?: readonly string[]
}

/**
 * Only what the token endpoint needs. Typed structurally so the global
 * `fetch` of a web view, React Native or Node all satisfy it without this
 * package depending on any one of their type libraries.
 */
export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class TokenError extends Error {
  constructor(
    message: string,
    /** `invalid_grant` means the refresh token is dead and consent must be asked for again. */
    readonly code: string,
    readonly needsReconsent: boolean,
  ) {
    super(message)
    this.name = 'TokenError'
  }
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

export async function exchangeCode(
  request: TokenExchange,
  deps: { fetch?: Fetch; now?: () => number } = {},
): Promise<TokenSet> {
  return post(
    {
      grant_type: 'authorization_code',
      client_id: request.clientId,
      ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
      redirect_uri: request.redirectUri,
      code: request.code,
      code_verifier: request.verifier,
    },
    deps,
  )
}

export async function refreshTokens(
  request: TokenRefresh,
  deps: { fetch?: Fetch; now?: () => number } = {},
): Promise<TokenSet> {
  const refreshed = await post(
    {
      grant_type: 'refresh_token',
      client_id: request.clientId,
      ...(request.clientSecret ? { client_secret: request.clientSecret } : {}),
      refresh_token: request.refreshToken,
      ...(request.scopes?.length ? { scope: request.scopes.join(' ') } : {}),
    },
    deps,
  )
  // A refresh response usually omits the refresh token; keep the one we have
  // rather than losing the ability to refresh again.
  return { ...refreshed, refreshToken: refreshed.refreshToken ?? request.refreshToken }
}

export function isExpired(tokens: Pick<TokenSet, 'expiresAt'>, now: number, skewMs = EXPIRY_SKEW_MS): boolean {
  return now >= tokens.expiresAt - skewMs
}

/** True when everything asked for was actually granted. */
export function hasScopes(tokens: Pick<TokenSet, 'scopes'>, required: readonly string[]): boolean {
  return required.every((scope) => tokens.scopes.includes(scope))
}

async function post(
  body: Record<string, string>,
  { fetch: doFetch = globalFetch(), now = Date.now }: { fetch?: Fetch; now?: () => number },
): Promise<TokenSet> {
  const form = Object.entries(body)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  let response: Awaited<ReturnType<Fetch>>
  try {
    response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    })
  } catch (cause) {
    // The request never left. Usually no network — or, inside an app with a
    // content security policy, a host the policy does not allow, which the
    // browser reports as nothing more helpful than "failed to fetch".
    throw new TokenError(
      `Could not reach Google to complete sign-in (${cause instanceof Error ? cause.message : String(cause)}). ` +
        'Check the connection, and that the app is allowed to reach oauth2.googleapis.com.',
      'unreachable',
      false,
    )
  }

  let payload: TokenResponse
  try {
    payload = (await response.json()) as TokenResponse
  } catch {
    throw new TokenError(`Google returned something unreadable (HTTP ${response.status})`, 'unreadable', false)
  }

  if (!response.ok || payload.error || !payload.access_token) {
    const code = payload.error ?? `http_${response.status}`
    // invalid_grant is the one that matters: the refresh token has been
    // revoked or expired, and no amount of retrying will bring it back.
    const needsReconsent = code === 'invalid_grant'
    throw new TokenError(payload.error_description ?? `Google refused the token request (${code})`, code, needsReconsent)
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    // expires_in is seconds from now; absent, assume the usual hour.
    expiresAt: now() + (payload.expires_in ?? 3600) * 1000,
    scopes: payload.scope ? payload.scope.split(' ').filter(Boolean) : [],
    idToken: payload.id_token,
  }
}

function globalFetch(): Fetch {
  const found = (globalThis as { fetch?: Fetch }).fetch
  if (!found) throw new Error('This runtime has no fetch; pass one of your own')
  return found
}
