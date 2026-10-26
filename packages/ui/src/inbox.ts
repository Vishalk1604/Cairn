import {
  accountChips,
  accountsIn,
  chooseReader,
  classroomDueAt,
  classroomTaskId,
  completeReminder,
  createReminder,
  DAY,
  DEFAULT_PROFILE,
  inboxFolders,
  inboxOverflow,
  inboxTaskId,
  inboxWrites,
  isImportant,
  mergeInbox,
  messageOf,
  planAutoTasks,
  PROFILE_LIMIT,
  readMail,
  recordOf,
  senderAddress,
  taskFromInbox,
  toAnnounce,
  TRIAGE_BODY_LIMIT,
  updateReminder,
  type DeviceKind,
  type InboxRecord,
  type MailMessage,
  type MailTriage,
  type ReaderChoice,
  type ReaderLease,
  type Reminder,
  type SenderRule,
} from '@cairn/core'
import {
  AiError,
  announcementMessage,
  classroomFeed,
  courseWorkMessage,
  deleteInbox,
  deleteSetting,
  GoogleApiError,
  mailCursor,
  MailCursorExpired,
  mailSince,
  modelsFor,
  patchInbox,
  storedAiSetup,
  triageMail,
  watchInbox,
  watchPreference,
  watchSetting,
  writeInbox,
  writeSetting,
  type AiSetup,
  type ClassroomItem,
  type ReminderRepository,
  type SettingName,
  type Unsubscribe,
} from '@cairn/sync'
import { accessTokenFor, accountGaps, accountRecords, featuresOf, readsAnnouncements, type Account, type AccountGap, type AccountsRegistry } from './accounts'
import { formatAgo } from './format'
import type { Platform } from './platform'

/**
 * The shared inbox, as each app runs it.
 *
 * One device reads Gmail and Classroom for all of them — the computer when it
 * is on, the phone when it is not (see chooseReader) — sorts what it finds,
 * and writes the outcome to the cloud. Every device shows the same records,
 * so the inbox reads the same everywhere, and a choice made on one (hide
 * this, that sender is not important) is made on all.
 *
 * Nothing here knows about React. Each app holds one engine, hands it the
 * accounts and the task store as they change, and redraws when it says so.
 */

export type Feature = 'mail' | 'classroom'
export type Paused = Record<Feature, string[]>

/** Whether Gmail or Classroom is switched on for an account: granted by Google, and not paused. */
export function readingOn(account: Account, feature: Feature, paused: Partial<Paused> | undefined): boolean {
  return featuresOf(account)[feature] && !(paused?.[feature] ?? []).includes(account.identity.sub)
}

/** Where reading left off, per account. In the cloud, so whichever device reads next carries on from there. */
export interface ReadCursor {
  /** Gmail historyId. Empty means start from now on the next look. */
  mail?: string
  /** When Classroom was switched on: posts from before then are not news. */
  classroomSince?: number
  /** Classroom posts already taken in. Null means none yet: take in what is there, quietly. */
  classroomSeen?: string[] | null
}

/** settings/reader: who reads, and where they left off. */
export interface ReaderDoc {
  lease?: ReaderLease
  cursors?: Record<string, ReadCursor>
}

/** settings/inbox: what the person has said about their mail, shared by every device. */
export interface InboxSettings {
  senders?: Record<string, SenderRule>
  /** What matters to them, in their own words. Empty means the default. */
  profile?: string
  /** New coursework and announcements become tasks without a tap. */
  autoTasks?: boolean
  updatedAt?: number
}

/** settings/ai: the person's own NVIDIA key, so every device sorts with it. */
export interface AiDoc extends AiSetup {
  updatedAt: number
}

export interface AiStatus {
  /** Whether a key is saved. */
  on: boolean
  /** The model asked first: the one the pasted code was for, or GPT-OSS. */
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
  /** Accounts with Gmail or Classroom switched on here. */
  readable: Account[]
  /** Accounts with Classroom switched on here. */
  classroomReadable: Account[]
  refreshing: boolean
  error: string | null
  /** When anyone last read: this device, or the one holding the claim. */
  checkedAt: number | null
  /** Who reads: this device, the other kind, or nobody yet. */
  reader: ReaderChoice['reader']
  /** Important mail and new Classroom posts found since each tab was last opened. */
  unseen: number
  unseenClassroom: number
  ai: AiStatus
  profile: string
  senders: Record<string, SenderRule>
  autoTasks: boolean
  /** What the other device can read that this one cannot. */
  gaps: AccountGap[]
}

export interface InboxContext {
  /** The Firebase uid, or null signed out. */
  userId: string | null
  accounts: Account[]
  reminders: ReminderRepository
}

