import { describe, expect, it } from 'vitest'
import { WorkerClient } from '../src/worker'

function client(expiresIn: number) {
  const asked: string[] = []
  const worker = new WorkerClient({
    url: 'https://cairn.test',
    idToken: async () => 'fb-token',
    fetchFn: async (url) => {
      asked.push(url)
      const body = { accessToken: `t${asked.length}`, expiresAt: Date.now() + expiresIn }
      return { ok: true, status: 200, json: async () => body }
    },
  })
  return { worker, asked }
}

describe('WorkerClient.token', () => {
  it('keeps a token while it has time left, for each account and purpose', async () => {
    const { worker, asked } = client(60 * 60_000)
    const [a, b] = await Promise.all([worker.token('me@x.com', 'drive'), worker.token('me@x.com', 'drive')])
    expect(a.accessToken).toBe('t1')
    expect(b.accessToken).toBe('t1')
    expect((await worker.token('me@x.com', 'drive')).accessToken).toBe('t1')
    expect((await worker.token('me@x.com', 'classroomFiles')).accessToken).toBe('t2')
    expect(asked).toHaveLength(2)
  })

  it('asks again when the token is about to run out, or after forgetting', async () => {
    const { worker, asked } = client(2 * 60_000)
    await worker.token('me@x.com', 'drive')
    await worker.token('me@x.com', 'drive')
    expect(asked).toHaveLength(2)

    const long = client(60 * 60_000)
    await long.worker.token('me@x.com', 'drive')
    long.worker.forgetTokens()
    await long.worker.token('me@x.com', 'drive')
    expect(long.asked).toHaveLength(2)
  })
})
