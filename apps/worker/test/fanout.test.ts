import { describe, expect, it } from 'vitest'
import { cron, handle } from '../src/app'
import { split } from '../src/fanout'
import { MemoryStore, testEnv } from './fakes'

const env = testEnv()

function recorder() {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = []
  const fetch = async (input: string | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return new Response('{}')
  }
  return { calls, fetch }
}

async function people(count: number): Promise<MemoryStore> {
  const store = new MemoryStore()
  for (let i = 0; i < count; i++) {
    const uid = `u${String(i).padStart(3, '0')}`
    await store.putUser(uid, `${uid}@x.com`, 0)
    await store.putAccount({ uid, email: `${uid}@x.com`, sub: uid, role: 'owner', scopes: [], refresh: 'x', watchMail: true, watchClassroom: true, problem: null, createdAt: 0 })
  }
  return store
}

describe('split', () => {
  it('makes at most the given number of near-equal groups, in order', () => {
    expect(split([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]])
    expect(split([1, 2], 6)).toEqual([[1], [2]])
  })
})

describe('the cron', () => {
  it('checks a few people one request each', async () => {
    const { calls, fetch } = recorder()
    await cron(env, { fetch, store: await people(3) })
    expect(calls.map((c) => c.url)).toEqual(Array(3).fill('https://cairn.test/internal/run'))
    expect(calls.map((c) => c.body)).toEqual([{ uid: 'u000' }, { uid: 'u001' }, { uid: 'u002' }])
    expect(calls[0]!.headers['X-Cairn-Internal']).toBeTruthy()
  })

  it('hands many people out in six groups, each of which fans out again', async () => {
    const store = await people(100)
    const top = recorder()
    await cron(env, { fetch: top.fetch, store })
    expect(top.calls).toHaveLength(6)
    expect(top.calls.every((c) => c.url === 'https://cairn.test/internal/fan')).toBe(true)
    const groups = top.calls.map((c) => (c.body as { uids: string[] }).uids)
    expect(groups.flat()).toHaveLength(100)
    expect(Math.max(...groups.map((g) => g.length))).toBe(17)

    // One group, seventeen people: six groups again, then single checks.
    const first = top.calls[0]!
    const next = recorder()
    const response = await handle(new Request(first.url, { method: 'POST', headers: first.headers, body: JSON.stringify(first.body) }), env, { fetch: next.fetch, store })
    expect(response.status).toBe(200)
    expect(next.calls).toHaveLength(6)
    const leaf = next.calls[5]!
    const last = recorder()
    await handle(new Request(leaf.url, { method: 'POST', headers: leaf.headers, body: JSON.stringify(leaf.body) }), env, { fetch: last.fetch, store })
    expect(last.calls.map((c) => c.url)).toEqual(Array((leaf.body as { uids: string[] }).uids.length).fill('https://cairn.test/internal/run'))
  })

  it('refuses a fan-out request that did not come from itself', async () => {
    const { fetch } = recorder()
    const response = await handle(new Request('https://cairn.test/internal/run', { method: 'POST', body: '{"uid":"u000"}' }), env, { fetch, store: await people(1) })
    expect(response.status).toBe(403)
    const forged = await handle(new Request('https://cairn.test/internal/fan', { method: 'POST', headers: { 'X-Cairn-Internal': 'guess' }, body: '{"uids":["u000"]}' }), env, { fetch, store: await people(1) })
    expect(forged.status).toBe(403)
  })
})
