const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

export interface AuthorizeRequest {
  clientId: string
  /** A loopback URL on desktop, the app's own scheme on Android. */
  redirectUri: string
  scopes: readonly string[]
  challenge: string
  state: string
  /**
   * Google only returns a refresh token on a consent that explicitly asks
   * for one, so this defaults on: without it the connection would work until
   * the first access token expired and then quietly stop.
   */
  offline?: boolean
  /**
   * Re-consent returns no refresh token unless the prompt is forced, which
   * is how apps end up unable to refresh after a reinstall.
   */
  prompt?: 'consent' | 'select_account' | 'none'
  /** Keeps scopes already granted when asking for one more. */
  includeGrantedScopes?: boolean
  /** Pre-selects an account, for reconnecting a known one. */
  loginHint?: string
}

export function authorizeUrl(request: AuthorizeRequest): string {
  const params: Record<string, string> = {
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: 'code',
    scope: [...request.scopes].join(' '),
    code_challenge: request.challenge,
    code_challenge_method: 'S256',
    state: request.state,
    access_type: (request.offline ?? true) ? 'offline' : 'online',
  }
  if (request.prompt) params.prompt = request.prompt
  if (request.includeGrantedScopes) params.include_granted_scopes = 'true'
  if (request.loginHint) params.login_hint = request.loginHint

  // Built by hand rather than with URL, whose React Native implementation
  // has historically differed from the browser's.
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')
  return `${AUTH_ENDPOINT}?${query}`
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: 'denied' | 'state_mismatch' | 'malformed' | 'provider_error',
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/**
 * Reads the code out of the redirect Google sends back.
 *
 * The state check is the security-relevant part: without it, someone could
 * hand this app an authorization response obtained for a different session.
 */
export function readRedirect(redirect: string, expectedState: string): string {
  const params = parseQuery(redirect)
  if (!params) throw new AuthorizationError('That redirect is not a URL', 'malformed')

  const error = params.get('error')
  if (error) {
    throw new AuthorizationError(
      error === 'access_denied' ? 'You turned down the permission request' : `Google refused the sign-in: ${error}`,
      error === 'access_denied' ? 'denied' : 'provider_error',
    )
  }

  // Compared before the code is read, so a mismatched response is never acted on.
  if (params.get('state') !== expectedState) {
    throw new AuthorizationError('That sign-in response belongs to a different request', 'state_mismatch')
  }

  const code = params.get('code')
  if (!code) throw new AuthorizationError('The redirect carried no authorization code', 'malformed')
  return code
}

/** Null when the input is not a URL at all. */
function parseQuery(redirect: string): Map<string, string> | null {
  const scheme = redirect.indexOf(':')
  const start = redirect.indexOf('?')
  if (scheme < 0 || (start >= 0 && start < scheme)) return null

  const params = new Map<string, string>()
  if (start < 0) return params

  const fragment = redirect.indexOf('#', start)
  const query = redirect.slice(start + 1, fragment < 0 ? undefined : fragment)
  for (const pair of query.split('&')) {
    if (!pair) continue
    const equals = pair.indexOf('=')
    const key = equals < 0 ? pair : pair.slice(0, equals)
    const value = equals < 0 ? '' : pair.slice(equals + 1)
    params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, ' ')))
  }
  return params
}
