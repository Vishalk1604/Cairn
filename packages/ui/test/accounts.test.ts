import { WorkerClient, type AccountsDoc } from '@cairn/sync'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_BLOCKED } from '@cairn/sync'
import { accountProblem, accountsOf, consentThroughWorker, describeReading, fileReaders, owner, reading, sources } from '../src'

// This package takes no runtime's type library; Node has URL all the same.
declare const URL: { new (url: string): { origin: string; pathname: string; searchParams: { get(name: string): string | null } } }

const doc: AccountsDoc = {
  accounts: [
    { email: 'me@gmail.com', role: 'owner', services: ['drive', 'mail'], watch: { mail: false, classroom: false } },
    { email: 'me@college.edu', role: 'source', services: ['mail', 'classroom', 'files'], watch: { mail: true, classroom: true } },
  ],
  updatedAt: 1,
}

describe('accounts', () => {
  it('tell the owner from the accounts only read', () => {
    const all = accountsOf(doc)
    expect(owner(all)?.email).toBe('me@gmail.com')
    expect(sources(all).map((a) => a.email)).toEqual(['me@college.edu'])
    expect(accountsOf(null)).toEqual([])
  })

  it('say what is read: granted and chosen', () => {
    const [mine, college] = accountsOf(doc)
    expect(reading(mine!, 'mail')).toBe(false)
    expect(reading(college!, 'classroom')).toBe(true)
    expect(describeReading(mine!)).toBe('nothing yet')
    expect(describeReading(college!)).toBe('Gmail and Classroom')
    expect(fileReaders(accountsOf(doc)).map((a) => a.email)).toEqual(['me@college.edu'])
  })

  it('count Classroom read from its emails as read, and do not call the college\'s choice an error', () => {
    const blocked = { email: 'me@college.edu', role: 'source' as const, services: ['mail' as const, 'classroom' as const], watch: { mail: false, classroom: true }, problem: CLASSROOM_BLOCKED, classroomVia: 'email' as const }
    expect(reading(blocked, 'classroom')).toBe(true)
    expect(describeReading(blocked)).toBe('Classroom (from email)')
    expect(accountProblem(blocked)).toBeUndefined()
    expect(accountProblem({ ...blocked, problem: 'Google signed Cairn out of me@college.edu.' })).toMatch(/signed Cairn out/)
    // Without the permission at all, it is still read, from the emails.
    expect(reading({ ...blocked, services: ['mail'], problem: undefined }, 'classroom')).toBe(true)
  })
})

describe('consentThroughWorker', () => {
  function worker(responses: Record<string, unknown>) {
    const calls: { url: string; body?: unknown }[] = []
    const client = new WorkerClient({
      url: 'https://cairn.test/',
      idToken: async () => 'firebase-token',
      fetchFn: async (url, init) => {
        calls.push({ url, ...(init?.body ? { body: JSON.parse(init.body) } : {}) })
        const path = new URL(url).pathname
        return { ok: true, status: 200, json: async () => responses[path] }
      },
    })
    return { client, calls }
  }

  it('sends the browser to the Worker and trades the code it gets back, with its verifier', async () => {
    const { client, calls } = worker({ '/auth/exchange': { uid: 'u1', email: 'me@gmail.com', idToken: 'google-id' } })
    let opened = ''
    const platform = {
      authorize: async (build: (redirect: string) => string) => {
        opened = build('io.github.vishalk1604.cairn:/oauth2redirect')
        const state = new URL(opened).searchParams.get('state')
        return `io.github.vishalk1604.cairn:/oauth2redirect?code=one-time&state=${state}`
      },
    }
    const result = await consentThroughWorker(platform, client, { want: ['drive'] })
    expect(result).toEqual({ uid: 'u1', email: 'me@gmail.com', idToken: 'google-id' })
    const url = new URL(opened)
    expect(url.origin + url.pathname).toBe('https://cairn.test/auth/start')
    expect(url.searchParams.get('want')).toBe('drive')
    expect(url.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(calls).toHaveLength(1)
    expect((calls[0]!.body as { code: string; verifier: string }).code).toBe('one-time')
    expect((calls[0]!.body as { verifier: string }).verifier).toHaveLength(43)
  })

  it('joins a grant to the signed-in person with a ticket, and checks it was the right account', async () => {
    const { client, calls } = worker({ '/auth/ticket': { ticket: 't' }, '/auth/exchange': { uid: 'u1', email: 'someone@else.com' } })
    let opened = ''
    const platform = {
      authorize: async (build: (redirect: string) => string) => {
        opened = build('http://127.0.0.1:5000')
        return `http://127.0.0.1:5000/?code=c&state=${new URL(opened).searchParams.get('state')}`
      },
    }
    await expect(consentThroughWorker(platform, client, { want: ['files'], hint: 'me@college.edu', link: true })).rejects.toThrow(/That was someone@else.com, not me@college.edu/)
    expect(new URL(opened).searchParams.get('ticket')).toBe('t')
    expect(new URL(opened).searchParams.get('hint')).toBe('me@college.edu')
    expect(calls[0]!.url).toBe('https://cairn.test/auth/ticket')
  })

  it('says what went wrong in words', async () => {
    const { client } = worker({})
    const platform = { authorize: async () => 'http://127.0.0.1:5000/?error=no_refresh_token&state=x' }
    await expect(consentThroughWorker(platform, client, { want: ['mail'] })).rejects.toThrow(/long-term permission/)
    const denied = { authorize: async (build: (r: string) => string) => `http://127.0.0.1:5000/?error=access_denied&state=${new URL(build('http://127.0.0.1:5000')).searchParams.get('state')}` }
    await expect(consentThroughWorker(denied, client, { want: ['mail'] })).rejects.toThrow(/turned down/)
  })
})