/** The cloud calls the engine makes, replaceable in tests. */
export interface InboxBackend {
  watchInbox(uid: string, onChange: (records: InboxRecord[]) => void, onError?: (error: unknown) => void): Unsubscribe
  writeInbox(uid: string, records: readonly InboxRecord[]): Promise<void>
  patchInbox(uid: string, id: string, patch: Partial<Pick<InboxRecord, 'read' | 'dismissed' | 'tasked' | 'updatedAt'>>): Promise<void>
  deleteInbox(uid: string, ids: readonly string[]): Promise<void>
  watchSetting<T>(uid: string, name: SettingName, onChange: (value: T | null) => void, onError?: (error: unknown) => void): Unsubscribe
  writeSetting<T extends object>(uid: string, name: SettingName, value: T, options?: { replace?: boolean }): Promise<void>
  deleteSetting(uid: string, name: SettingName): Promise<void>
  watchPaused(uid: string, onChange: (paused: Partial<Paused>) => void): Unsubscribe
}

export const firestoreInbox: InboxBackend = {
  watchInbox,
  writeInbox,
  patchInbox,
  deleteInbox,
  watchSetting,
  writeSetting,
  deleteSetting,
  watchPaused: (uid, onChange) => watchPreference<Partial<Paused>>(uid, 'paused', (value) => onChange(value ?? {})),
}

/** Google and NVIDIA, replaceable in tests. */
export interface InboxReaders {
  mailCursor: typeof mailCursor
  mailSince: typeof mailSince
  classroomFeed: typeof classroomFeed
  triageMail: typeof triageMail
  accessToken: (platform: Platform, account: Account) => Promise<{ accessToken: string }>
}

const GOOGLE: InboxReaders = { mailCursor, mailSince, classroomFeed, triageMail, accessToken: accessTokenFor }

export interface InboxHost {
  platform: Platform
  kind: DeviceKind
  backend?: InboxBackend
  readers?: InboxReaders
  /** Whether the app is in front, for a phone that should not read in the background. */
  active?: () => boolean
  now?: () => number
  /** Off in tests, which drive refresh themselves. */
  poll?: boolean
}

const DEVICE_KEY = 'cairn.device'
const SEEN_KEY = 'cairn.inbox.seenAt'
const SEEN_CLASSROOM_KEY = 'cairn.classroom.seenAt'
const ANNOUNCED_KEY = 'cairn.inbox.announced'
const PENDING_KEY = 'cairn.inbox.pending'
const CACHE_KEY = 'cairn.inbox.cache'
const AI_SYNCED_KEY = 'cairn.ai.synced'
const MIGRATED_KEY = 'cairn.inbox.migrated'
/** Where the phone kept these before they were shared. */
const OLD = { cursors: 'cairn.inbox.cursors', found: 'cairn.inbox.found', dismissed: 'cairn.inbox.dismissed', senders: 'cairn.inbox.senders', profile: 'cairn.inbox.profile' }
/** Where the NVIDIA key lives in this device's secure storage. */
const AI_SECRET = 'ai.nvidia'

/** How often to look. With nothing new, a look costs one cheap request per account. */
export const POLL_MS = 5 * 60 * 1000
/** Automatic looks are never closer together than this; Sync now is. */
const MIN_GAP_MS = 60 * 1000
/** After Google says slow down. */
const BACKOFF_MS = 3 * 60 * 1000
/**
 * Emails read by the model at once. Most of each request is spent waiting in
 * NVIDIA's queue, so a few at a time finish far sooner than one by one, and
 * stay well inside the free tier's 40 requests a minute.
 */
const AI_AT_ONCE = 4
/** Mail the model could not read is tried again on later looks, for this long… */
const RETRY_FOR_MS = 3 * DAY
/** …a few at a time, so a backlog never crowds out new mail. */
const RETRY_AT_ONCE = 6
/** Classroom posts remembered as taken in, per account. */
const KEEP_SEEN = 400
const KEEP_ANNOUNCED = 300

type Pending = Record<string, { text: string; foundAt: number }>

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

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** Runs at most `limit` at a time, in order. */
async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!)
    }),
  )
}

