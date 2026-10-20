/**
 * PKCE, the part of the OAuth flow that makes it safe to run without a secret.
 *
 * Cairn's desktop and Android builds are both public clients: anyone can
 * unzip them, so anything embedded is readable. PKCE replaces the secret with
 * a value invented per sign-in — the authorization code is worthless to
 * anyone who did not start that particular exchange.
 *
 * Nothing here touches a platform API. Base64 and the ASCII conversion are
 * written out rather than borrowed from `btoa`, `Buffer` or `TextEncoder`,
 * none of which can be relied on across a web view, Hermes and Node alike.
 */

/** Supplied by each platform, because Hermes has no Web Crypto of its own. */
export interface AuthCrypto {
  randomBytes(count: number): Uint8Array
  sha256(bytes: Uint8Array): Promise<Uint8Array>
}

export interface Pkce {
  /** Kept locally and sent only with the code exchange. */
  verifier: string
  /** Sent in the authorization URL. */
  challenge: string
  method: 'S256'
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** URL-safe base64 with the padding dropped, as RFC 7636 requires. */
export function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += ALPHABET[a >> 2]
    out += ALPHABET[((a & 0b11) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += ALPHABET[((b & 0b1111) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += ALPHABET[c & 0b111111]
  }
  return out
}

/** The verifier is base64url, so every character is one ASCII byte. */
export function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f
  return bytes
}

/** 32 bytes, the upper end of the range RFC 7636 allows. */
export async function createPkce(crypto: AuthCrypto): Promise<Pkce> {
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(await crypto.sha256(asciiBytes(verifier)))
  return { verifier, challenge, method: 'S256' }
}

/**
 * A value echoed back by the redirect. Comparing it is what stops someone
 * else's authorization response being fed to this app.
 */
export function randomState(crypto: AuthCrypto): string {
  return base64url(crypto.randomBytes(16))
}

interface SubtleCryptoLike {
  getRandomValues(bytes: Uint8Array): Uint8Array
  subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> }
}

/**
 * Web Crypto, where the runtime has it: the desktop web view and Node.
 * React Native passes its own implementation instead.
 */
export const webCrypto: AuthCrypto = {
  randomBytes: (count) => crypto().getRandomValues(new Uint8Array(count)),
  sha256: async (bytes) => new Uint8Array(await crypto().subtle.digest('SHA-256', bytes)),
}

function crypto(): SubtleCryptoLike {
  const found = (globalThis as { crypto?: SubtleCryptoLike }).crypto
  if (!found?.subtle) throw new Error('This runtime has no Web Crypto; pass an AuthCrypto of your own')
  return found
}
