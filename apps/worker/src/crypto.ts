import type { Env } from './env'

/**
 * Everything the Worker keeps that would hurt in the wrong hands — Google
 * refresh tokens, the NVIDIA key, message text waiting for the model — is
 * sealed with AES-GCM before it reaches the database, under a key derived
 * from the ENC_KEY secret. Each sealed value is bound to where it lives (its
 * `context`), so one row's ciphertext pasted into another does not open.
 *
 * What passes through a browser on its way back here (the OAuth state, a
 * ticket naming the account to join) is sealed or signed the same way, so it
 * cannot be read or forged on the way.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function utf8(text: string): Uint8Array {
  return encoder.encode(text)
}

export function fromUtf8(bytes: Uint8Array | ArrayBuffer): string {
  return decoder.decode(bytes)
}

export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)))
}

interface Keys {
  seal: CryptoKey
  sign: CryptoKey
}

let derived: { secret: string; keys: Promise<Keys> } | null = null

/** Two keys from the one secret, so sealing and signing never share a key. Derived once per isolate. */
function keys(env: Pick<Env, 'ENC_KEY'>): Promise<Keys> {
  if (derived?.secret === env.ENC_KEY) return derived.keys
  const made = (async () => {
    const raw = fromBase64Url(env.ENC_KEY.trim().replace(/=+$/, ''))
    if (raw.length < 32) throw new Error('ENC_KEY must be at least 32 random bytes, base64-encoded')
    const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey'])
    const derive = (info: string, algorithm: { name: string; length: number; hash?: string }, usages: string[]) =>
      crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: utf8('cairn-worker'), info: utf8(info) }, base, algorithm, false, usages)
    return {
      seal: await derive('seal', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
      sign: await derive('sign', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign', 'verify']),
    }
  })()
  derived = { secret: env.ENC_KEY, keys: made }
  return made
}

/** "v1.<iv>.<ciphertext>", the context bound in as associated data. */
export async function seal(env: Pick<Env, 'ENC_KEY'>, plaintext: string, context: string): Promise<string> {
  const { seal: key } = await keys(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(context) }, key, utf8(plaintext))
  return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`
}

export class SealError extends Error {
  constructor() {
    super('A sealed value could not be opened')
    this.name = 'SealError'
  }
}

/** The plaintext, or a SealError when the value was changed, moved, or sealed under another key. */
export async function open(env: Pick<Env, 'ENC_KEY'>, sealed: string, context: string): Promise<string> {
  const [version, iv, data] = sealed.split('.')
  if (version !== 'v1' || !iv || !data) throw new SealError()
  const { seal: key } = await keys(env)
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(iv), additionalData: utf8(context) }, key, fromBase64Url(data))
    return fromUtf8(plain)
  } catch {
    throw new SealError()
  }
}

export async function sealJson(env: Pick<Env, 'ENC_KEY'>, value: unknown, context: string): Promise<string> {
  return seal(env, JSON.stringify(value), context)
}

export async function openJson<T>(env: Pick<Env, 'ENC_KEY'>, sealed: string, context: string): Promise<T> {
  return JSON.parse(await open(env, sealed, context)) as T
}

/** An HMAC over `message`, base64url. */
export async function sign(env: Pick<Env, 'ENC_KEY'>, message: string): Promise<string> {
  const { sign: key } = await keys(env)
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, utf8(message))))
}

/** Compared by the HMAC itself, which takes constant time. */
export async function verifySignature(env: Pick<Env, 'ENC_KEY'>, message: string, signature: string): Promise<boolean> {
  const { sign: key } = await keys(env)
  try {
    return await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), utf8(message))
  } catch {
    return false
  }
}

/** A signed, expiring claim: "<payload>.<signature>". Readable, but not forgeable. */
export async function signClaim(env: Pick<Env, 'ENC_KEY'>, purpose: string, claim: object, expiresAt: number): Promise<string> {
  const payload = toBase64Url(utf8(JSON.stringify({ ...claim, p: purpose, x: expiresAt })))
  return `${payload}.${await sign(env, payload)}`
}

export async function readClaim<T>(env: Pick<Env, 'ENC_KEY'>, purpose: string, token: string, now: number): Promise<T | null> {
  const [payload, signature] = token.split('.')
  if (!payload || !signature || !(await verifySignature(env, payload, signature))) return null
  try {
    const claim = JSON.parse(fromUtf8(fromBase64Url(payload))) as T & { p?: string; x?: number }
    if (claim.p !== purpose || typeof claim.x !== 'number' || claim.x < now) return null
    return claim
  } catch {
    return null
  }
}

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)))
}
