import { classroomTaskId, type InboxRecord } from '@cairn/core'
import { MemoryKeyValueStore, openLocalRepositories, type AccountsDoc, type ReaderDoc, type SettingName } from '@cairn/sync'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHECKS_PAUSED_MS, InboxEngine, readerStatus, type AppNotification, type InboxBackend, type Platform } from '../src'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const MIN = 60_000

/** Firestore, in memory: what the Worker wrote, and what a device changes. */
class FakeCloud implements InboxBackend {
  inbox = new Map<string, InboxRecord>()
  settings = new Map<SettingName, Record<string, unknown>>()
  private inboxWatchers = new Set<(records: InboxRecord[]) => void>()
  private settingWatchers = new Map<SettingName, Set<(value: unknown) => void>>()

  watchInbox(_uid: string, onChange: (records: InboxRecord[]) => void) {
    this.inboxWatchers.add(onChange)
    onChange([...this.inbox.values()].map(clone))
    return () => this.inboxWatchers.delete(onChange)
  }
  async patchInbox(_uid: string, id: string, patch: Partial<InboxRecord>) {
    this.inbox.set(id, { ...this.inbox.get(id)!, ...patch })
    this.flushInbox()
  }
  watchSetting<T>(_uid: string, name: SettingName, onChange: (value: T | null) => void) {
    const set = this.settingWatchers.get(name) ?? new Set()
    set.add(onChange as (value: unknown) => void)
    this.settingWatchers.set(name, set)
    onChange((this.settings.get(name) as T) ?? null)
    return () => set.delete(onChange as (value: unknown) => void)
  }
  async writeSetting<T extends object>(_uid: string, name: SettingName, value: T) {
    const next: Record<string, unknown> = { ...(this.settings.get(name) ?? {}) }
    for (const [key, v] of Object.entries(value)) {
      const before = next[key]
      next[key] = v && typeof v === 'object' && !Array.isArray(v) && before && typeof before === 'object' ? { ...before, ...v } : v
    }
    this.settings.set(name, clone(next))
    for (const w of this.settingWatchers.get(name) ?? []) w(this.settings.get(name))
  }
  /** The Worker writing. */
  worker(records: InboxRecord[]) {
    for (const r of records) this.inbox.set(r.id, clone(r))
    this.flushInbox()
  }
  setting(name: SettingName, value: object) {
    this.settings.set(name, clone(value) as Record<string, unknown>)
    for (const w of this.settingWatchers.get(name) ?? []) w(this.settings.get(name))
  }
  private flushInbox() {
    for (const w of this.inboxWatchers) w([...this.inbox.values()].map(clone))
  }
}

const record = (id: string, over: Partial<InboxRecord> = {}): InboxRecord => ({
  id,
  account: 'me@gmail.com',
  from: 'Devfolio <hello@devfolio.co>',
  subject: `Mail ${id}`,
  snippet: 'Register before Friday',
  receivedAt: 1000,
  reading: { kind: 'other', title: `Mail ${id}`, allDay: false },
  foundAt: 1000,
  updatedAt: 1000,
  ...over,
})

const accounts: AccountsDoc = {
  accounts: [
    { email: 'me@gmail.com', role: 'owner', services: ['drive', 'mail'], watch: { mail: true, classroom: false } },
    { email: 'me@college.edu', role: 'source', services: ['mail', 'classroom', 'announcements'], watch: { mail: true, classroom: true } },
  ],
  ai: { on: true, preferred: 'GPT-OSS 20B' },
  updatedAt: 1,
}

function platformFor(notified: AppNotification[] = []): Platform {
  return {
    name: 'test',
    storage: new MemoryKeyValueStore(),
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    notificationPermission: async () => 'granted',
    requestNotificationPermission: async () => 'granted',
    notify: async (n) => {
      notified.push(n)
    },
    authorize: async () => '',
  }
}

async function device(cloud: FakeCloud, clock: { now: number }, options: { announce?: boolean; sync?: () => Promise<{ checkedAt: number; found: number; errors?: string[] }> } = {}) {
  const notified: AppNotification[] = []
  const { reminders } = await openLocalRepositories(new MemoryKeyValueStore())
  const engine = new InboxEngine({
    platform: platformFor(notified),
    backend: cloud,
    now: () => clock.now,
    announce: options.announce,
    worker: { sync: options.sync ?? (async () => ({ checkedAt: clock.now, found: 0 })) },
  })
  await engine.ready()
  engine.setContext({ userId: 'u', reminders })
  disposers.push(() => engine.dispose())
  return { engine, reminders, notified }
}

