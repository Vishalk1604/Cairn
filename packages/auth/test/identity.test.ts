import { describe, expect, it } from 'vitest'
import { base64url, IdentityError, readIdToken } from '../src'

/** Builds a token the way Google would, so the decoder is tested, not a fixture. */
function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => {
    const json = JSON.stringify(value)
    const bytes = new Uint8Array(json.length * 4)
    let length = 0
    for (const character of json) {
      const code = character.codePointAt(0)!
      if (code < 0x80) bytes[length++] = code
      else if (code < 0x800) {
        bytes[length++] = 0xc0 | (code >> 6)
        bytes[length++] = 0x80 | (code & 0x3f)
      } else if (code < 0x10000) {
        bytes[length++] = 0xe0 | (code >> 12)
        bytes[length++] = 0x80 | ((code >> 6) & 0x3f)
        bytes[length++] = 0x80 | (code & 0x3f)
      } else {
        bytes[length++] = 0xf0 | (code >> 18)
        bytes[length++] = 0x80 | ((code >> 12) & 0x3f)
        bytes[length++] = 0x80 | ((code >> 6) & 0x3f)
        bytes[length++] = 0x80 | (code & 0x3f)
      }
    }
    return base64url(bytes.subarray(0, length))
  }
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature-not-checked`
}

describe('readIdToken', () => {
  it('reads the account out of a token', () => {
    const token = idToken({
      sub: '110000000000000000001',
      email: 'vishal@example.com',
      email_verified: true,
      name: 'Vishal',
      picture: 'https://example.com/p.jpg',
    })
    expect(readIdToken(token)).toEqual({
      sub: '110000000000000000001',
      email: 'vishal@example.com',
      emailVerified: true,
      name: 'Vishal',
      picture: 'https://example.com/p.jpg',
    })
  })

  it('reports the Workspace domain, which is how a university account is recognised', () => {
    const token = idToken({ sub: '1', email: 'me@uni.edu', email_verified: true, hd: 'uni.edu' })
    expect(readIdToken(token).domain).toBe('uni.edu')
    expect(readIdToken(idToken({ sub: '1', email: 'me@gmail.com' })).domain).toBeUndefined()
  })

  it('decodes names that are not ASCII', () => {
    expect(readIdToken(idToken({ sub: '1', email: 'a@b.c', name: 'Vishal — विशाल 🙂' })).name).toBe('Vishal — विशाल 🙂')
  })

  it('leaves optional claims out rather than storing undefined', () => {
    const identity = readIdToken(idToken({ sub: '1', email: 'a@b.c' }))
    expect('name' in identity).toBe(false)
    expect(identity.emailVerified).toBe(false)
  })

  it('refuses anything that is not a usable token', () => {
    expect(() => readIdToken('nonsense')).toThrow(IdentityError)
    expect(() => readIdToken('a.b')).toThrow(/not an ID token/)
    expect(() => readIdToken('a.!!!.c')).toThrow(IdentityError)
    expect(() => readIdToken(idToken({ email: 'a@b.c' }))).toThrow(/names no account/)
    expect(() => readIdToken(idToken({ sub: '1' }))).toThrow(/names no account/)
  })
})
