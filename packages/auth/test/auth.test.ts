import { describe, expect, it, vi } from 'vitest'
import {
  asciiBytes,
  authorizeUrl,
  AuthorizationError,
  base64url,
  createPkce,
  exchangeCode,
  hasScopes,
  isExpired,
  randomState,
  readRedirect,
  refreshTokens,
  TokenError,
  webCrypto,
  type AuthCrypto,
  type Fetch,
} from '../src'

const CLIENT = '1093942418184-desktop.apps.googleusercontent.com'
const REDIRECT = 'http://127.0.0.1:51234/callback'

/** Deterministic bytes, so a URL can be asserted exactly. */
const fixedCrypto = (fill = 7): AuthCrypto => ({
  randomBytes: (count) => new Uint8Array(count).fill(fill),
  sha256: async (bytes) => new Uint8Array(32).fill(bytes.length % 256),
})

/** Pulls the query out of a built URL without relying on a URL implementation. */
function query(url: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of url.slice(url.indexOf('?') + 1).split('&')) {
    const [key, value = ''] = pair.split('=')
    out[decodeURIComponent(key!)] = decodeURIComponent(value)
  }
  return out
}

const reply = (status: number, body: unknown): ReturnType<Fetch> =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body })

describe('PKCE', () => {
  it('produces URL-safe values with no padding', async () => {
    const pkce = await createPkce(fixedCrypto())
    expect(pkce.method).toBe('S256')
    for (const value of [pkce.verifier, pkce.challenge]) {
      expect(value).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(value).not.toContain('=')
    }
  })

  it('keeps the verifier within the length RFC 7636 allows', async () => {
    const pkce = await createPkce(webCrypto)
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43)
    expect(pkce.verifier.length).toBeLessThanOrEqual(128)
  })

  it('derives the challenge from the verifier, not at random', async () => {
    const crypto = fixedCrypto()
    expect(await createPkce(crypto)).toEqual(await createPkce(crypto))
  })

  it('gives a different verifier each time with real randomness', async () => {
    const a = await createPkce(webCrypto)
    const b = await createPkce(webCrypto)
    expect(a.verifier).not.toBe(b.verifier)
    expect(randomState(webCrypto)).not.toBe(randomState(webCrypto))
  })

  it('encodes base64url the way the spec expects', () => {
    expect(base64url(new Uint8Array([251, 255, 190]))).toBe('-_--')
    expect(base64url(new Uint8Array([0]))).toBe('AA')
    expect(base64url(new Uint8Array([0, 0]))).toBe('AAA')
    expect(base64url(new Uint8Array([]))).toBe('')
    // Known vector: "Ma" encodes to "TWE".
    expect(base64url(asciiBytes('Ma'))).toBe('TWE')
  })

  it('matches the worked SHA-256 example in RFC 7636', async () => {
    // Exercises the whole chain — ASCII conversion, digest and encoding.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(base64url(await webCrypto.sha256(asciiBytes(verifier)))).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})

describe('the authorization URL', () => {
  const build = (overrides = {}) =>
    authorizeUrl({ clientId: CLIENT, redirectUri: REDIRECT, scopes: ['openid', 'email'], challenge: 'abc', state: 'xyz', ...overrides })

  it('asks Google for a code, with the challenge and state', () => {
    const url = build()
    expect(url.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    expect(query(url)).toMatchObject({
      client_id: CLIENT,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid email',
      code_challenge: 'abc',
      code_challenge_method: 'S256',
      state: 'xyz',
    })
  })

  it('escapes values rather than pasting them in raw', () => {
    const url = build({ redirectUri: 'cairn://oauth?x=1', scopes: ['a b'] })
    expect(url).toContain('redirect_uri=cairn%3A%2F%2Foauth%3Fx%3D1')
    expect(query(url).redirect_uri).toBe('cairn://oauth?x=1')
  })

  it('asks for offline access by default, because background refresh depends on it', () => {
    expect(query(build()).access_type).toBe('offline')
    expect(query(build({ offline: false })).access_type).toBe('online')
  })

  it('passes the incremental-consent options through only when asked', () => {
    expect(query(build()).include_granted_scopes).toBeUndefined()
    expect(query(build()).prompt).toBeUndefined()
    const url = query(build({ includeGrantedScopes: true, prompt: 'consent', loginHint: 'me@uni.edu' }))
    expect(url).toMatchObject({ include_granted_scopes: 'true', prompt: 'consent', login_hint: 'me@uni.edu' })
  })
})

describe('reading the redirect', () => {
  it('returns the code when the state matches', () => {
    expect(readRedirect(`${REDIRECT}?code=4%2Fabc&state=xyz`, 'xyz')).toBe('4/abc')
  })

  it('handles a custom scheme as well as a loopback URL', () => {
    expect(readRedirect('cairn://oauth?code=4/xyz&state=s', 's')).toBe('4/xyz')
  })

  it('ignores a fragment after the query', () => {
    expect(readRedirect(`${REDIRECT}?code=c&state=s#done`, 's')).toBe('c')
  })

  it('refuses a response meant for a different request', () => {
    try {
      readRedirect(`${REDIRECT}?code=4/abc&state=someone-else`, 'xyz')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('state_mismatch')
    }
  })

  it('checks the state before trusting anything else in the response', () => {
    expect(() => readRedirect(`${REDIRECT}?code=stolen&state=`, 'xyz')).toThrow(/different request/)
    expect(() => readRedirect(`${REDIRECT}?code=stolen`, 'xyz')).toThrow(/different request/)
  })

  it('reports a refusal as a refusal, not a crash', () => {
    try {
      readRedirect(`${REDIRECT}?error=access_denied&state=xyz`, 'xyz')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('denied')
      expect((error as Error).message).toMatch(/turned down/)
    }
  })

  it('surfaces a provider error distinctly from a refusal', () => {
    try {
      readRedirect(`${REDIRECT}?error=admin_policy_enforced&state=xyz`, 'xyz')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('provider_error')
    }
  })

  it('rejects a redirect with no code and anything that is not a URL', () => {
    expect(() => readRedirect(`${REDIRECT}?state=xyz`, 'xyz')).toThrow(/no authorization code/)
    expect(() => readRedirect('not a url', 'xyz')).toThrow(/not a URL/)
    expect(() => readRedirect('?code=c&state=s', 's')).toThrow(/not a URL/)
  })
})

describe('exchanging and refreshing tokens', () => {
  it('sends the verifier and reads the token set back', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(
      reply(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'openid email', id_token: 'it' }),
    )
    const tokens = await exchangeCode(
      { clientId: CLIENT, redirectUri: REDIRECT, code: '4/abc', verifier: 'v' },
      { fetch: doFetch, now: () => 1_000 },
    )

    const sent = query(`?${doFetch.mock.calls[0]![1].body}`)
    expect(sent).toMatchObject({ grant_type: 'authorization_code', code_verifier: 'v', code: '4/abc' })
    expect(sent.client_secret).toBeUndefined()
    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1_000 + 3_600_000,
      scopes: ['openid', 'email'],
      idToken: 'it',
    })
  })

  it('keeps the existing refresh token when the refresh response omits one', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(reply(200, { access_token: 'new', expires_in: 3600 }))
    const tokens = await refreshTokens({ clientId: CLIENT, refreshToken: 'original' }, { fetch: doFetch, now: () => 0 })
    expect(tokens).toMatchObject({ accessToken: 'new', refreshToken: 'original' })
  })

  it('flags a dead refresh token as needing consent again', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(reply(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }))
    await expect(refreshTokens({ clientId: CLIENT, refreshToken: 'stale' }, { fetch: doFetch })).rejects.toMatchObject({
      name: 'TokenError',
      code: 'invalid_grant',
      needsReconsent: true,
    })
  })

  it('does not ask for consent again over a passing server error', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(reply(503, {}))
    await expect(refreshTokens({ clientId: CLIENT, refreshToken: 'fine' }, { fetch: doFetch })).rejects.toMatchObject({
      needsReconsent: false,
    })
  })

  it('treats a 200 with no access token as a failure', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(reply(200, { scope: 'openid' }))
    await expect(
      exchangeCode({ clientId: CLIENT, redirectUri: REDIRECT, code: 'c', verifier: 'v' }, { fetch: doFetch }),
    ).rejects.toThrow(TokenError)
  })

  it('survives a response that is not JSON at all', async () => {
    const doFetch = vi.fn<Fetch>().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    })
    await expect(refreshTokens({ clientId: CLIENT, refreshToken: 'x' }, { fetch: doFetch })).rejects.toThrow(/unreadable/)
  })

  it('includes the client secret only when there is one', async () => {
    const doFetch = vi.fn<Fetch>().mockReturnValue(reply(200, { access_token: 'a', expires_in: 60 }))
    await refreshTokens({ clientId: CLIENT, clientSecret: 'shh', refreshToken: 'r' }, { fetch: doFetch })
    expect(query(`?${doFetch.mock.calls[0]![1].body}`).client_secret).toBe('shh')
  })
})

