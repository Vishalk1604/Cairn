import { toBase64Url } from '../src/crypto'

/** Stands in for Firebase: a key pair, its public half as Google publishes it, and ID tokens signed with it. */
export async function firebaseSigner(project = 'cairn-test') {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey), kid: 'test-key', alg: 'RS256' }
  const part = (value: object) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
  return {
    keys: () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'max-age=3600' } }),
    async token(uid: string, now: number) {
      const s = Math.floor(now / 1000)
      const unsigned = `${part({ alg: 'RS256', kid: 'test-key' })}.${part({ aud: project, iss: `https://securetoken.google.com/${project}`, sub: uid, iat: s, exp: s + 3600 })}`
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(unsigned))
      return `${unsigned}.${toBase64Url(new Uint8Array(signature))}`
    },
  }
}