/** Timers and the console, typed structurally: this package takes no runtime's type library. */
const runtime = globalThis as unknown as {
  setInterval(run: () => void, ms: number): unknown
  clearInterval(id: unknown): void
  console: { error(...data: unknown[]): void; warn(...data: unknown[]): void }
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export class InboxEngine {
  private readonly platform: Platform
  private readonly kind: DeviceKind
  private readonly backend: InboxBackend
  private readonly readers: InboxReaders
  private readonly active: () => boolean
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()
  private context: InboxContext | null = null
  private watching: string | null = null
  private stops: Unsubscribe[] = []
  private timer: unknown

  private deviceId = ''
  private loaded: Promise<void> | null = null
  private records: InboxRecord[] = []
  private recordsArrived = false
  private reader: ReaderDoc | null = null
  private readerArrived = false
  private settings: InboxSettings = {}
  private settingsArrived = false
  private registry: AccountsRegistry = {}
  private registryArrived = false
  private paused: Partial<Paused> = {}
  private pausedArrived = false
  private aiSetup: AiSetup | null = null
  private aiState: Omit<AiStatus, 'on'> = {}
  private localSenders: Record<string, SenderRule> = {}
  private localProfile = ''
  private pending: Pending = {}
  private seenAt = 0
  private seenClassroomAt = 0
  private announced: { since: number; ids: string[] } = { since: 0, ids: [] }
  private refreshing = false
  private error: string | null = null
  private lastRun: number | null = null
  private busy = false
  private lastAttempt = 0
  private holdUntil = 0
  private state: InboxState

  constructor(host: InboxHost) {
    this.platform = host.platform
    this.kind = host.kind
    this.backend = host.backend ?? firestoreInbox
    this.readers = host.readers ?? GOOGLE
    this.active = host.active ?? (() => true)
    this.now = host.now ?? Date.now
    this.state = this.derive()
    if (host.poll !== false) {
      this.timer = runtime.setInterval(() => {
        if (this.active()) void this.refresh()
      }, POLL_MS)
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = (): InboxState => this.state

  /** Settles what was kept on this device: its id, what was seen, any key saved before signing in. */
  ready(): Promise<void> {
    this.loaded ??= (async () => {
      const p = this.platform
      this.deviceId = (await p.storage.get(DEVICE_KEY).catch(() => null)) || ''
      if (!this.deviceId) {
        this.deviceId = `${this.kind}-${randomId()}`
        await p.storage.set(DEVICE_KEY, this.deviceId).catch(() => {})
      }
      this.seenAt = await load(p, SEEN_KEY, 0)
      this.seenClassroomAt = await load(p, SEEN_CLASSROOM_KEY, 0)
      this.announced = await load(p, ANNOUNCED_KEY, { since: 0, ids: [] as string[] })
      // A device announces only what arrives after it first ran, never the backlog.
      if (!this.announced.since) {
        this.announced = { since: this.now(), ids: [] }
        save(p, ANNOUNCED_KEY, this.announced)
      }
      this.pending = await load<Pending>(p, PENDING_KEY, {})
      this.localSenders = await load<Record<string, SenderRule>>(p, OLD.senders, {})
      this.localProfile = (await p.storage.get(OLD.profile).catch(() => null)) ?? ''
      if (!this.recordsArrived) this.records = await load<InboxRecord[]>(p, CACHE_KEY, [])
      this.aiSetup ??= storedAiSetup(await p.secrets.get(AI_SECRET).catch(() => null))
      this.emit()
    })()
    return this.loaded
  }

  /** Hands over what the app knows now. Signing in or out starts or stops the cloud listeners. */
  setContext(context: InboxContext): void {
    const accountsChanged = JSON.stringify(accountRecords(context.accounts)) !== JSON.stringify(accountRecords(this.context?.accounts ?? []))
    this.context = context
    if (context.userId !== this.watching) this.watch(context.userId)
    if (accountsChanged) this.publishAccounts()
    this.emit()
  }

  /** Stops listening and polling. */
  dispose(): void {
    this.watch(null)
    runtime.clearInterval(this.timer)
    this.listeners.clear()
  }

  private watch(uid: string | null): void {
    for (const stop of this.stops) stop()
    this.stops = []
    this.watching = uid
    this.recordsArrived = this.readerArrived = this.settingsArrived = this.registryArrived = this.pausedArrived = false
    this.reader = null
    this.settings = {}
    this.registry = {}
    this.paused = {}
    if (!uid) return
    const b = this.backend
    const onError = (error: unknown) => runtime.console.error('Inbox sync problem', error)
    this.stops.push(
      b.watchInbox(
        uid,
        (records) => {
          this.records = records.sort((a, c) => c.receivedAt - a.receivedAt)
          this.recordsArrived = true
          save(this.platform, CACHE_KEY, this.records)
          this.announce()
          this.migrate()
          this.emit()
        },
        onError,
      ),
      b.watchSetting<ReaderDoc>(
        uid,
        'reader',
        (value) => {
          const first = !this.readerArrived
          this.reader = value
          this.readerArrived = true
          this.migrate()
          this.emit()
          // The first look once the cloud has said where reading left off.
          if (first) void this.refresh(false, true)
        },
        onError,
      ),
      b.watchSetting<InboxSettings>(
        uid,
        'inbox',
        (value) => {
          this.settings = value ?? {}
          this.settingsArrived = true
          this.migrate()
          this.emit()
        },
        onError,
      ),
      b.watchSetting<AccountsRegistry>(
        uid,
        'accounts',
        (value) => {
          this.registry = value ?? {}
          this.registryArrived = true
          this.publishAccounts()
          this.emit()
        },
        onError,
      ),
      b.watchSetting<AiDoc>(uid, 'ai', (value) => void this.receiveAi(value), onError),
      b.watchPaused(uid, (paused) => {
        const first = !this.pausedArrived
        this.paused = paused
        this.pausedArrived = true
        this.emit()
        // Accounts switched off are known only now, so the first look waits for them too.
        if (first) void this.refresh(false, true)
      }),
    )
  }

  /**
   * Hands a write to the cloud without waiting on it. Firestore only settles
   * a write once the server has it, which offline is never, and nothing here
   * should hang on that: the write is applied on this device at once and
   * reaches the server when it can.
   */
  private send(write: Promise<unknown>): void {
    void write.catch((error: unknown) => runtime.console.error('Inbox sync problem', error))
  }

  /** The key in the cloud wins; a key saved here before signing in is carried up once. */
  private async receiveAi(remote: AiDoc | null): Promise<void> {
    await this.ready()
    const synced = (await this.platform.storage.get(AI_SYNCED_KEY).catch(() => null)) === '1'
    if (remote?.key) {
      const setup = storedAiSetup(JSON.stringify(remote))
      if (JSON.stringify(setup) !== JSON.stringify(this.aiSetup)) {
        this.aiSetup = setup
        this.aiState = {}
        await this.platform.secrets.set(AI_SECRET, JSON.stringify(setup)).catch(() => {})
      }
      if (!synced) await this.platform.storage.set(AI_SYNCED_KEY, '1').catch(() => {})
    } else if (synced) {
      // Removed on another device.
      if (this.aiSetup) {
        this.aiSetup = null
        this.aiState = {}
        await this.platform.secrets.delete(AI_SECRET).catch(() => {})
      }
    } else if (this.aiSetup && this.watching) {
      this.send(this.backend.writeSetting(this.watching, 'ai', { ...this.aiSetup, updatedAt: this.now() }, { replace: true }))
      await this.platform.storage.set(AI_SYNCED_KEY, '1').catch(() => {})
    }
    this.emit()
  }

  /** This device's accounts, for the other to compare against. Written only when they change. */
  private publishAccounts(): void {
    const uid = this.watching
    if (!uid || !this.context || !this.registryArrived) return
    const mine = accountRecords(this.context.accounts)
    const kind = this.kind
    if (mine.length === 0) return
    if (JSON.stringify(this.registry[kind]?.accounts ?? null) === JSON.stringify(mine)) return
    this.registry = { ...this.registry, [kind]: { accounts: mine, updatedAt: this.now() } }
    this.send(this.backend.writeSetting(uid, 'accounts', { [kind]: { accounts: mine, updatedAt: this.now() } }))
  }

  /**
   * The phone kept its inbox, rules and cursors to itself before they were
   * shared. The first time it sees the cloud, whatever the cloud does not
   * have yet is carried up, once.
   */
  private migrate(): void {
    const uid = this.watching
    if (!uid || !this.recordsArrived || !this.readerArrived || !this.settingsArrived) return
    void (async () => {
      const p = this.platform
      if ((await p.storage.get(MIGRATED_KEY).catch(() => null)) === uid) return
      await p.storage.set(MIGRATED_KEY, uid).catch(() => {})
      const now = this.now()
      if (!this.settings.updatedAt && (Object.keys(this.localSenders).length || this.localProfile)) {
        this.send(this.backend.writeSetting(uid, 'inbox', { senders: this.localSenders, profile: this.localProfile, updatedAt: now }))
      }
      const cursors = await load<Record<string, ReadCursor>>(p, OLD.cursors, {})
      if (!this.reader?.cursors && Object.keys(cursors).length) {
        this.send(this.backend.writeSetting(uid, 'reader', { cursors }))
      }
      type OldEntry = { message: MailMessage; reading: ReturnType<typeof readMail>; triage?: MailTriage; foundAt?: number }
      const found = await load<OldEntry[]>(p, OLD.found, [])
      const dismissed = new Set(await load<string[]>(p, OLD.dismissed, []))
      const known = new Set(this.records.map((r) => r.id))
      const carried = found
        .filter((e) => e?.message?.id && !known.has(e.message.id) && !e.message.classroom)
        .map((e) => ({
          ...recordOf(e.message, e.reading, e.foundAt ?? e.message.receivedAt, e.triage),
          ...(dismissed.has(e.message.id) ? { dismissed: true } : {}),
          read: true,
        }))
      if (carried.length) this.send(this.backend.writeInbox(uid, carried))
    })()
  }

  /** Says what turned up, the way a mail app would — but only what matters, and as one notification when a lot arrives at once. */
  private announce(): void {
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
      const due = r.triage?.task ?? (r.classroom?.due ? { title: r.subject, ...r.classroom.due } : undefined)
      void this.platform.notify({
        title: r.classroom?.course ?? r.triage?.folder ?? (due ? 'A deadline in your mail' : 'Important email'),
        body: r.triage?.summary ?? due?.title ?? r.subject,
        tag: r.id,
      })
    }
  }

  private senders(): Record<string, SenderRule> {
    return this.watching ? (this.settings.senders ?? {}) : this.localSenders
  }

  private profile(): string {
    const text = this.watching ? this.settings.profile : this.localProfile
    return text?.trim() || DEFAULT_PROFILE
  }

  private readable(feature?: Feature): Account[] {
    const accounts = this.context?.accounts ?? []
    return accounts.filter((a) => (feature ? readingOn(a, feature, this.paused) : readingOn(a, 'mail', this.paused) || readingOn(a, 'classroom', this.paused)))
  }

  private gaps(): AccountGap[] {
    const other = this.kind === 'desktop' ? 'phone' : 'desktop'
    return accountGaps(this.registry[other]?.accounts ?? [], this.context?.accounts ?? [], { ignore: this.kind === 'phone' ? ['files'] : [] })
  }

  /**
   * A computer missing a permission the phone has leaves the reading to the
   * phone rather than reading half of it. A phone reads what it can whenever
   * the computer is away.
   */
  private canRead(): boolean {
    if (this.readable().length === 0) return false
    return this.kind === 'phone' || this.gaps().every((g) => g.missing.every((s) => s === 'files'))
  }

  private choice(force = false): ReaderChoice {
    return chooseReader(this.reader?.lease, { deviceId: this.deviceId, kind: this.kind, canRead: this.canRead() }, this.now(), { force })
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
    const readable = this.readable()
    const classroomReadable = this.readable('classroom')
    const mailReaders = this.readable('mail').map((a) => a.identity.email)
    const choice = this.deviceId ? this.choice() : { reader: 'nobody' as const }
    const heartbeat = this.reader?.lease?.heartbeatAt ?? null
    return {
      signedIn: !!this.watching,
      records,
      mail,
      classroom,
      folders: inboxFolders(mail),
      mailAccounts: accountChips(accountsIn(mail, mailReaders)),
      classroomAccounts: accountChips(accountsIn(classroom, classroomReadable.map((a) => a.identity.email))),
      readable,
      classroomReadable,
      refreshing: this.refreshing,
      error: this.error,
      checkedAt: Math.max(this.lastRun ?? 0, heartbeat ?? 0) || null,
      reader: choice.reader,
      unseen: mail.filter((r) => r.foundAt > this.seenAt && !r.read && isImportant(r, senders)).length,
      unseenClassroom: classroom.filter((r) => r.foundAt > this.seenClassroomAt && !r.read && !r.classroom?.submitted).length,
      ai: { on: this.aiSetup !== null, preferred: this.aiSetup ? modelsFor(this.aiSetup)[0]?.label : undefined, ...this.aiState },
      profile: this.profile(),
      senders,
      autoTasks: this.settings.autoTasks === true,
      gaps: this.gaps(),
    }
  }

  /**
   * Reads if this device is the reader, or always with `manual` — Sync now —
   * which reads here once whoever holds the claim.
   */
  async refresh(manual = false, first = false): Promise<void> {
    await this.ready()
    const uid = this.watching
    const context = this.context
    if (!uid || !context || this.busy) return
    const now = this.now()
    if (now < this.holdUntil && !manual) return
    if (!manual && !first && now - this.lastAttempt < MIN_GAP_MS) return
    if (!this.readerArrived || !this.pausedArrived) return
    const choice = this.choice(manual)
    if (!choice.read) {
      this.emit()
      return
    }
    this.busy = true
    this.lastAttempt = now
    this.refreshing = true
    this.error = null
    this.emit()
    const beat = runtime.setInterval(() => {
      // A slow model can keep one read going past the time a claim is
      // trusted for, so the claim is renewed while it works.
      if (choice.holds) this.send(this.backend.writeSetting(uid, 'reader', { lease: this.lease() }))
    }, POLL_MS)
    try {
      await this.read(uid, context, choice.holds)
      this.lastRun = this.now()
    } catch (error) {
      this.error = message(error)
    } finally {
      runtime.clearInterval(beat)
      this.busy = false
      this.refreshing = false
      this.emit()
    }
  }

  private lease(): ReaderLease {
    return { deviceId: this.deviceId, kind: this.kind, heartbeatAt: this.now() }
  }

  private async read(uid: string, context: InboxContext, holds: boolean): Promise<void> {
    const r = this.readers
    const cursors: Record<string, ReadCursor> = JSON.parse(JSON.stringify(this.reader?.cursors ?? {}))
    const known = new Map(this.records.map((rec) => [rec.id, rec]))
    const messages: MailMessage[] = []
    const work: ClassroomItem[] = []
    const problems: string[] = []
    const ai = this.aiSetup

    for (const account of this.readable()) {
      const sub = account.identity.sub
      const cursor: ReadCursor = { ...cursors[sub] }
      const mail = readingOn(account, 'mail', this.paused)
      const classes = readingOn(account, 'classroom', this.paused)
      try {
        const { accessToken } = await r.accessToken(this.platform, account)
        if (mail) {
          if (!cursor.mail) {
            // First look: note where the mailbox is and read nothing yet.
            cursor.mail = await r.mailCursor(accessToken)
          } else {
            try {
              // With a model to sort it, Promotions is worth reading: hackathons and job posts land there.
              const result = await r.mailSince(accessToken, account.identity.email, cursor.mail, undefined, { everyTab: ai !== null })
              cursor.mail = result.cursor
              for (const m of result.messages) {
                // Another device, or an earlier look, already has it.
                if (known.has(m.id)) continue
                // With Classroom read directly, its notification emails would only repeat it.
                if (classes && readMail(m, this.now()).kind === 'classroom') continue
                messages.push(m)
              }
            } catch (e) {
              // Away longer than Gmail keeps history: pick up from now rather than replay.
              if (e instanceof MailCursorExpired) cursor.mail = await r.mailCursor(accessToken)
              else throw e
            }
          }
        }
        if (classes) {
          const since = (cursor.classroomSince ||= this.now())
          const feed = await r.classroomFeed(accessToken, { announcements: readsAnnouncements(account) })
          work.push(...feed.work)
          const posts = [
            ...feed.work.map((item) => {
              const post = courseWorkMessage(item, account.identity.email)
              return { ...post, classroom: { ...post.classroom!, submitted: item.submitted } }
            }),
            ...feed.announcements.map(({ course, announcement }) => announcementMessage(course, announcement, account.identity.email)),
          ]
          // The first look after switching on takes in what was already there, quietly.
          const seen = new Set(cursor.classroomSeen ?? posts.filter((p) => p.receivedAt < since).map((p) => p.id))
          for (const post of posts) {
            if (seen.has(post.id)) continue
            seen.add(post.id)
            if (!known.has(post.id) && !post.classroom?.submitted) messages.push(post)
          }
          cursor.classroomSeen = [...seen].slice(-KEEP_SEEN)
          if (feed.skipped.length) runtime.console.warn('Classroom would not open', feed.skipped.join(', '))
        }
      } catch (e) {
        if (e instanceof GoogleApiError && e.rateLimited) this.holdUntil = this.now() + BACKOFF_MS
        problems.push(`${account.identity.email}: ${message(e)}`)
      }
      cursors[sub] = cursor
    }

    // Coursework handed in since it was found shows as handed in.
    const handedIn = new Map(work.map((w) => [`classroom-work-${w.work.id}`, w.submitted]))
    const changed: InboxRecord[] = []
    for (const rec of this.records) {
      const submitted = handedIn.get(rec.id)
      if (submitted !== undefined && rec.classroom && !!rec.classroom.submitted !== submitted) {
        changed.push({ ...rec, classroom: { ...rec.classroom, submitted }, updatedAt: this.now() })
      }
    }

    const found = this.now()
    let fresh = messages.map((m) => recordOf(m, readMail(m, found), found))
    const texts: Pending = {}
    for (const m of messages) if (m.text) texts[m.id] = { text: m.text.slice(0, TRIAGE_BODY_LIMIT), foundAt: found }
    const ruled = this.senders()
    // Mail from a sender the person ruled on is not sent to the model at all.
    const toSort = ai ? fresh.filter((rec) => !ruled[senderAddress(rec.from)]) : []
    if (toSort.length) fresh = fresh.map((rec) => (toSort.includes(rec) ? { ...rec, sorting: true } : rec))

    // Everything found shows at once, on every device: on NVIDIA's free
    // tier the model can take a minute or two per email, and that is no
    // reason to wait. The cursors go with it, so whichever device reads next
    // carries on from here; the text of anything still to be sorted stays
    // on this device, so it can be sorted later.
    let base = mergeInbox(this.records, [...fresh, ...changed])
    // Without a model to wait for, new posts become tasks in the same write.
    if (!ai) base = await this.autoTasks(base, context)
    const writes = inboxWrites(this.records, base)
    if (writes.length) this.send(this.backend.writeInbox(uid, writes))
    this.send(this.backend.writeSetting(uid, 'reader', holds ? { lease: this.lease(), cursors } : { cursors }))
    if (ai) {
      this.pending = { ...this.pending, ...texts }
      save(this.platform, PENDING_KEY, this.pending)
    }

    if (ai) {
      // Mail the model missed last time, while it is still recent, gets another go.
      const recent = base.filter(
        (rec) => !rec.triage && !rec.dismissed && this.pending[rec.id] && this.now() - this.pending[rec.id]!.foundAt < RETRY_FOR_MS && !ruled[senderAddress(rec.from)],
      )
      const retry = recent.filter((rec) => !fresh.some((f) => f.id === rec.id)).slice(0, RETRY_AT_ONCE)
      const sorted = await this.sort(ai, [...fresh.filter((f) => f.sorting), ...retry])
      const done = new Set(sorted.map((s) => s.id))
      // Whatever the model could not read is shown on the rules' reading, and tried again later.
      const settled = [...sorted, ...fresh.filter((f) => f.sorting && !done.has(f.id)).map(({ sorting: _s, ...rest }) => rest as InboxRecord)]
      const finished = await this.autoTasks(mergeInbox(base, settled), context)
      const second = inboxWrites(base, finished)
      if (second.length) this.send(this.backend.writeInbox(uid, second))
      for (const id of done) delete this.pending[id]
    }
    // Text kept for sorting later is let go once it is too old to be worth it.
    for (const [id, p] of Object.entries(this.pending)) if (this.now() - p.foundAt > RETRY_FOR_MS) delete this.pending[id]
    save(this.platform, PENDING_KEY, this.pending)

    await this.applyClassroom(work, context)
    const overflow = inboxOverflow(this.records)
    if (overflow.length) this.send(this.backend.deleteInbox(uid, overflow))
    if (problems.length) this.error = problems.join('\n')
  }

  /**
   * Has the model read each record, a few at a time. When it cannot be
   * reached, the record keeps the rules' reading and is tried again on a
   * later look — nothing is lost, it is just sorted later.
   */
  private async sort(setup: AiSetup, records: InboxRecord[]): Promise<InboxRecord[]> {
    const folders = inboxFolders(this.records.filter((rec) => !rec.classroom))
    const out: InboxRecord[] = []
    let failure: string | undefined
    let model: string | undefined
    let stop = false
    await eachLimit(records, AI_AT_ONCE, async (rec) => {
      if (stop) return
      try {
        const text = this.pending[rec.id]?.text
        const triage = await this.readers.triageMail(setup, messageOf(rec, text), { now: this.now(), folders, timeZone: timeZone(), profile: this.profile() }, { fetchFn: this.platform.aiFetch })
        if (!triage) return
        const { sorting: _sorting, ...rest } = rec
        out.push({ ...rest, triage, updatedAt: this.now() })
        model = triage.model
        // Later messages in this batch should reuse a folder an earlier one made.
        if (triage.folder && !folders.includes(triage.folder)) folders.push(triage.folder)
      } catch (e) {
        failure = message(e)
        // A wrong key or a long silence will not improve within this batch.
        if (e instanceof AiError && (e.badKey || e.rateLimited)) stop = true
      }
    })
    // Any answer at all means it works; a failure only stands when nothing answered.
    if (model) this.aiState = { model }
    else if (failure) this.aiState = { ...this.aiState, error: failure }
    return out
  }

  /**
   * With automatic tasks on, new coursework and announcements become tasks
   * here and are marked as done on the record, so no device makes the same
   * one again.
   */
  private async autoTasks(records: InboxRecord[], context: InboxContext): Promise<InboxRecord[]> {
    if (!this.settings.autoTasks || !context.userId) return records
    const existing = new Set((await context.reminders.list({ includeDeleted: true })).map((t) => t.id))
    const plan = planAutoTasks(records, existing, true, this.now())
    if (plan.length === 0) return records
    const now = this.now()
    const senders = this.senders()
    const tasks = plan.map((rec) => {
      const { id, input } = taskFromInbox(rec, { now, important: rec.classroom?.kind === 'work' || isImportant(rec, senders), automatic: true })
      return createReminder(input, { userId: context.userId!, now, id })
    })
    await context.reminders.upsertMany(tasks)
    const made = new Set(plan.map((p) => p.id))
    return records.map((rec) => (made.has(rec.id) ? { ...rec, tasked: true, updatedAt: now } : rec))
  }

  /**
   * Keeps tasks already made from Classroom in step with it: completed once
   * the work is handed in, moved when the teacher moves the deadline.
   */
  private async applyClassroom(items: ClassroomItem[], context: InboxContext): Promise<void> {
    const now = this.now()
    const writes: Reminder[] = []
    for (const { work, submitted } of items) {
      const existing = await context.reminders.get(classroomTaskId(work.id))
      if (!existing || existing.deletedAt !== undefined || existing.status === 'done') continue
      const due = classroomDueAt(work)
      if (submitted && existing.autoCompleteOn === 'classroom-submission') {
        writes.push(completeReminder(existing, now))
      } else if (due && (existing.title !== work.title || existing.dueAt !== due.dueAt)) {
        writes.push(updateReminder(existing, { title: work.title, dueAt: due.dueAt, allDay: due.allDay }, now))
      }
    }
    if (writes.length) await context.reminders.upsertMany(writes)
  }

  /** Called when Gmail or Classroom is switched on for an account, so reading starts from that moment. */
  async startFresh(sub: string, feature: Feature): Promise<void> {
    const uid = this.watching
    if (!uid) return
    const cursor: ReadCursor = feature === 'mail' ? { mail: '' } : { classroomSince: 0, classroomSeen: null }
    this.send(this.backend.writeSetting(uid, 'reader', { cursors: { [sub]: cursor } }))
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
    const address = senderAddress(record.from)
    if (this.watching) {
      this.settings = { ...this.settings, senders: { ...this.settings.senders, [address]: rule } }
      this.emit()
      this.send(this.backend.writeSetting(this.watching, 'inbox', { senders: { [address]: rule }, updatedAt: this.now() }))
    } else {
      this.localSenders = { ...this.localSenders, [address]: rule }
      save(this.platform, OLD.senders, this.localSenders)
      this.emit()
    }
  }

  /** Opening a tab is seeing what is in it. */
  markSeen(tab: 'inbox' | 'classroom'): void {
    const now = this.now()
    if (tab === 'inbox') {
      if (this.state.unseen === 0 && this.seenAt) return
      this.seenAt = now
      save(this.platform, SEEN_KEY, now)
    } else {
      if (this.state.unseenClassroom === 0 && this.seenClassroomAt) return
      this.seenClassroomAt = now
      save(this.platform, SEEN_CLASSROOM_KEY, now)
    }
    this.emit()
  }

  /** Saves, or with null forgets, the NVIDIA key — here and for every device. */
  async setAiSetup(setup: AiSetup | null): Promise<void> {
    if (setup) await this.platform.secrets.set(AI_SECRET, JSON.stringify(setup)).catch(() => {})
    else await this.platform.secrets.delete(AI_SECRET).catch(() => {})
    this.aiSetup = setup
    this.aiState = {}
    this.emit()
    const uid = this.watching
    if (!uid) return
    await this.platform.storage.set(AI_SYNCED_KEY, '1').catch(() => {})
    if (setup) this.send(this.backend.writeSetting(uid, 'ai', { ...setup, updatedAt: this.now() }, { replace: true }))
    else this.send(this.backend.deleteSetting(uid, 'ai'))
  }

  /** What matters to the person; empty goes back to the default. */
  async setProfile(text: string): Promise<void> {
    const tidy = text.trim().slice(0, PROFILE_LIMIT)
    const value = tidy === DEFAULT_PROFILE ? '' : tidy
    if (this.watching) {
      this.settings = { ...this.settings, profile: value }
      this.emit()
      this.send(this.backend.writeSetting(this.watching, 'inbox', { profile: value, updatedAt: this.now() }))
    } else {
      this.localProfile = value
      void this.platform.storage.set(OLD.profile, value).catch(() => {})
      this.emit()
    }
  }

  async setAutoTasks(on: boolean): Promise<void> {
    const uid = this.watching
    if (!uid) return
    this.settings = { ...this.settings, autoTasks: on }
    this.emit()
    this.send(this.backend.writeSetting(uid, 'inbox', { autoTasks: on, updatedAt: this.now() }))
    // Recent posts still open become tasks straight away, not at the next look.
    if (on && this.context) {
      const made = await this.autoTasks(this.records, this.context)
      const writes = inboxWrites(this.records, made)
      if (writes.length) this.send(this.backend.writeInbox(uid, writes))
    }
  }
}

/** Who reads the mail and when they last looked, in a line: "Read by your computer · checked 4 min ago". */
export function readerStatus(state: Pick<InboxState, 'reader' | 'checkedAt' | 'refreshing'>, here: DeviceKind, now: number): string {
  if (state.refreshing) return 'Checking now…'
  const who =
    state.reader === 'here'
      ? here === 'phone'
        ? 'Read on this phone'
        : 'Read on this computer'
      : state.reader === 'desktop'
        ? here === 'desktop'
          ? 'Read by your other computer'
          : 'Read by your computer'
        : state.reader === 'phone'
          ? 'Read by your phone'
          : 'Not being read yet'
  return state.checkedAt ? `${who} · checked ${formatAgo(state.checkedAt, now)}` : who
}