const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

describe('InboxEngine', () => {
  it('shares course colours between devices, and keeps them on each for the widgets', async () => {
    const cloud = new FakeCloud()
    cloud.worker([record('classroom-work-w1', { classroom: { kind: 'work', courseId: 'c1', course: 'DBMS', workId: 'w1' } })])
    const clock = { now: 5000 }
    const phone = await device(cloud, clock)
    const laptop = await device(cloud, clock)
    expect(phone.engine.getState().courses).toEqual([{ courseId: 'c1', course: 'DBMS' }])

    await phone.engine.setCourseColor('c1', 'pink')
    await laptop.engine.setCourseColor('c2', 'sky')
    expect(laptop.engine.getState().courseColors).toEqual({ c1: 'pink', c2: 'sky' })
    expect(phone.engine.getState().courseColors).toEqual({ c1: 'pink', c2: 'sky' })
    await phone.engine.setCourseColor('c1', 'auto')
    expect(laptop.engine.getState().courseColors.c1).toBe('auto')
  })

  it('shows what the Worker wrote, mail and Classroom apart, with the accounts it reads', async () => {
    const cloud = new FakeCloud()
    cloud.setting('accounts', accounts)
    cloud.worker([
      record('m1', { triage: { important: true, summary: 'Register', folder: 'Hackathons' } }),
      record('m2', { account: 'me@college.edu', receivedAt: 2000 }),
      record('classroom-work-w1', { account: 'me@college.edu', classroom: { kind: 'work', courseId: 'c', course: 'DBMS', workId: 'w1' } }),
      record('m3', { dismissed: true }),
    ])
    const { engine } = await device(cloud, { now: 5000 })
    const state = engine.getState()
    expect(state.mail.map((r) => r.id)).toEqual(['m2', 'm1'])
    expect(state.classroom.map((r) => r.id)).toEqual(['classroom-work-w1'])
    expect(state.folders).toEqual(['Hackathons'])
    expect(state.mailAccounts).toEqual({ all: true, accounts: ['me@gmail.com', 'me@college.edu'] })
    expect(state.classroomAccounts).toEqual({ all: false, accounts: ['me@college.edu'] })
    expect(state.classroomReaders.map((a) => a.email)).toEqual(['me@college.edu'])
    expect(state.ai).toEqual({ on: true, preferred: 'GPT-OSS 20B' })
  })

  it('says when checks have stopped', async () => {
    const cloud = new FakeCloud()
    cloud.setting('accounts', accounts)
    const clock = { now: 100 * MIN }
    const { engine } = await device(cloud, clock)
    expect(readerStatus(engine.getState(), clock.now)).toBe('Waiting for the first check')
    cloud.setting('reader', { checkedAt: clock.now - 4 * MIN } satisfies ReaderDoc)
    expect(engine.getState().paused).toBe(false)
    expect(readerStatus(engine.getState(), clock.now)).toBe('Checked 4 min ago')
    cloud.setting('reader', { checkedAt: clock.now - CHECKS_PAUSED_MS - MIN } satisfies ReaderDoc)
    expect(engine.getState().paused).toBe(true)
    expect(readerStatus(engine.getState(), clock.now)).toBe('Mail checks paused — last checked 31 min ago')
  })

  it('notices checks stopping as time passes, with nothing else happening', async () => {
    vi.useFakeTimers()
    try {
      const cloud = new FakeCloud()
      cloud.setting('accounts', accounts)
      const clock = { now: 100 * MIN }
      cloud.setting('reader', { checkedAt: clock.now } satisfies ReaderDoc)
      const { engine } = await device(cloud, clock)
      let heard = 0
      engine.subscribe(() => heard++)
      clock.now += 20 * MIN
      vi.advanceTimersByTime(MIN)
      expect(heard).toBe(0)
      clock.now += 15 * MIN
      vi.advanceTimersByTime(MIN)
      expect(heard).toBe(1)
      expect(engine.getState().paused).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the Worker’s problems with an account, and its last model', async () => {
    const cloud = new FakeCloud()
    cloud.setting('accounts', { ...accounts, accounts: [{ ...accounts.accounts[0]!, problem: 'Google signed Cairn out of me@gmail.com.' }] })
    cloud.setting('reader', { checkedAt: 1, accounts: { 'me@college.edu': { error: 'Classroom asked Cairn to slow down.' } }, ai: { model: 'Nemotron 3.5 Lightning' } } satisfies ReaderDoc)
    const { engine } = await device(cloud, { now: 5000 })
    expect(engine.getState().error).toBe('Google signed Cairn out of me@gmail.com.\nme@college.edu: Classroom asked Cairn to slow down.')
    expect(engine.getState().ai.model).toBe('Nemotron 3.5 Lightning')
  })

  it('asks the Worker to look on Sync now, once at a time', async () => {
    const cloud = new FakeCloud()
    let calls = 0
    let finish!: () => void
    const { engine } = await device(cloud, { now: 0 }, {
      sync: () => {
        calls++
        return new Promise((resolve) => (finish = () => resolve({ checkedAt: 0, found: 1, errors: ['me@college.edu: no'] })))
      },
    })
    const first = engine.refresh()
    void engine.refresh()
    expect(engine.getState().refreshing).toBe(true)
    finish()
    await first
    expect(calls).toBe(1)
    expect(engine.getState()).toMatchObject({ refreshing: false, error: 'me@college.edu: no' })
  })

  it('changes only what the person did: opened, hidden, made into a task, a sender ruled on', async () => {
    const cloud = new FakeCloud()
    cloud.worker([record('m1', { reading: { kind: 'deadline', title: 'Register', dueAt: 9000, allDay: false } })])
    const { engine, reminders } = await device(cloud, { now: 5000 })
    const [m1] = engine.getState().mail
    await engine.markRead(m1!)
    await engine.dismiss(m1!)
    await engine.addAsTask(m1!)
    expect(cloud.inbox.get('m1')).toMatchObject({ read: true, dismissed: true, tasked: true })
    expect(await reminders.get('mail-m1')).toMatchObject({ title: 'Register', dueAt: 9000 })
    await engine.mark(m1!, 'unimportant')
    expect(cloud.settings.get('inbox')).toMatchObject({ senders: { 'hello@devfolio.co': 'unimportant' } })
    await engine.setProfile('Hackathons only')
    await engine.setTimeZone('Asia/Kolkata')
    expect(cloud.settings.get('inbox')).toMatchObject({ profile: 'Hackathons only', timeZone: 'Asia/Kolkata' })
  })

  it('makes tasks of open posts straight away when automatic tasks are switched on', async () => {
    const cloud = new FakeCloud()
    cloud.worker([
      record('classroom-work-w1', { classroom: { kind: 'work', courseId: 'c', course: 'DBMS', workId: 'w1', due: { dueAt: 90_000, allDay: false } } }),
      record('classroom-work-w2', { classroom: { kind: 'work', courseId: 'c', course: 'DBMS', workId: 'w2', submitted: true } }),
    ])
    const { engine, reminders } = await device(cloud, { now: 5000 })
    await engine.setAutoTasks(true)
    expect(cloud.settings.get('inbox')).toMatchObject({ autoTasks: true })
    expect(await reminders.get(classroomTaskId('w1'))).toMatchObject({ dueAt: 90_000, autoCompleteOn: 'classroom-submission' })
    expect(await reminders.get(classroomTaskId('w2'))).toBeUndefined()
    expect(cloud.inbox.get('classroom-work-w1')).toMatchObject({ tasked: true })
  })

  it('announces what arrives on the computer, never the backlog, and nothing on the phone', async () => {
    const clock = { now: 10_000 }
    const cloud = new FakeCloud()
    cloud.worker([record('old', { foundAt: 1000, triage: { important: true, summary: 'Old' } })])
    const desktop = await device(cloud, clock, { announce: true })
    const phone = await device(cloud, clock)
    clock.now = 20_000
    cloud.worker([
      record('new', { foundAt: 15_000, triage: { important: true, summary: 'Register for SIH', folder: 'Hackathons' } }),
      record('dull', { foundAt: 15_000, triage: { important: false, summary: 'A sale' } }),
      record('classroom-announcement-a1', { foundAt: 15_000, subject: 'Quiz on Monday', classroom: { kind: 'announcement', courseId: 'c', course: 'DBMS' }, triage: { important: true, summary: 'Quiz' } }),
    ])
    expect(desktop.notified.map((n) => [n.title, n.body])).toEqual([
      ['Hackathons', 'Register for SIH'],
      ['DBMS', 'Quiz on Monday'],
    ])
    expect(phone.notified).toEqual([])
    // Each is announced once.
    cloud.worker([])
    expect(desktop.notified).toHaveLength(2)
  })

  it('forgets everything on signing out', async () => {
    const cloud = new FakeCloud()
    cloud.worker([record('m1')])
    const { engine, reminders } = await device(cloud, { now: 0 })
    engine.setContext({ userId: null, reminders })
    expect(engine.getState()).toMatchObject({ signedIn: false, mail: [] })
  })
})