describe('token state', () => {
  it('counts a token as expired a minute early, so a call cannot race the clock', () => {
    const tokens = { expiresAt: 100_000 }
    expect(isExpired(tokens, 30_000)).toBe(false)
    expect(isExpired(tokens, 41_000)).toBe(true)
    expect(isExpired(tokens, 100_001)).toBe(true)
  })

  it('knows when a grant fell short of what was asked for', () => {
    const tokens = { scopes: ['openid', 'https://www.googleapis.com/auth/drive.file'] }
    expect(hasScopes(tokens, ['openid'])).toBe(true)
    expect(hasScopes(tokens, ['openid', 'https://www.googleapis.com/auth/gmail.readonly'])).toBe(false)
    expect(hasScopes(tokens, [])).toBe(true)
  })
})

describe('when the request never leaves', () => {
  it('explains a blocked or offline request instead of passing on "failed to fetch"', async () => {
    const doFetch = vi.fn<Fetch>().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(refreshTokens({ clientId: CLIENT, refreshToken: 'r' }, { fetch: doFetch })).rejects.toMatchObject({
      name: 'TokenError',
      code: 'unreachable',
      needsReconsent: false,
    })
    await expect(refreshTokens({ clientId: CLIENT, refreshToken: 'r' }, { fetch: doFetch })).rejects.toThrow(
      /oauth2\.googleapis\.com/,
    )
  })
})
