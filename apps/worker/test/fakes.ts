import { decodeFields, encodeFields } from '../src/firestore'
import type { Env } from '../src/env'
import type { AccountRow, Store, UserRow } from '../src/store'

/** The Store, on maps. */
export class MemoryStore implements Store {
  users = new Map<string, UserRow>()
  rows = new Map<string, AccountRow>()
  tokens = new Map<string, { token: string; expiresAt: number }>()
  codes = new Map<string, { payload: string; expiresAt: number }>()
  push = new Map<string, { uid: string; platform: string; updatedAt: number }>()
  metas = new Map<string, { value: string; expiresAt: number }>()

  async user(uid: string) {
    const u = this.users.get(uid)
    return u ? { ...u } : null
  }
  async putUser(uid: string, email: string, now: number) {
    const u = this.users.get(uid)
    this.users.set(uid, u ? { ...u, email } : { uid, email, timeZone: null, ai: null, state: null, runningUntil: 0, createdAt: now })
  }
  async countUsers() {
    return this.users.size
  }
  async userIds() {
    return [...new Set([...this.rows.values()].map((r) => r.uid))].sort()
  }
  async setAi(uid: string, sealed: string | null) {
    this.users.get(uid)!.ai = sealed
  }
  async setTimeZone(uid: string, zone: string) {
    this.users.get(uid)!.timeZone = zone
  }
  async claim(uid: string, until: number, now: number) {
    const u = this.users.get(uid)
    if (!u || u.runningUntil > now) return false
    u.runningUntil = until
    return true
  }
  async finish(uid: string, state: string | null) {
    const u = this.users.get(uid)!
    u.runningUntil = 0
    if (state !== null) u.state = state
  }
  async forget(uid: string) {
    this.users.delete(uid)
    for (const [k, r] of this.rows) if (r.uid === uid) this.rows.delete(k)
    for (const [k, p] of this.push) if (p.uid === uid) this.push.delete(k)
  }
  async accounts(uid: string) {
    return [...this.rows.values()]
      .filter((r) => r.uid === uid)
      .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.createdAt - b.createdAt))
      .map((r) => ({ ...r }))
  }
  async account(uid: string, email: string) {
    const r = this.rows.get(`${uid}/${email}`)
    return r ? { ...r } : null
  }
  async putAccount(row: AccountRow) {
    this.rows.set(`${row.uid}/${row.email}`, { ...row })
  }
  async deleteAccount(uid: string, email: string) {
    this.rows.delete(`${uid}/${email}`)
  }
  async token(uid: string, email: string, purpose: string) {
    return this.tokens.get(`${uid}/${email}/${purpose}`) ?? null
  }
  async putToken(uid: string, email: string, purpose: string, token: string, expiresAt: number) {
    this.tokens.set(`${uid}/${email}/${purpose}`, { token, expiresAt })
  }
  async dropTokens(uid: string, email: string) {
    for (const k of this.tokens.keys()) if (k.startsWith(`${uid}/${email}/`)) this.tokens.delete(k)
  }
  async putCode(code: string, payload: string, expiresAt: number) {
    this.codes.set(code, { payload, expiresAt })
  }
  async takeCode(code: string, now: number) {
    const c = this.codes.get(code)
    this.codes.delete(code)
    return c && c.expiresAt >= now ? c.payload : null
  }
  async pushTokens(uid: string) {
    return [...this.push.entries()].filter(([, p]) => p.uid === uid).map(([t]) => t)
  }
  async putPush(token: string, uid: string, platform: string, now: number) {
    this.push.set(token, { uid, platform, updatedAt: now })
  }
  async deletePush(token: string) {
    this.push.delete(token)
  }
  async meta(key: string, now: number) {
    const m = this.metas.get(key)
    return m && m.expiresAt > now ? m.value : null
  }
  async putMeta(key: string, value: string, expiresAt: number) {
    this.metas.set(key, { value, expiresAt })
  }
}

