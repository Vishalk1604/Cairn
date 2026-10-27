import { describe, expect, it } from 'vitest'
import { fromBase64Url, open, readClaim, seal, SealError, signClaim, toBase64Url } from '../src/crypto'
import { testEnv } from './fakes'

const env = testEnv()
const other = testEnv({ ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))) })

describe('sealing tokens at rest', () => {
  it('opens what it sealed', async () => {
    const sealed = await seal(env, '1//refresh-token', 'refresh:u1:me@x.com')
    expect(sealed).toMatch(/^v1\./)
    expect(sealed).not.toContain('refresh-token')
    expect(await open(env, sealed, 'refresh:u1:me@x.com')).toBe('1//refresh-token')
  })

  it('never seals the same value the same way twice', async () => {
    expect(await seal(env, 'same', 'c')).not.toBe(await seal(env, 'same', 'c'))
  })

  it('refuses a value moved to another row', async () => {
    const sealed = await seal(env, 'token', 'refresh:u1:me@x.com')
    await expect(open(env, sealed, 'refresh:u2:me@x.com')).rejects.toBeInstanceOf(SealError)
  })

  it('refuses a value changed in the database', async () => {
    const sealed = await seal(env, 'token', 'ctx')
    const [v, iv, data] = sealed.split('.')
    const bytes = fromBase64Url(data!)
    bytes[0]! ^= 1
    await expect(open(env, `${v}.${iv}.${toBase64Url(bytes)}`, 'ctx')).rejects.toBeInstanceOf(SealError)
  })

  it('refuses a value sealed under another key', async () => {
    await expect(open(other, await seal(env, 'token', 'ctx'), 'ctx')).rejects.toBeInstanceOf(SealError)
  })

  it('wants a real key', async () => {
    await expect(seal(testEnv({ ENC_KEY: btoa('short') }), 'x', 'c')).rejects.toThrow(/32 random bytes/)
  })
})

describe('signed claims', () => {
  it('reads back a claim for its purpose until it expires', async () => {
    const ticket = await signClaim(env, 'ticket', { uid: 'u1' }, 2000)
    expect(await readClaim(env, 'ticket', ticket, 1000)).toMatchObject({ uid: 'u1' })
    expect(await readClaim(env, 'ticket', ticket, 3000)).toBeNull()
    expect(await readClaim(env, 'other', ticket, 1000)).toBeNull()
  })

  it('refuses a forged one', async () => {
    const ticket = await signClaim(env, 'ticket', { uid: 'u1' }, 2000)
    const [, signature] = ticket.split('.')
    const forged = `${toBase64Url(new TextEncoder().encode(JSON.stringify({ uid: 'u2', p: 'ticket', x: 2000 })))}.${signature}`
    expect(await readClaim(env, 'ticket', forged, 1000)).toBeNull()
    expect(await readClaim(other, 'ticket', ticket, 1000)).toBeNull()
  })
})
