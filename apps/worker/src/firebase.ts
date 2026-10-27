import { fromBase64Url, fromUtf8, utf8 } from './crypto'
import type { Env } from './env'
import { HttpError } from './http'
import type { FetchFn } from './net'

/**
 * Who is calling. The apps prove it with the ID token of their Firebase
 * session — the same one Firestore's rules trust — sent as a bearer token.
 * It is checked here the way the Admin SDK does: an RS256 signature by one
 * of Google's securetoken keys, issued for this project, not expired.
 */

const KEYS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'
/** Clocks differ a little; a token minted a few seconds "in the future" is still fine. */
const SKEW_S = 300

interface Jwk extends JsonWebKey {
  kid?: string
}

let keyCache: { keys: Map<string, Promise<CryptoKey>>; until: number } | null = null

/** For tests. */
export function resetKeyCache(): void {
  keyCache = null
}

async function signingKey(kid: string, fetchFn: FetchFn, now: number): Promise<CryptoKey | null> {
  if (!keyCache || keyCache.until <= now || !keyCache.keys.has(kid)) {
    const response = await fetchFn(KEYS_URL)
    if (!response.ok) throw new HttpError(503, 'keys_unavailable', 'Could not check who you are just now. Try again shortly.')
    const { keys = [] } = (await response.json()) as { keys?: Jwk[] }
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('Cache-Control') ?? '')?.[1]
    keyCache = {
      until: now + Math.min(Number(maxAge ?? 3600), 6 * 3600) * 1000,
      keys: new Map(
        keys
          .filter((k) => k.kid && k.kty === 'RSA')
          .map((k) => [k.kid!, crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])]),
      ),
    }
  }
  return (await keyCache.keys.get(kid)) ?? null
}

export interface Caller {
  uid: string
  email?: string
}

interface Claims {
  aud?: string
  iss?: string
  sub?: string
  exp?: number
  iat?: number
  auth_time?: number
  email?: string
}

/** The Firebase user behind an ID token, or an HttpError(401) saying why not. */
export async function verifyIdToken(env: Pick<Env, 'FIREBASE_PROJECT_ID'>, token: string, fetchFn: FetchFn, now: number): Promise<Caller> {
  const refuse = (why: string) => new HttpError(401, 'unauthenticated', why)
  const parts = token.split('.')
  if (parts.length !== 3) throw refuse('That is not a sign-in token.')
  let header: { alg?: string; kid?: string }
  let claims: Claims
  try {
    header = JSON.parse(fromUtf8(fromBase64Url(parts[0]!))) as typeof header
    claims = JSON.parse(fromUtf8(fromBase64Url(parts[1]!))) as Claims
  } catch {
    throw refuse('That sign-in token could not be read.')
  }
  if (header.alg !== 'RS256' || !header.kid) throw refuse('That sign-in token is not signed the way Firebase signs them.')
  const project = env.FIREBASE_PROJECT_ID
  const seconds = Math.floor(now / 1000)
  if (claims.aud !== project || claims.iss !== `https://securetoken.google.com/${project}`) throw refuse('That sign-in token is for another project.')
  if (typeof claims.exp !== 'number' || claims.exp <= seconds) throw refuse('That sign-in token has expired.')
  if (typeof claims.iat !== 'number' || claims.iat > seconds + SKEW_S) throw refuse('That sign-in token is from the future.')
  if (typeof claims.auth_time === 'number' && claims.auth_time > seconds + SKEW_S) throw refuse('That sign-in token is from the future.')
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw refuse('That sign-in token names no one.')
  const key = await signingKey(header.kid, fetchFn, now)
  if (!key) throw refuse('That sign-in token was signed by a key Google does not use.')
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromBase64Url(parts[2]!), utf8(`${parts[0]}.${parts[1]}`))
  if (!valid) throw refuse('That sign-in token is not genuine.')
  return { uid: claims.sub, ...(claims.email ? { email: claims.email } : {}) }
}

/** The caller of a device request, from its Authorization header. */
export async function caller(request: Request, env: Env, fetchFn: FetchFn, now: number): Promise<Caller> {
  const header = request.headers.get('Authorization') ?? ''
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1]
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in first.')
  return verifyIdToken(env, token, fetchFn, now)
}

export interface FirebaseSession {
  uid: string
  idToken: string
  expiresAt: number
}

/**
 * Trades a Google ID token for a Firebase session, as the apps do with
 * signInWithCredential. The Worker then writes to Firestore as that person,
 * so the same security rules stand between it and anyone else's data.
 */
export async function signInWithGoogle(env: Pick<Env, 'FIREBASE_API_KEY'>, googleIdToken: string, fetchFn: FetchFn, now: number): Promise<FirebaseSession> {
  const response = await fetchFn(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnIdpCredential: false,
      returnSecureToken: true,
    }),
  })
  const body = (await response.json().catch(() => ({}))) as { localId?: string; idToken?: string; expiresIn?: string; error?: { message?: string } }
  if (!response.ok || !body.localId || !body.idToken) {
    throw new Error(`Firebase would not sign in with that Google account: ${body.error?.message ?? response.status}`)
  }
  return { uid: body.localId, idToken: body.idToken, expiresAt: now + Number(body.expiresIn ?? 3600) * 1000 }
}