export function testEnv(over: Partial<Env> = {}): Env {
  return {
    DB: null as unknown as D1Database,
    PUBLIC_URL: 'https://cairn.test',
    GOOGLE_CLIENT_ID: 'web-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'shh',
    FIREBASE_API_KEY: 'api-key',
    FIREBASE_PROJECT_ID: 'cairn-test',
    FCM_SERVICE_ACCOUNT: '',
    ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i * 7 + 1))),
    ...over,
  }
}

function b64url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** What Google's token endpoint says about an account: an unsigned ID token is enough, since nothing checks its signature. */
export function googleIdToken(email: string, sub = `sub-${email}`): string {
  return `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify({ sub, email, email_verified: true }))}.x`
}

export async function serviceAccountJson(): Promise<string> {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const der = new Uint8Array((await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer)
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der))}\n-----END PRIVATE KEY-----\n`
  return JSON.stringify({ client_email: 'push@cairn-test.iam.gserviceaccount.com', private_key: pem, project_id: 'cairn-test' })
}

type Json = Record<string, unknown>

export interface GmailMessageFixture {
  id: string
  from: string
  subject: string
  snippet?: string
  body?: string
  labelIds?: string[]
  internalDate: number
}

export interface CourseFixture {
  id: string
  name: string
  work: { id: string; title: string; description?: string; creationTime: string; dueDate?: { year: number; month: number; day: number }; dueTime?: { hours?: number; minutes?: number } }[]
  submitted: string[]
  announcements: { id: string; text: string; creationTime: string }[]
}

export interface AccountFixture {
  historyId: string
  /** Ids added since any history id. */
  added: { id: string; labelIds?: string[] }[]
  messages: Record<string, GmailMessageFixture>
  courses: CourseFixture[]
  /** The refresh token Google accepts for it. */
  refresh: string
  scopes: string[]
  /** Set when the college keeps Classroom's API from apps: every Classroom call is refused with it. */
  classroomRefusal?: { status: number; reason: string; message: string }
}

/**
 * Google, Firestore, NVIDIA and FCM behind one fetch: enough of each for a
 * check to run end to end, with every request logged.
 */
export class FakeCloud {
  docs = new Map<string, Json>()
  calls: { method: string; url: string; body?: string }[] = []
  accounts = new Map<string, AccountFixture>()
  pushes: Json[] = []
  /** Data-only pushes, which show nothing on the phone. */
  silent: Json[] = []
  /** What the model answers, by message subject; a function may throw or wait. */
  triage: (prompt: string) => Promise<Json | null> = async () => null
  /** Firebase uid for each Google account. */
  uidOf = (email: string) => `uid-${email.split('@')[0]}`
  /** Authorization codes Google will accept, and what they grant. */
  codes = new Map<string, { email: string; scopes: string[]; refresh?: string }>()
  /** Refresh tokens handed out through codes. */
  issued = new Map<string, { email: string; scopes: string[] }>()

  fetch = async (input: string | Request, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.url
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? init.body : undefined
    this.calls.push({ method, url, ...(body !== undefined ? { body } : {}) })
    const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
    const u = new URL(url)

    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/token') {
      const form = new URLSearchParams(body)
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:jwt-bearer') return reply({ access_token: 'fcm-access', expires_in: 3600 })
      if (form.get('grant_type') === 'authorization_code') {
        const grant = this.codes.get(form.get('code') ?? '')
        if (!grant) return reply({ error: 'invalid_grant' }, 400)
        if (grant.refresh) this.issued.set(grant.refresh, { email: grant.email, scopes: grant.scopes })
        return reply({
          access_token: `access-${grant.email}`,
          ...(grant.refresh ? { refresh_token: grant.refresh } : {}),
          expires_in: 3600,
          scope: grant.scopes.join(' '),
          id_token: googleIdToken(grant.email),
        })
      }
      const refresh = form.get('refresh_token') ?? ''
      const entry = [...this.accounts.entries()].find(([, a]) => a.refresh === refresh)
      const holder = entry ? { email: entry[0], scopes: entry[1].scopes } : this.issued.get(refresh)
      if (!holder) return reply({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)
      const scope = form.get('scope') ?? holder.scopes.join(' ')
      return reply({ access_token: `access-${holder.email}`, expires_in: 3600, scope, id_token: googleIdToken(holder.email) })
    }
    if (u.host === 'oauth2.googleapis.com' && u.pathname === '/revoke') return reply({})

    if (u.host === 'identitytoolkit.googleapis.com') {
      const postBody = new URLSearchParams((JSON.parse(body!) as { postBody: string }).postBody)
      const payload = JSON.parse(atob(postBody.get('id_token')!.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as { email: string }
      const uid = this.uidOf(payload.email)
      return reply({ localId: uid, idToken: `fb-${uid}`, expiresIn: '3600', email: payload.email })
    }

    if (u.host === 'gmail.googleapis.com') return this.gmail(u, init, reply)
    if (u.host === 'classroom.googleapis.com') return this.classroom(u, init, reply)
    if (u.host === 'firestore.googleapis.com') return this.firestore(u, method, body, init, reply)

    if (u.host === 'integrate.api.nvidia.com') {
      const payload = JSON.parse(body!) as { input?: { content: string }[]; messages?: { content: string }[] }
      const prompt = (payload.input ?? payload.messages ?? []).map((m) => m.content).join('\n')
      const answer = await this.triage(prompt)
      if (!answer) return reply({ error: 'busy' }, 503)
      const text = JSON.stringify(answer)
      return reply(u.pathname.endsWith('/responses') ? { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] } : { choices: [{ message: { content: text } }] })
    }

    if (u.host === 'fcm.googleapis.com') {
      const message = (JSON.parse(body!) as { message: Json }).message
      ;(message.notification ? this.pushes : this.silent).push(message)
      return reply({ name: 'projects/x/messages/1' })
    }
    return reply({ error: `No fake for ${url}` }, 404)
  }

  private who(init: RequestInit): string {
    const auth = (init.headers as Record<string, string> | undefined)?.Authorization ?? ''
    return auth.replace(/^Bearer access-/, '')
  }

  private gmail(u: URL, init: RequestInit, reply: (v: unknown, s?: number) => Response): Response {
    const account = this.accounts.get(this.who(init))
    if (!account) return reply({ error: { message: 'no' } }, 401)
    const path = u.pathname.replace('/gmail/v1/users/me', '')
    if (path === '/profile') return reply({ historyId: account.historyId })
    if (path === '/history') {
      return reply({ history: [{ messagesAdded: account.added.map((m) => ({ message: m })) }], historyId: account.historyId })
    }
    const id = path.replace('/messages/', '')
    const m = account.messages[id]
    if (!m) return reply({ error: { message: 'gone' } }, 404)
    const full = u.searchParams.get('format') === 'full'
    return reply({
      id: m.id,
      threadId: `t-${m.id}`,
      labelIds: m.labelIds ?? ['INBOX'],
      snippet: m.snippet ?? m.subject,
      internalDate: String(m.internalDate),
      payload: {
        headers: [
          { name: 'From', value: m.from },
          { name: 'Subject', value: m.subject },
        ],
        ...(full ? { mimeType: 'text/plain', body: { data: btoa(unescape(encodeURIComponent(m.body ?? ''))).replace(/\+/g, '-').replace(/\//g, '_') } } : {}),
      },
    })
  }

  private classroom(u: URL, init: RequestInit, reply: (v: unknown, s?: number) => Response): Response {
    const account = this.accounts.get(this.who(init))
    if (!account) return reply({ error: { message: 'no' } }, 401)
    const refusal = account.classroomRefusal
    if (refusal) return reply({ error: { code: refusal.status, status: 'PERMISSION_DENIED', message: refusal.message, details: [{ reason: refusal.reason }] } }, refusal.status)
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts.length === 2) return reply({ courses: account.courses.map(({ id, name }) => ({ id, name })) })
    const course = account.courses.find((c) => c.id === decodeURIComponent(parts[2]!))
    if (!course) return reply({ error: { message: 'no course' } }, 404)
    if (parts[3] === 'announcements') return reply({ announcements: course.announcements.map((a) => ({ ...a, courseId: course.id })) })
    if (parts[3] === 'courseWork' && parts[5] === 'studentSubmissions') {
      return reply({ studentSubmissions: course.submitted.map((id) => ({ courseWorkId: id, state: 'TURNED_IN' })) })
    }
    return reply({ courseWork: course.work.map((w) => ({ ...w, courseId: course.id })) })
  }

  private firestore(u: URL, method: string, body: string | undefined, init: RequestInit, reply: (v: unknown, s?: number) => Response): Response {
    const auth = (init.headers as Record<string, string>).Authorization ?? ''
    if (!auth.startsWith('Bearer fb-')) return reply({ error: { message: 'unauthenticated' } }, 401)
    const root = '/v1/projects/cairn-test/databases/(default)/documents'
    const path = decodeURIComponent(u.pathname)
    const strip = (name: string) => name.slice('projects/cairn-test/databases/(default)/documents/'.length)
    // As Firestore does: batchWrite needs admin credentials, which a person's
    // ID token is not.
    if (path === `${root}:batchWrite`) return reply({ error: { message: 'Batch writes require admin authentication.' } }, 403)
    if (path === `${root}:commit`) {
      const { writes } = JSON.parse(body!) as { writes: { update?: { name: string; fields: never }; delete?: string; updateMask?: { fieldPaths: string[] }; currentDocument?: { exists: boolean } }[] }
      // A commit is all or nothing.
      if (writes.some((w) => w.currentDocument && w.currentDocument.exists !== this.docs.has(strip(w.update?.name ?? w.delete!)))) {
        return reply({ error: { message: 'FAILED_PRECONDITION' } }, 400)
      }
      writes.forEach((w) => {
        const name = strip(w.update?.name ?? w.delete!)
        if (w.delete) {
          this.docs.delete(name)
          return
        }
        const data = decodeFields(w.update!.fields)
        if (w.updateMask) {
          const next = { ...(this.docs.get(name) ?? {}) }
          for (const field of w.updateMask.fieldPaths) {
            if (field in data) next[field] = data[field]
            else delete next[field]
          }
          this.docs.set(name, next)
        } else {
          this.docs.set(name, data)
        }
      })
      return reply({ writeResults: writes.map(() => ({})) })
    }
    if (path === `${root}:batchGet`) {
      const { documents } = JSON.parse(body!) as { documents: string[] }
      return reply(documents.map((name) => (this.docs.has(strip(name)) ? { found: { name, fields: encodeFields(this.docs.get(strip(name))!) } } : { missing: name })))
    }
    if (path.endsWith(':runQuery')) {
      const parent = path.slice(root.length + 1, -':runQuery'.length)
      const query = (JSON.parse(body!) as { structuredQuery: { from: { collectionId: string }[]; where: { compositeFilter: { filters: { fieldFilter: { field: { fieldPath: string }; op: string; value: { integerValue: string } } }[] } } } })
        .structuredQuery
      const collection = `${parent}/${query.from[0]!.collectionId}/`
      const [low, high] = query.where.compositeFilter.filters.map((f) => Number(f.fieldFilter.value.integerValue))
      const field = query.where.compositeFilter.filters[0]!.fieldFilter.field.fieldPath
      const found = [...this.docs.entries()].filter(([name, doc]) => name.startsWith(collection) && !name.slice(collection.length).includes('/') && (doc[field] as number) >= low! && (doc[field] as number) < high!)
      return reply(found.length ? found.map(([, doc]) => ({ document: { fields: encodeFields(doc) } })) : [{}])
    }
    if (method === 'GET') {
      const doc = this.docs.get(path.slice(root.length + 1))
      return doc ? reply({ fields: encodeFields(doc) }) : reply({ error: { message: 'not found' } }, 404)
    }
    return reply({ error: { message: 'unexpected' } }, 400)
  }
}
