import {
  accountChips,
  accountsIn,
  createReminder,
  DEFAULT_PROFILE,
  inboxFolders,
  inboxTaskId,
  isImportant,
  MINUTE,
  planAutoTasks,
  PROFILE_LIMIT,
  senderAddress,
  taskFromInbox,
  toAnnounce,
  type InboxRecord,
  type SenderRule,
} from '@cairn/core'
import {
  patchInbox,
  watchInbox,
  watchSetting,
  writeSetting,
  type AccountsDoc,
  type InboxSettings,
  type ReaderDoc,
  type ReminderRepository,
  type SettingName,
  type Unsubscribe,
  type WorkerAccount,
  type WorkerClient,
} from '@cairn/sync'
import { accountProblem, accountsOf, reading } from './accounts'
import { coursesIn, type CourseColorOverrides, type CourseEntry, type CourseSettings } from './courseColors'
import { formatAgo } from './format'
import type { Platform } from './platform'
import type { CourseColorKey } from './tokens'
import { unseenCounts } from './widget'

/**
 * The shared inbox, as each app shows it.
 *
 * Cairn's Worker reads Gmail and Classroom for every connected account every
 * ten minutes, sorts what it finds and writes a record of each to Firestore.
 * Both apps show those records and change only what the person does to one —
 * opened it, hid it, made a task of it, said its sender does or does not
 * matter — so a choice made on one device is made on both. Sync now asks the
 * Worker to look straight away.
 *
 * Nothing here knows about React. Each app holds one engine, hands it the
 * signed-in user and the task store as they change, and redraws when it says so.
 */

export type { InboxSettings, ReaderDoc }

/** With no check for this long, the apps say checks have stopped. Two missed runs and then some. */
export const CHECKS_PAUSED_MS = 30 * MINUTE

export interface AiStatus {
  /** Whether an NVIDIA key is set up, on the phone. */
  on: boolean
  /** The model asked first. */
  preferred?: string
  /** The model that answered last. */
  model?: string
  /** The last thing that went wrong, until something works again. */
  error?: string
}

export interface InboxState {
  /** Signed in, so there is a shared inbox to show. */
  signedIn: boolean
  /** Every record, newest first, hidden ones included. */
  records: InboxRecord[]
  /** Email, not hidden. */
  mail: InboxRecord[]
  /** Classroom posts, not hidden. */
  classroom: InboxRecord[]
  /** Folders the model has filed mail into, in the order they first appeared. */
  folders: string[]
  /** Account chips over each list: All only when there is more than one. */
  mailAccounts: { all: boolean; accounts: string[] }
  classroomAccounts: { all: boolean; accounts: string[] }
  /** Every connected account, as the Worker reports it. */
  accounts: WorkerAccount[]
  /** Accounts whose Gmail, or Classroom, is read. */
  mailReaders: WorkerAccount[]
  classroomReaders: WorkerAccount[]
  /** A Sync now is under way. */
  refreshing: boolean
  error: string | null
  /** When the Worker last looked. */
  checkedAt: number | null
  /** Signed in with something to read, and no check for a while. */
  paused: boolean
  /** Important mail and new Classroom posts found since each tab was last opened. */
  unseen: number
  unseenClassroom: number
  ai: AiStatus
  profile: string
  senders: Record<string, SenderRule>
  autoTasks: boolean
  /** The time zone the Worker keeps notifications in, as the phone set it. */
  timeZone?: string
  /** Every Classroom course seen, newest post first. */
  courses: CourseEntry[]
  /** The colours picked for courses, on either device. */
  courseColors: CourseColorOverrides
}

export interface InboxContext {
  /** The Firebase uid, or null signed out. */
  userId: string | null
  reminders: ReminderRepository
}

/** The cloud calls the engine makes, replaceable in tests. */
export interface InboxBackend {
  watchInbox(uid: string, onChange: (records: InboxRecord[]) => void, onError?: (error: unknown) => void): Unsubscribe
  patchInbox(uid: string, id: string, patch: Partial<Pick<InboxRecord, 'read' | 'dismissed' | 'tasked' | 'updatedAt'>>): Promise<void>
  watchSetting<T>(uid: string, name: SettingName, onChange: (value: T | null) => void, onError?: (error: unknown) => void): Unsubscribe
  writeSetting<T extends object>(uid: string, name: SettingName, value: T, options?: { replace?: boolean }): Promise<void>
}

