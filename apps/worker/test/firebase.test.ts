import { beforeEach, describe, expect, it } from 'vitest'
import { toBase64Url } from '../src/crypto'
import { resetKeyCache, verifyIdToken } from '../src/firebase'
import { testEnv } from './fakes'

const env = testEnv()
const NOW = Date.UTC(2026, 9, 27, 12)
const seconds = Math.floor(NOW / 1000)

async function keyPair() {
  return (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
}

const google = await keyPair()
const stranger = await keyPair()
const jwk = { ...((await crypto.subtle.exportKey('jwk', google.publicKey)) as JsonWebKey), kid: 'k1', alg: 'RS256', use: 'sig' }

const part = (value: object) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)))

async function token(claims: Record<string, unknown> = {}, options: { key?: CryptoKey; kid?: string } = {}) {
  const unsigned = `${part({ alg: 'RS256', kid: options.kid ?? 'k1' })}.${part({
    aud: 'cairn-test',
    iss: 'https://securetoken.google.com/cairn-test',
    sub: 'uid-1',
    iat: seconds - 60,
    auth_time: seconds - 60,
    exp: seconds + 3000,
    email: 'me@example.com',
    ...claims,
  })}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', options.key ?? google.privateKey, new TextEncoder().encode(unsigned))
  return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`
}

let keyFetches = 0
const fetchKeys = async () => {
  keyFetches++
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'public, max-age=19000' } })
}

describe('verifyIdToken', () => {
  beforeEach(() => {
    resetKeyCache()
    keyFetches = 0
  })

  it('accepts a token Firebase signed for this project', async () => {
    expect(await verifyIdToken(env, await token(), fetchKeys, NOW)).toEqual({ uid: 'uid-1', email: 'me@example.com' })
  })

  it('keeps Google’s keys for as long as Google says', async () => {
    await verifyIdToken(env, await token(), fetchKeys, NOW)
    await verifyIdToken(env, await token({ exp: seconds + 7200 }), fetchKeys, NOW + 3600_000)
    expect(keyFetches).toBe(1)
  })

  it.each([
    ['another project', { aud: 'someone-else' }],
    ['another issuer', { iss: 'https://securetoken.google.com/someone-else' }],
    ['an expired token', { exp: seconds - 1 }],
    ['a token from the future', { iat: seconds + 3600 }],
    ['nobody', { sub: '' }],
  ])('refuses %s', async (_, claims) => {
    await expect(verifyIdToken(env, await token(claims), fetchKeys, NOW)).rejects.toMatchObject({ status: 401 })
  })

  it('refuses a signature by any other key', async () => {
    await expect(verifyIdToken(env, await token({}, { key: stranger.privateKey }), fetchKeys, NOW)).rejects.toThrow(/not genuine/)
    await expect(verifyIdToken(env, await token({}, { kid: 'k9' }), fetchKeys, NOW)).rejects.toThrow(/key Google does not use/)
  })

  it('refuses what is not a token at all', async () => {
    await expect(verifyIdToken(env, 'nope', fetchKeys, NOW)).rejects.toMatchObject({ status: 401 })
    const [h, p] = (await token()).split('.')
    await expect(verifyIdToken(env, `${h}.${p}.`, fetchKeys, NOW)).rejects.toMatchObject({ status: 401 })
  })
})
