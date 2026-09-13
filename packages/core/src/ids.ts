export type RandomFill = (bytes: Uint8Array) => Uint8Array

interface CryptoLike {
  getRandomValues(bytes: Uint8Array): Uint8Array
}

/**
 * Uses Web Crypto where the runtime has it (browsers, WebView2, Node). Hermes
 * has no Web Crypto unless polyfilled, so fall back to Math.random: ids need to
 * be unique, not secret, and 74 random bits per millisecond is plenty.
 */
const defaultRandom: RandomFill = (bytes) => {
  const crypto = (globalThis as { crypto?: CryptoLike }).crypto
  if (crypto?.getRandomValues) return crypto.getRandomValues(bytes)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return bytes
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

/** RFC 9562 UUIDv7: 48-bit millisecond timestamp, then random bits. Sorts by creation time. */
export function uuidv7(now: number = Date.now(), random: RandomFill = defaultRandom): string {
  const bytes = random(new Uint8Array(16))
  let ts = Math.floor(now)
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  let out = ''
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-'
    out += HEX[bytes[i]!]
  }
  return out
}
