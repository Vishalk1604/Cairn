import { createPkce, webCrypto } from '@cairn/auth'
import { beforeEach, describe, expect, it } from 'vitest'
import { handle } from '../src/app'
import { allowedRedirect } from '../src/auth'
import { open } from '../src/crypto'
import { resetKeyCache } from '../src/firebase'
import { refreshContext } from '../src/session'
import { FakeCloud, MemoryStore, testEnv } from './fakes'
import { firebaseSigner } from './signer'

const env = testEnv()
const NOW = Date.UTC(2026, 9, 27, 4)
const PHONE = 'io.github.vishalk1604.cairn:/oauth2redirect'
const IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile']
const DRIVE = 'https://www.googleapis.com/auth/drive.file'
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly'
const CLASSROOM = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
]
const FILES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly']

const signer = await firebaseSigner()
let cloud: FakeCloud
let store: MemoryStore

function call(path: string, init: RequestInit = {}) {
  const fetch = async (input: string | Request, i?: RequestInit) =>
    String(input).includes('securetoken@system.gserviceaccount.com') ? signer.keys() : cloud.fetch(input, i)
  return handle(new Request(`https://cairn.test${path}`, init), env, { fetch, store, now: () => NOW })
}

async function signedIn(uid: string, path: string, init: RequestInit = {}) {
  return call(path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await signer.token(uid, NOW)}` } })
}

/** Runs the whole browser round trip, as the app and Google would. */
async function consent(options: { email: string; scopes: string[]; want: string; ticket?: string; redirect?: string }) {
  const pkce = await createPkce(webCrypto)
  const redirect = options.redirect ?? PHONE
  const query = new URLSearchParams({ redirect, state: 'app-state', challenge: pkce.challenge, want: options.want, ...(options.ticket ? { ticket: options.ticket } : {}) })
  const start = await call(`/auth/start?${query}`)
  expect(start.status).toBe(302)
  const google = new URL(start.headers.get('Location')!)
  cloud.codes.set('google-code', { email: options.email, scopes: options.scopes, refresh: `refresh-${options.email}` })
  const back = await call(`/auth/callback?code=google-code&state=${encodeURIComponent(google.searchParams.get('state')!)}`)
  expect(back.status).toBe(302)
  const location = new URL(back.headers.get('Location')!.replace(PHONE, 'https://app.invalid/'))
  return { google, location, verifier: pkce.verifier, challenge: pkce.challenge }
}

beforeEach(() => {
  cloud = new FakeCloud()
  store = new MemoryStore()
  resetKeyCache()
})

describe('redirects', () => {
  it('sends the browser back only to the app', () => {
    expect(allowedRedirect(PHONE)).toBe(true)
    expect(allowedRedirect('http://127.0.0.1:53123')).toBe(true)
    expect(allowedRedirect('http://127.0.0.1:53123/')).toBe(true)
    expect(allowedRedirect('https://evil.example/steal')).toBe(false)
    expect(allowedRedirect('http://127.0.0.1.evil.example:80')).toBe(false)
    expect(allowedRedirect('com.evil.app:/oauth2redirect')).toBe(false)
  })
})

describe('signing in through the Worker', () => {
  it('asks Google for what was wanted, keeps the refresh token sealed and hands the app a one-time code', async () => {
    const { google, location, verifier } = await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE], want: 'drive' })
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(google.searchParams.get('redirect_uri')).toBe('https://cairn.test/auth/callback')
    expect(google.searchParams.get('access_type')).toBe('offline')
    expect(google.searchParams.get('include_granted_scopes')).toBe('true')
    expect(google.searchParams.get('scope')!.split(' ').sort()).toEqual([...IDENTITY, DRIVE].sort())
    // Nothing about the app's request can be read in the state Google carries.
    expect(google.searchParams.get('state')).not.toContain('oauth2redirect')

    expect(location.searchParams.get('state')).toBe('app-state')
    const code = location.searchParams.get('code')!
    const account = (await store.account('uid-me', 'me@gmail.com'))!
    expect(account).toMatchObject({ role: 'owner', watchMail: false })
    expect(account.refresh).not.toContain('refresh-me@gmail.com')
    expect(await open(env, account.refresh, refreshContext('uid-me', 'me@gmail.com'))).toBe('refresh-me@gmail.com')
    expect(cloud.docs.get('users/uid-me/settings/accounts')).toMatchObject({ accounts: [{ email: 'me@gmail.com', role: 'owner', services: ['drive'] }], ai: { on: false } })

    const wrong = await call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier: 'not-the-verifier-not-the-verifier-not-the-v' }) })
    expect(wrong.status).toBe(400)
  })

  it('trades the code once, and only for the app that started', async () => {
    const { location, verifier } = await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE], want: 'drive' })
    const code = location.searchParams.get('code')!
    const traded = await call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })
    expect(traded.status).toBe(200)
    const body = (await traded.json()) as { uid: string; email: string; idToken: string }
    expect(body).toMatchObject({ uid: 'uid-me', email: 'me@gmail.com' })
    expect(body.idToken.split('.')).toHaveLength(3)
    const again = await call('/auth/exchange', { method: 'POST', body: JSON.stringify({ code, verifier }) })
    expect(again.status).toBe(400)
  })

  it('joins a second account to the person with a ticket, and switches reading on with the grant', async () => {
    await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE], want: 'drive' })
    const ticket = ((await (await signedIn('uid-me', '/auth/ticket', { method: 'POST' })).json()) as { ticket: string }).ticket
    const { location } = await consent({ email: 'me@college.edu', scopes: [...IDENTITY, GMAIL, ...CLASSROOM], want: 'mail,classroom', ticket })
    expect(location.searchParams.get('code')).toBeTruthy()
    expect(await store.account('uid-me', 'me@college.edu')).toMatchObject({ role: 'source', watchMail: true, watchClassroom: true })
    // It did not become a person of its own.
    expect(await store.user('uid-college')).toBeNull()
    expect((cloud.docs.get('users/uid-me/settings/accounts') as { accounts: unknown[] }).accounts).toHaveLength(2)
  })

  it('keeps a wider grant when the computer signs in asking for less', async () => {
    await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE, GMAIL], want: 'drive,mail' })
    cloud.codes.clear()
    await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE], want: 'drive', redirect: 'http://127.0.0.1:50123' })
    expect((await store.account('uid-me', 'me@gmail.com'))!.scopes).toContain(GMAIL)
  })

  it('refuses links that would send the code anywhere else', async () => {
    const response = await call(`/auth/start?redirect=${encodeURIComponent('https://evil.example')}&state=s&challenge=${'a'.repeat(43)}`)
    expect(response.status).toBe(400)
  })
})

describe('the apps’ requests', () => {
  beforeEach(async () => {
    await consent({ email: 'me@gmail.com', scopes: [...IDENTITY, DRIVE], want: 'drive' })
    const ticket = ((await (await signedIn('uid-me', '/auth/ticket', { method: 'POST' })).json()) as { ticket: string }).ticket
    cloud.codes.clear()
    await consent({ email: 'me@college.edu', scopes: [...IDENTITY, GMAIL, ...CLASSROOM], want: 'mail,classroom', ticket })
    for (const email of ['me@gmail.com', 'me@college.edu']) {
      const row = (await store.account('uid-me', email))!
      cloud.accounts.set(email, { historyId: '1', added: [], messages: {}, courses: [], refresh: `refresh-${email}`, scopes: row.scopes })
    }
  })

  it('need a Firebase sign-in', async () => {
    expect((await call('/accounts')).status).toBe(401)
    expect((await call('/accounts', { headers: { Authorization: 'Bearer nonsense' } })).status).toBe(401)
  })

  it('hand out tokens narrowed to their purpose, for the caller’s own accounts only', async () => {
    const drive = await signedIn('uid-me', '/token?account=me%40gmail.com&purpose=drive')
    expect(drive.status).toBe(200)
    const refresh = cloud.calls.filter((c) => c.url === 'https://oauth2.googleapis.com/token').at(-1)!
    expect(new URLSearchParams(refresh.body).get('scope')).toBe(DRIVE)

    const files = await signedIn('uid-me', '/token?account=me%40college.edu&purpose=classroomFiles')
    expect(files.status).toBe(403)
    expect(await files.json()).toMatchObject({ error: 'consent' })

    const someoneElse = await signedIn('uid-other', '/token?account=me%40gmail.com&purpose=drive')
    expect(someoneElse.status).toBe(404)
  })

  it('list accounts, and change what is read', async () => {
    const listed = (await (await signedIn('uid-me', '/accounts')).json()) as { accounts: { email: string; services: string[]; watch: unknown }[] }
    expect(listed.accounts.map((a) => [a.email, a.services])).toEqual([
      ['me@gmail.com', ['drive']],
      ['me@college.edu', ['mail', 'classroom', 'announcements']],
    ])
    await signedIn('uid-me', '/accounts', { method: 'POST', body: JSON.stringify({ account: 'me@college.edu', watch: { mail: false } }) })
    expect(await store.account('uid-me', 'me@college.edu')).toMatchObject({ watchMail: false, watchClassroom: true })
  })

  it('disconnect a read-only account, giving its permission back, but never the owner', async () => {
    expect((await signedIn('uid-me', '/accounts?account=me%40gmail.com', { method: 'DELETE' })).status).toBe(400)
    const gone = await signedIn('uid-me', '/accounts?account=me%40college.edu', { method: 'DELETE' })
    expect(gone.status).toBe(200)
    expect(await store.account('uid-me', 'me@college.edu')).toBeNull()
    expect(cloud.calls.some((c) => c.url === 'https://oauth2.googleapis.com/revoke' && c.body === `token=${encodeURIComponent('refresh-me@college.edu')}`)).toBe(true)
  })

  it('keep the NVIDIA key sealed in the Worker, never in Firestore', async () => {
    const key = 'nvapi-0123456789abcdefghijKLMNOP'
    const saved = await signedIn('uid-me', '/setup/ai', { method: 'POST', body: JSON.stringify({ setup: { key, model: 'openai/gpt-oss-20b' } }) })
    expect(await saved.json()).toEqual({ on: true, preferred: 'GPT-OSS 20B' })
    expect((await store.user('uid-me'))!.ai).not.toContain(key)
    expect(JSON.stringify([...cloud.docs.values()])).not.toContain('nvapi-')
    expect(cloud.docs.get('users/uid-me/settings/accounts')).toMatchObject({ ai: { on: true } })

    expect((await signedIn('uid-me', '/setup/ai', { method: 'POST', body: JSON.stringify({ setup: { key: 'sk-not-nvidia' } }) })).status).toBe(400)
    await signedIn('uid-me', '/setup/ai', { method: 'POST', body: JSON.stringify({ setup: null }) })
    expect((await store.user('uid-me'))!.ai).toBeNull()
  })

  it('register a phone for push, with its time zone', async () => {
    await signedIn('uid-me', '/push/register', { method: 'POST', body: JSON.stringify({ token: 'fcm-token-0123456789abcdef', timeZone: 'Asia/Kolkata' }) })
    expect(await store.pushTokens('uid-me')).toEqual(['fcm-token-0123456789abcdef'])
    expect((await store.user('uid-me'))!.timeZone).toBe('Asia/Kolkata')
  })

  it('check now, when asked', async () => {
    const response = await signedIn('uid-me', '/sync', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ checkedAt: NOW, found: 0 })
    expect(cloud.calls.some((c) => c.url.includes('/gmail/v1/users/me/profile'))).toBe(true)
  })

  it('forget everything on request', async () => {
    await signedIn('uid-me', '/me', { method: 'DELETE' })
    expect(await store.user('uid-me')).toBeNull()
    expect(await store.accounts('uid-me')).toEqual([])
  })
})


