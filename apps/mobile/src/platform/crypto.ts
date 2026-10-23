import { CryptoDigestAlgorithm, digest, getRandomValues } from 'expo-crypto'

/**
 * Hermes ships no Web Crypto, and the sign-in flow needs two pieces of it:
 * random bytes for the PKCE verifier and SHA-256 for its challenge. Filling
 * those two in from the platform's own implementation lets the shared auth
 * code run here unchanged instead of growing a second, React Native-only path.
 *
 * Imported for its effect, before anything that signs in.
 */
const global = globalThis as { crypto?: Partial<Crypto> }
const existing = global.crypto ?? {}

if (!existing.subtle?.digest || !existing.getRandomValues) {
  global.crypto = {
    ...existing,
    getRandomValues: (<T extends ArrayBufferView | null>(array: T) => getRandomValues(array as never) as T) as Crypto['getRandomValues'],
    subtle: {
      ...(existing.subtle ?? {}),
      digest: async (algorithm: AlgorithmIdentifier, data: BufferSource) => {
        const name = typeof algorithm === 'string' ? algorithm : algorithm.name
        if (name.toUpperCase() !== 'SHA-256') throw new Error(`Only SHA-256 is available here, not ${name}`)
        return digest(CryptoDigestAlgorithm.SHA256, data)
      },
    } as SubtleCrypto,
  }
}