export const firestoreInbox: InboxBackend = { watchInbox, patchInbox, watchSetting, writeSetting }

export interface InboxHost {
  platform: Platform
  /** The Worker, for Sync now. */
  worker?: Pick<WorkerClient, 'sync'>
  backend?: InboxBackend
  now?: () => number
  /**
   * Show a notification here for what arrives. The desktop does; the phone
   * is told by the Worker's push instead, even while Cairn is closed.
   */
  announce?: boolean
}

/** Where the device keeps what it was last told, and when each tab was last opened; the widget reads them too. */
export const INBOX_CACHE_KEYS = { records: 'cairn.inbox.cache', seenAt: 'cairn.inbox.seenAt', seenClassroomAt: 'cairn.classroom.seenAt' } as const
const SEEN_KEY = INBOX_CACHE_KEYS.seenAt
const SEEN_CLASSROOM_KEY = INBOX_CACHE_KEYS.seenClassroomAt
const ANNOUNCED_KEY = 'cairn.inbox.announced'
const CACHE_KEY = INBOX_CACHE_KEYS.records
/** Kept on the device as well, so the widgets colour courses without asking the cloud. */
export const COURSE_COLORS_KEY = 'cairn.courses.colors'
/** The person's word on senders, kept for the widget's count of important mail. */
export const SENDERS_KEY = 'cairn.inbox.senders'
const KEEP_ANNOUNCED = 300

