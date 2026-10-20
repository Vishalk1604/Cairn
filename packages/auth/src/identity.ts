/**
 * Reading the ID token Google returns with a sign-in.
 *
 * The signature is deliberately not checked here. The token arrived over TLS
 * straight from Google's token endpoint in response to a request this app
 * made, so there is no untrusted hop to defend against, and anything that
 * actually relies on the identity — Firestore, through Firebase Auth —
 * verifies it server-side regardless. The claims are used only to label the
 * account in the interface.
 */

export interface GoogleIdentity {
  /** Google's stable id for the account. Survives an email change. */
  sub: string
  email: string
  emailVerified: boolean
  name?: string
  picture?: string
  /** The Workspace domain, when the account belongs to one. */
  domain?: string
}

interface IdTokenClaims {
  sub?: string
  email?: string
  email_verified?: boolean
  name?: string
  picture?: string
  hd?: string
}

export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityError'
  }
}

export function readIdToken(idToken: string): GoogleIdentity {
  const parts = idToken.split('.')
  if (parts.length !== 3) throw new IdentityError('That is not an ID token')

  let claims: IdTokenClaims
  try {
    claims = JSON.parse(decodeBase64url(parts[1]!)) as IdTokenClaims
  } catch {
    throw new IdentityError('The ID token could not be read')
  }

  if (!claims.sub || !claims.email) throw new IdentityError('The ID token names no account')
  return {
    sub: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true,
    ...(claims.name !== undefined && { name: claims.name }),
    ...(claims.picture !== undefined && { picture: claims.picture }),
    ...(claims.hd !== undefined && { domain: claims.hd }),
  }
}

const LOOKUP = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Decodes base64url to a UTF-8 string without `atob` or `Buffer`. */
function decodeBase64url(input: string): string {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of input) {
    const value = LOOKUP.indexOf(character)
    if (value < 0) throw new IdentityError('The ID token is not valid base64url')
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return utf8(bytes)
}

/** Names and Workspace domains are not all ASCII, so this decodes properly. */
function utf8(bytes: readonly number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const byte = bytes[i]!
    let codePoint: number
    let width: number
    if (byte < 0x80) {
      codePoint = byte
      width = 1
    } else if (byte >= 0xc0 && byte < 0xe0) {
      codePoint = byte & 0x1f
      width = 2
    } else if (byte >= 0xe0 && byte < 0xf0) {
      codePoint = byte & 0x0f
      width = 3
    } else {
      codePoint = byte & 0x07
      width = 4
    }
    for (let k = 1; k < width; k++) codePoint = (codePoint << 6) | (bytes[i + k]! & 0x3f)
    out += String.fromCodePoint(codePoint)
    i += width
  }
  return out
}
