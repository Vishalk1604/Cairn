import { classroomTaskId, type InboxRecord, type MailMessage, type Reminder } from '@cairn/core'
import { MemoryKeyValueStore, openLocalRepositories, type ClassroomFeed, type SettingName } from '@cairn/sync'
import { describe, expect, it } from 'vitest'
import { InboxEngine, readerStatus, type Account, type InboxBackend, type InboxReaders, type Platform } from '../src'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const timers = globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }

const scope = (name: string) => `https://www.googleapis.com/auth/${name}`

const owner: Account = {
  identity: { sub: 'o', email: 'me@gmail.com', emailVerified: true },
  role: 'owner',
  scopes: [scope('gmail.readonly'), scope('classroom.courses.readonly'), scope('classroom.coursework.me.readonly'), scope('classroom.announcements.readonly')],
  refreshToken: 'never-leaves-the-device',
}

/** Firestore, in memory: settings merge one level deep, as the cursors and lease do. */
class FakeCloud implements InboxBackend {
  inbox = new Map<string, InboxRecord>()
  settings = new Map<SettingName, Record<string, unknown>>()
  writes = 0
  private inboxWatchers = new Set<(records: InboxRecord[]) => void>()
  private settingWatchers = new Map<SettingName, Set<(value: unknown) => void>>()

  watchInbox(_uid: string, onChange: (records: InboxRecord[]) => void) {
    this.inboxWatchers.add(onChange)
    onChange([...this.inbox.values()])
    return () => this.inboxWatchers.delete(onChange)
  }
  async writeInbox(_uid: string, records: readonly InboxRecord[]) {
    for (const r of records) this.inbox.set(r.id, clone(r))
    this.writes += records.length
    this.flushInbox()
  }
  async patchInbox(_uid: string, id: string, patch: Partial<InboxRecord>) {
    this.inbox.set(id, { ...this.inbox.get(id)!, ...patch })
    this.writes++
    this.flushInbox()
  }
  async deleteInbox(_uid: string, ids: readonly string[]) {
    for (const id of ids) this.inbox.delete(id)
    this.flushInbox()
  }
  watchSetting<T>(_uid: string, name: SettingName, onChange: (value: T | null) => void) {
    const set = this.settingWatchers.get(name) ?? new Set()
    set.add(onChange as (value: unknown) => void)
    this.settingWatchers.set(name, set)
    onChange((this.settings.get(name) as T) ?? null)
    return () => set.delete(onChange as (value: unknown) => void)
  }
  async writeSetting<T extends object>(_uid: string, name: SettingName, value: T, options: { replace?: boolean } = {}) {
    const current = options.replace ? {} : (this.settings.get(name) ?? {})
    const next: Record<string, unknown> = { ...current }
    for (const [key, v] of Object.entries(value)) {
      const before = next[key]
      next[key] = v && typeof v === 'object' && !Array.isArray(v) && before && typeof before === 'object' ? { ...before, ...v } : v
    }
    this.settings.set(name, clone(next))
    this.writes++
    for (const w of this.settingWatchers.get(name) ?? []) w(this.settings.get(name))
  }
  async deleteSetting(_uid: string, name: SettingName) {
    this.settings.delete(name)
    for (const w of this.settingWatchers.get(name) ?? []) w(null)
  }
  watchPaused(_uid: string, onChange: (paused: Record<string, string[]>) => void) {
    onChange(this.paused)
    return () => {}
  }
  paused: Record<string, string[]> = {}
  private flushInbox() {
    for (const w of this.inboxWatchers) w([...this.inbox.values()].map((r) => clone(r)))
  }
}

const email = (id: string, extra: Partial<MailMessage> = {}): MailMessage => ({
  id,
  account: 'me@gmail.com',
  from: 'Devfolio <hello@devfolio.co>',
  subject: `Mail ${id}`,
  snippet: 'Register before Friday',
  text: 'The full body, which stays on the reading device.',
  receivedAt: 1000,
  ...extra,
})