async function load<T>(platform: Platform, key: string, fallback: T): Promise<T> {
  try {
    const raw = await platform.storage.get(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // A damaged record costs only a fresh start, never a crash.
    return fallback
  }
}

function save(platform: Platform, key: string, value: unknown): void {
  void platform.storage.set(key, JSON.stringify(value)).catch(() => {})
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Timers and the console, typed structurally: this package takes no runtime's type library. */
const runtime = globalThis as unknown as {
  setInterval(run: () => void, ms: number): unknown
  clearInterval(id: unknown): void
  console: { error(...data: unknown[]): void }
}

export class InboxEngine {
  private readonly platform: Platform
  private readonly worker?: Pick<WorkerClient, 'sync'>
  private readonly backend: InboxBackend
  private readonly now: () => number
  private readonly announcing: boolean
  private readonly listeners = new Set<() => void>()
  private context: InboxContext | null = null
  private watching: string | null = null
  private stops: Unsubscribe[] = []
  private loaded: Promise<void> | null = null
  private records: InboxRecord[] = []
  private reader: ReaderDoc | null = null
  private accounts: AccountsDoc | null = null
  private settings: InboxSettings = {}
  private courseColors: CourseColorOverrides = {}
  private seenAt = 0
  private seenClassroomAt = 0
  private announced: { since: number; ids: string[] } = { since: 0, ids: [] }
  private refreshing = false
  private error: string | null = null
  private clock: unknown = null
  private state: InboxState

  constructor(host: InboxHost) {
    this.platform = host.platform
    this.worker = host.worker
    this.backend = host.backend ?? firestoreInbox
    this.now = host.now ?? Date.now
    this.announcing = host.announce ?? false
    this.state = this.derive()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): InboxState => this.state

  /** Settles what was kept on this device: what was seen and announced, and the last records, to show at once. */
  ready(): Promise<void> {
    this.loaded ??= (async () => {
      const p = this.platform
      this.seenAt = await load(p, SEEN_KEY, 0)
      this.seenClassroomAt = await load(p, SEEN_CLASSROOM_KEY, 0)
      this.announced = await load(p, ANNOUNCED_KEY, { since: 0, ids: [] as string[] })
      // A device announces only what arrives after it first ran, never the backlog.
      if (!this.announced.since) {
        this.announced = { since: this.now(), ids: [] }
        save(p, ANNOUNCED_KEY, this.announced)
      }
      if (this.records.length === 0) this.records = await load<InboxRecord[]>(p, CACHE_KEY, [])
      this.courseColors = await load<CourseColorOverrides>(p, COURSE_COLORS_KEY, {})
      this.emit()
    })()
    return this.loaded
  }

  /** Hands over what the app knows now. Signing in or out starts or stops the cloud listeners. */
  setContext(context: InboxContext): void {
    this.context = context
    if (context.userId !== this.watching) this.watch(context.userId)
    this.emit()
  }

  dispose(): void {
    this.watch(null)
    this.listeners.clear()
  }

  private watch(uid: string | null): void {
    for (const stop of this.stops) stop()
    this.stops = []
    runtime.clearInterval(this.clock)
    this.clock = null
    this.watching = uid
    this.reader = null
    this.accounts = null
    this.settings = {}
    this.error = null
    if (!uid) {
      this.records = []
      return
    }
    const b = this.backend
    const onError = (error: unknown) => runtime.console.error('Inbox sync problem', error)
    // Checks stopping is something that happens by nothing happening, so the clock is watched too.
    this.clock = runtime.setInterval(() => {
      const state = this.derive()
      if (state.paused !== this.state.paused) this.emit()
    }, MINUTE)
    this.stops.push(
      b.watchInbox(
        uid,
        (records) => {
          this.records = records.sort((a, c) => c.receivedAt - a.receivedAt)
          save(this.platform, CACHE_KEY, this.records)
          this.announce()
          this.emit()
        },
        onError,
      ),
      b.watchSetting<ReaderDoc>(
        uid,
        'reader',
        (value) => {
          this.reader = value
          this.emit()
        },
        onError,
      ),
      b.watchSetting<AccountsDoc>(
        uid,
        'accounts',
        (value) => {
          this.accounts = value
          this.emit()
        },
        onError,
      ),
      b.watchSetting<InboxSettings>(
        uid,
        'inbox',
        (value) => {
          this.settings = value ?? {}
          save(this.platform, SENDERS_KEY, this.settings.senders ?? {})
          this.emit()
        },
        onError,
      ),
      b.watchSetting<CourseSettings>(
        uid,
        'courses',
        (value) => {
          this.courseColors = value?.colors ?? {}
          save(this.platform, COURSE_COLORS_KEY, this.courseColors)
          this.emit()
        },
        onError,
      ),
    )
  }

  /**
   * Hands a write to the cloud without waiting on it. Firestore only settles
   * a write once the server has it, which offline is never, and nothing here
   * should hang on that.
   */
  private send(write: Promise<unknown>): void {
    void write.catch((error: unknown) => runtime.console.error('Inbox sync problem', error))
  }

  /** Says what turned up, the way a mail app would — but only what matters, and as one notification when a lot arrives at once. */
  private announce(): void {
    if (!this.announcing) return
    const now = this.now()
    const fresh = toAnnounce(this.records, { since: this.announced.since, announced: new Set(this.announced.ids), senders: this.senders(), now })
    if (fresh.length === 0) return
    this.announced = { since: this.announced.since, ids: [...this.announced.ids, ...fresh.map((r) => r.id)].slice(-KEEP_ANNOUNCED) }
    save(this.platform, ANNOUNCED_KEY, this.announced)
    if (fresh.length > 3) {
      void this.platform.notify({ title: `${fresh.length} new in Cairn`, body: fresh.slice(0, 3).map((r) => r.subject).join(' · '), tag: 'inbox' })
      return
    }
    for (const r of fresh) {
      const post = r.classroom
      const due = r.triage?.task ?? (post?.due ? { title: r.subject, ...post.due } : undefined)
      void this.platform.notify({
        title: post?.course ?? r.triage?.folder ?? (due ? 'A deadline in your mail' : 'Important email'),
        body: post ? `${post.kind === 'work' ? 'New coursework: ' : ''}${r.subject}` : (r.triage?.summary ?? due?.title ?? r.subject),
        tag: r.id,
      })
    }
  }

  private senders(): Record<string, SenderRule> {
    return this.settings.senders ?? {}
  }

  private emit(): void {
    this.state = this.derive()
    for (const listener of this.listeners) listener()
  }

  private derive(): InboxState {
    const senders = this.senders()
    const records = this.records
    const live = records.filter((r) => !r.dismissed)
    const mail = live.filter((r) => !r.classroom)
    const classroom = live.filter((r) => r.classroom)
    const accounts = accountsOf(this.accounts)
    const mailReaders = accounts.filter((a) => reading(a, 'mail'))
    const classroomReaders = accounts.filter((a) => reading(a, 'classroom'))
    const checkedAt = this.reader?.checkedAt ?? null
    const problems = [
      ...accounts.flatMap((a) => accountProblem(a) ?? []),
      ...Object.entries(this.reader?.accounts ?? {})
        .filter(([, s]) => s.error)
        .map(([email, s]) => `${email}: ${s.error}`),
    ]
    const now = this.now()
    const unseen = unseenCounts({ records: live, seenAt: this.seenAt, seenClassroomAt: this.seenClassroomAt, senders })
    return {
      signedIn: !!this.watching,
      records,
      mail,
      classroom,
      folders: inboxFolders(mail),
      mailAccounts: accountChips(accountsIn(mail, mailReaders.map((a) => a.email))),
      classroomAccounts: accountChips(accountsIn(classroom, classroomReaders.map((a) => a.email))),
      accounts,
      mailReaders,
      classroomReaders,
      refreshing: this.refreshing,
      error: this.error ?? (problems.length ? problems.join('\n') : null),
      checkedAt,
      paused: !!this.watching && mailReaders.length + classroomReaders.length > 0 && checksPaused(checkedAt, now),
      unseen: unseen.mail,
      unseenClassroom: unseen.classroom,
      ai: { on: this.accounts?.ai?.on === true, ...(this.accounts?.ai?.preferred ? { preferred: this.accounts.ai.preferred } : {}), ...(this.reader?.ai ?? {}) },
      profile: this.settings.profile?.trim() || DEFAULT_PROFILE,
      senders,
      autoTasks: this.settings.autoTasks === true,
      ...(this.settings.timeZone ? { timeZone: this.settings.timeZone } : {}),
      courses: coursesIn(records),
      courseColors: this.courseColors,
    }
  }

  /** Sync now: the Worker looks at every account straight away. Resolves once what it found is in Firestore. */
  async refresh(): Promise<void> {
    if (!this.watching || !this.worker || this.refreshing) return
    this.refreshing = true
    this.error = null
    this.emit()
    try {
      const result = await this.worker.sync()
      this.error = result.errors?.length ? result.errors.join('\n') : null
    } catch (error) {
      this.error = message(error)
    } finally {
      this.refreshing = false
      this.emit()
    }
  }

  /** Makes the task a message offers. Coursework keeps Classroom's id, so its task follows Classroom. */
  async addAsTask(record: InboxRecord): Promise<void> {
    const context = this.context
    if (!context) return
    const now = this.now()
    const { id, input } = taskFromInbox(record, { now, important: isImportant(record, this.senders()) })
    await context.reminders.upsert(createReminder(input, { userId: context.userId ?? 'local', now, id }))
    if (this.watching) this.send(this.backend.patchInbox(this.watching, record.id, { tasked: true, updatedAt: now }))
  }

  /** Whether a task has been made from a record here or anywhere. */
  static hasTask(record: InboxRecord, taskIds: ReadonlySet<string>): boolean {
    return !!record.tasked || taskIds.has(inboxTaskId(record))
  }

  async dismiss(record: InboxRecord, dismissed = true): Promise<void> {
    if (this.watching) this.send(this.backend.patchInbox(this.watching, record.id, { dismissed, updatedAt: this.now() }))
  }

  async markRead(record: InboxRecord): Promise<void> {
    if (record.read || !this.watching) return
    this.send(this.backend.patchInbox(this.watching, record.id, { read: true, updatedAt: this.now() }))
  }

  /** Moves a sender's mail in or out of Important, everywhere, from now on. */
  async mark(record: InboxRecord, rule: SenderRule): Promise<void> {
    const uid = this.watching
    if (!uid) return
    const address = senderAddress(record.from)
    this.settings = { ...this.settings, senders: { ...this.settings.senders, [address]: rule } }
    this.emit()
    this.send(this.backend.writeSetting(uid, 'inbox', { senders: { [address]: rule }, updatedAt: this.now() }))
  }

  /**
   * Opening a tab is seeing what is in it. The Worker stamps foundAt by its own
   * clock, which can run seconds ahead of this one, so seeing covers the newest
   * record too; otherwise it stays unseen and every call marks it again.
   */
  markSeen(tab: 'inbox' | 'classroom'): void {
    const classroom = tab === 'classroom'
    const newest = this.records.reduce((at, r) => (!!r.classroom === classroom ? Math.max(at, r.foundAt) : at), 0)
    const seen = Math.max(this.now(), newest)
    if (classroom) {
      if (this.state.unseenClassroom === 0 && this.seenClassroomAt) return
      this.seenClassroomAt = seen
      save(this.platform, SEEN_CLASSROOM_KEY, seen)
    } else {
      if (this.state.unseen === 0 && this.seenAt) return
      this.seenAt = seen
      save(this.platform, SEEN_KEY, seen)
    }
    this.emit()
  }

  /** What matters to the person; empty goes back to the default. */
  async setProfile(text: string): Promise<void> {
    const uid = this.watching
    if (!uid) return
    const tidy = text.trim().slice(0, PROFILE_LIMIT)
    const value = tidy === DEFAULT_PROFILE ? '' : tidy
    this.settings = { ...this.settings, profile: value }
    this.emit()
    this.send(this.backend.writeSetting(uid, 'inbox', { profile: value, updatedAt: this.now() }))
  }

  /**
   * A course's colour, on every device; 'auto' goes back to the one its id
   * gives it. Merged by course, so two devices picking for different courses
   * keep both.
   */
  async setCourseColor(courseId: string, color: CourseColorKey | 'auto'): Promise<void> {
    const uid = this.watching
    if (!uid) return
    this.courseColors = { ...this.courseColors, [courseId]: color }
    save(this.platform, COURSE_COLORS_KEY, this.courseColors)
    this.emit()
    this.send(this.backend.writeSetting(uid, 'courses', { colors: { [courseId]: color }, updatedAt: this.now() }))
  }

  /** The phone's time zone, so the Worker's evening and morning notifications keep its hours. */
  async setTimeZone(zone: string | undefined): Promise<void> {
    const uid = this.watching
    if (!uid || !zone || this.settings.timeZone === zone) return
    this.settings = { ...this.settings, timeZone: zone }
    this.send(this.backend.writeSetting(uid, 'inbox', { timeZone: zone, updatedAt: this.now() }))
  }

  async setAutoTasks(on: boolean): Promise<void> {
    const uid = this.watching
    const context = this.context
    if (!uid) return
    this.settings = { ...this.settings, autoTasks: on }
    this.emit()
    this.send(this.backend.writeSetting(uid, 'inbox', { autoTasks: on, updatedAt: this.now() }))
    // Recent posts still open become tasks straight away, not at the Worker's next look.
    if (!on || !context) return
    const now = this.now()
    const existing = new Set((await context.reminders.list({ includeDeleted: true })).map((t) => t.id))
    const plan = planAutoTasks(this.records, existing, true, now)
    if (plan.length === 0) return
    const senders = this.senders()
    await context.reminders.upsertMany(
      plan.map((rec) => {
        const { id, input } = taskFromInbox(rec, { now, important: rec.classroom?.kind === 'work' || isImportant(rec, senders), automatic: true })
        return createReminder(input, { userId: uid, now, id })
      }),
    )
    for (const rec of plan) this.send(this.backend.patchInbox(uid, rec.id, { tasked: true, updatedAt: now }))
  }
}

/** Whether checks have stopped: signed in, with no check for a while. */
export function checksPaused(checkedAt: number | null, now: number): boolean {
  return checkedAt === null || now - checkedAt > CHECKS_PAUSED_MS
}

/** When mail was last checked, in a line: "Checked 4 min ago", or that checks have stopped. */
export function readerStatus(state: Pick<InboxState, 'checkedAt' | 'refreshing' | 'paused'>, now: number): string {
  if (state.refreshing) return 'Checking now…'
  if (state.checkedAt === null) return 'Waiting for the first check'
  if (state.paused) return `Mail checks paused — last checked ${formatAgo(state.checkedAt, now)}`
  return `Checked ${formatAgo(state.checkedAt, now)}`
}
