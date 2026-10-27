import { describe, expect, it } from 'vitest'
import { D1Store } from '../src/store'

/**
 * The real SQL, run against SQLite through a stand-in for D1's API. Node's
 * own SQLite arrived in Node 22; on older Node these are skipped.
 */
// Loaded by name: the Worker's own type library has no Node in it.
const load = (name: string) => import(name) as Promise<any>
const { readFileSync } = await load('node:fs')
let sqlite: any = null
try {
  sqlite = await load('node:sqlite')
} catch {
  sqlite = null
}

function fakeD1(): D1Database {
  const db = new sqlite.DatabaseSync(':memory:')
  db.exec(readFileSync(new URL('../migrations/0001_init.sql', (import.meta as unknown as { url: string }).url), 'utf8'))
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (db.prepare(sql).get(...(args as never[])) as unknown) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...(args as never[])).changes) } }),
  })
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: { run(): Promise<unknown> }[]) => {
      db.exec('BEGIN')
      const out = []
      for (const s of statements) out.push(await s.run())
      db.exec('COMMIT')
      return out
    },
  } as unknown as D1Database
}

describe.skipIf(!sqlite)('D1Store', () => {
  it('keeps people and their accounts', async () => {
    const store = new D1Store(fakeD1())
    await store.putUser('u1', 'me@gmail.com', 1)
    await store.putUser('u1', 'me@gmail.com', 2)
    expect(await store.countUsers()).toBe(1)
    const row = { uid: 'u1', email: 'me@gmail.com', sub: 's', role: 'owner' as const, scopes: ['openid', 'email'], refresh: 'sealed', watchMail: true, watchClassroom: false, problem: null, createdAt: 1 }
    await store.putAccount(row)
    await store.putAccount({ ...row, email: 'me@college.edu', role: 'source', createdAt: 2 })
    expect(await store.account('u1', 'me@gmail.com')).toEqual(row)
    expect((await store.accounts('u1')).map((a) => a.email)).toEqual(['me@gmail.com', 'me@college.edu'])
    expect(await store.userIds()).toEqual(['u1'])
    await store.deleteAccount('u1', 'me@college.edu')
    expect(await store.accounts('u1')).toHaveLength(1)
  })

  it('lets one run at a time hold a person', async () => {
    const store = new D1Store(fakeD1())
    await store.putUser('u1', 'me@gmail.com', 1)
    expect(await store.claim('u1', 100, 10)).toBe(true)
    expect(await store.claim('u1', 200, 50)).toBe(false)
    await store.finish('u1', 'sealed-state')
    expect(await store.claim('u1', 200, 50)).toBe(true)
    expect((await store.user('u1'))!.state).toBe('sealed-state')
    // A run that died lets go once its time is up.
    expect(await store.claim('u1', 400, 300)).toBe(true)
  })

  it('hands a one-time code over once', async () => {
    const store = new D1Store(fakeD1())
    await store.putCode('c1', 'payload', 100, 0)
    expect(await store.takeCode('c1', 50)).toBe('payload')
    expect(await store.takeCode('c1', 50)).toBeNull()
    await store.putCode('c2', 'payload', 100, 0)
    expect(await store.takeCode('c2', 150)).toBeNull()
  })

  it('caches tokens, push registrations and settings, and forgets a person entirely', async () => {
    const store = new D1Store(fakeD1())
    await store.putUser('u1', 'me@gmail.com', 1)
    await store.putToken('u1', 'me@gmail.com', 'run', 't1', 10)
    await store.putToken('u1', 'me@gmail.com', 'run', 't2', 20)
    expect(await store.token('u1', 'me@gmail.com', 'run')).toEqual({ token: 't2', expiresAt: 20 })
    await store.putPush('p1', 'u1', 'android', 1)
    expect(await store.pushTokens('u1')).toEqual(['p1'])
    await store.putMeta('k', 'v', 100)
    expect(await store.meta('k', 50)).toBe('v')
    expect(await store.meta('k', 150)).toBeNull()
    await store.setTimeZone('u1', 'Asia/Kolkata')
    await store.setAi('u1', 'sealed-ai')
    expect(await store.user('u1')).toMatchObject({ timeZone: 'Asia/Kolkata', ai: 'sealed-ai' })
    await store.forget('u1')
    expect(await store.user('u1')).toBeNull()
    expect(await store.pushTokens('u1')).toEqual([])
    expect(await store.token('u1', 'me@gmail.com', 'run')).toBeNull()
  })
})