function fakeGoogle(mail: () => MailMessage[], feed: () => ClassroomFeed = () => ({ work: [], announcements: [], skipped: [] })): InboxReaders & { triaged: string[] } {
  const triaged: string[] = []
  return {
    triaged,
    accessToken: async () => ({ accessToken: 't' }),
    mailCursor: async () => 'h1',
    mailSince: async (_t, _a, cursor) => ({ messages: mail(), cursor: `${cursor}+` }),
    classroomFeed: async () => feed(),
    triageMail: async (_setup, message) => {
      triaged.push(message.id)
      expect(message.text).toBeDefined()
      return { important: true, summary: `About ${message.subject}`, folder: 'Hackathons', model: 'GPT-OSS 20B' }
    },
  }
}

function platformFor(): Platform {
  return {
    name: 'test',
    storage: new MemoryKeyValueStore(),
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    notificationPermission: async () => 'granted',
    requestNotificationPermission: async () => 'granted',
    notify: async () => {},
    authorize: async () => '',
    googleClientId: 'id',
    googleClientSecret: () => undefined,
  }
}

async function device(kind: 'desktop' | 'phone', cloud: FakeCloud, readers: InboxReaders, clock: { now: number }) {
  const { reminders } = await openLocalRepositories(new MemoryKeyValueStore())
  const engine = new InboxEngine({ platform: platformFor(), kind, backend: cloud, readers, poll: false, now: () => clock.now })
  await engine.ready()
  engine.setContext({ userId: 'u', accounts: [owner], reminders })
  return { engine, reminders }
}

const settle = () => new Promise<void>((resolve) => timers.setTimeout(resolve, 0))

describe('InboxEngine', () => {
  it('reads on the computer, stores no body, and writes nothing for mail already stored', async () => {
    const cloud = new FakeCloud()
    const clock = { now: 1_800_000_000_000 }
    let mail: MailMessage[] = []
    const { engine } = await device('desktop', cloud, fakeGoogle(() => mail), clock)
    await settle()
    // The first look only notes where the mailbox is.
    expect(cloud.settings.get('reader')).toMatchObject({ cursors: { o: { mail: 'h1' } }, lease: { kind: 'desktop' } })

    mail = [email('m1'), email('m2')]
    clock.now += 120_000
    await engine.refresh()
    expect([...cloud.inbox.keys()].sort()).toEqual(['m1', 'm2'])
    expect(JSON.stringify([...cloud.inbox.values()])).not.toContain('full body')
    expect(JSON.stringify([...cloud.settings.values()])).not.toContain('never-leaves-the-device')

    const before = cloud.writes
    clock.now += 120_000
    await engine.refresh()
    // Only the claim and the cursor move; both messages are already there.
    expect(cloud.writes - before).toBe(1)
    expect(engine.getState().mail).toHaveLength(2)
  })

  it('leaves the reading to the computer while it is on, and takes over when it goes quiet', async () => {
    const cloud = new FakeCloud()
    const clock = { now: 1_800_000_000_000 }
    const google = fakeGoogle(() => [email('m1')])
    await device('desktop', cloud, google, clock)
    await settle()
    const phoneGoogle = fakeGoogle(() => [email('p1')])
    const { engine: phone } = await device('phone', cloud, phoneGoogle, clock)
    await settle()
    clock.now += 120_000
    await phone.refresh()
    expect(cloud.inbox.has('p1')).toBe(false)
    expect(phone.getState().reader).toBe('desktop')

    // Sync now reads here once, without taking the claim.
    await phone.refresh(true)
    expect(cloud.inbox.has('p1')).toBe(true)
    expect(cloud.settings.get('reader')).toMatchObject({ lease: { kind: 'desktop' } })

    clock.now += 20 * 60_000
    await phone.refresh()
    expect(cloud.settings.get('reader')).toMatchObject({ lease: { kind: 'phone' } })
  })

  it('sorts with the model on whichever device reads, once found and once read', async () => {
    const cloud = new FakeCloud()
    const clock = { now: 1_800_000_000_000 }
    await cloud.writeSetting('u', 'ai', { key: 'nvapi-' + 'x'.repeat(30), updatedAt: 1 })
    let mail: MailMessage[] = []
    const google = fakeGoogle(() => mail)
    const { engine } = await device('desktop', cloud, google, clock)
    await settle()
    expect(engine.getState().ai.on).toBe(true)
    mail = [email('m1')]
    clock.now += 120_000
    await engine.refresh()
    await settle()
    expect(google.triaged).toEqual(['m1'])
    const stored = cloud.inbox.get('m1')!
    expect(stored.triage?.folder).toBe('Hackathons')
    expect(stored.sorting).toBeUndefined()
    expect(engine.getState().folders).toEqual(['Hackathons'])
  })

  it('makes Classroom posts tasks automatically, once across devices', async () => {
    const cloud = new FakeCloud()
    const clock = { now: 1_800_000_000_000 }
    await cloud.writeSetting('u', 'inbox', { autoTasks: true })
    const course = { id: 'c1', name: 'CS301' }
    let feed: ClassroomFeed = { work: [], announcements: [], skipped: [] }
    const google = fakeGoogle(() => [], () => feed)
    const { engine, reminders } = await device('desktop', cloud, google, clock)
    await settle()
    feed = {
      work: [{ course, work: { id: 'w1', courseId: 'c1', title: 'Lab 4', creationTime: new Date(clock.now + 60_000).toISOString(), dueDate: { year: 2027, month: 3, day: 1 } }, submitted: false }],
      announcements: [{ course, announcement: { id: 'a1', courseId: 'c1', text: 'Quiz on Thursday', creationTime: new Date(clock.now + 60_000).toISOString() } }],
      skipped: [],
    }
    clock.now += 120_000
    await engine.refresh()
    await settle()
    const tasks = (await reminders.list({})) as Reminder[]
    expect(tasks.map((t) => t.id).sort()).toEqual([classroomTaskId('w1'), 'mail-classroom-announcement-a1'].sort())
    expect(tasks.find((t) => t.id === classroomTaskId('w1'))?.autoCompleteOn).toBe('classroom-submission')
    expect(cloud.inbox.get('classroom-work-w1')?.tasked).toBe(true)
    expect(engine.getState().classroom).toHaveLength(2)
    expect(engine.getState().mail).toHaveLength(0)

    // Another device with its own task list sees the posts already tasked and makes none.
    const { engine: phone, reminders: phoneTasks } = await device('phone', cloud, fakeGoogle(() => [], () => feed), clock)
    await settle()
    await phone.refresh(true)
    expect(await phoneTasks.list({})).toHaveLength(0)
  })

  it('shares the key, the rules and the switch with every device', async () => {
    const cloud = new FakeCloud()
    const clock = { now: 1_800_000_000_000 }
    const { engine } = await device('phone', cloud, fakeGoogle(() => []), clock)
    await settle()
    await engine.setAiSetup({ key: 'nvapi-' + 'y'.repeat(30) })
    await engine.setAutoTasks(true)
    await engine.setProfile('Hackathons only')
    await settle()
    const { engine: desktop } = await device('desktop', cloud, fakeGoogle(() => []), clock)
    await settle()
    expect(desktop.getState()).toMatchObject({ ai: { on: true }, autoTasks: true, profile: 'Hackathons only' })
    expect(cloud.settings.get('accounts')).toMatchObject({ phone: { accounts: [{ email: 'me@gmail.com', services: ['mail', 'classroom', 'announcements'] }] } })
  })
})

describe('readerStatus', () => {
  it('says who reads, from where it is shown', () => {
    const now = 1_800_000_000_000
    expect(readerStatus({ reader: 'desktop', checkedAt: now - 3 * 60_000, refreshing: false }, 'phone', now)).toBe('Read by your computer · checked 3 min ago')
    expect(readerStatus({ reader: 'here', checkedAt: null, refreshing: false }, 'desktop', now)).toBe('Read on this computer')
    expect(readerStatus({ reader: 'phone', checkedAt: null, refreshing: true }, 'desktop', now)).toBe('Checking now…')
  })
})
