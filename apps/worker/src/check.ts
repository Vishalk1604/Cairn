import {
  addLocalDays,
  classroomMailMessage,
  classroomPostKey,
  completeReminder,
  createReminder,
  DAY,
  digestKey,
  dueDigest,
  dueDigests,
  inboxTaskId,
  isImportant,
  KEEP_RECORDS,
  messageOf,
  parseClassroomMail,
  planAutoTasks,
  readMail,
  recordOf,
  senderAddress,
  startOfLocalDay,
  taskFromInbox,
  todayDigest,
  TRIAGE_BODY_LIMIT,
  updateReminder,
  type InboxRecord,
  type MailMessage,
  type MailReading,
  type MailTriage,
  type Reminder,
  type SenderRule,
} from '@cairn/core'
import { AiError, triageMail, type AiSetup } from '@cairn/sync/ai'
import { announcementMessage, courseWorkMessage, GoogleApiError, type Course } from '@cairn/sync/google'
import { CLASSROOM_BLOCKED, type InboxSettings, type ReaderDoc } from '@cairn/sync/worker'
import { aiSetupOf, classroomByEmail, publishAccounts } from './accounts'
import { openJson, sealJson, SealError } from './crypto'
import { sendPush, type Push } from './fcm'
import type { Firestore, Write } from './firestore'
import { bodyText, classroomHtml, courseFeed, courses, CursorExpired, header, mailAdded, mailCursor, mailMessage, NEVER, NOISY, servicesOf, type GmailMessage } from './google'
import { announcements, worthAnnouncing } from './notify'
import { accessToken, AccountSignedOut, firestoreFor, type Ctx } from './session'
import type { AccountRow, UserRow } from './store'
import { Zone, zoneName } from './zone'

/**
 * One person's check: what the Worker does for each of them every ten
 * minutes, and when they press Sync.
 *
 * It reads what is new in each connected account's Gmail and Classroom,
 * writes a record of each to their Firestore inbox straight away, has the
 * model sort what it can in the time it has, makes tasks of new Classroom
 * posts when they asked for that, keeps those tasks in step with Classroom,
 * and tells their phone. Where it got to is kept in D1, sealed, for the next
 * run; a little of it is copied to settings/reader for the apps to show.
 *
 * The free plan gives one invocation 10 ms of CPU and 50 requests out, so
 * the work is cut to fit: a handful of messages and courses per run, the
 * rest the next time round.
 */

/** A run holds the person for at most this long, so a crashed one never blocks the next for good. */
const LEASE_MS = 9 * 60_000
/** New mail fetched per account per run; the rest waits in a queue for the next run. */
const MAIL_PER_RUN = 8
const MAIL_QUEUE = 60
const MAIL_SEEN = 300
/** Courses looked at per account per run, in turn. Each costs three requests. */
const COURSES_PER_RUN = 4
const COURSES_TTL = 6 * 60 * 60_000
const POSTS_SEEN = 600
const WORK_KEPT = 300
/** Messages put to the model per run, a few at once. */
const AI_PER_RUN = 6
const AI_AT_ONCE = 3
/** A message the model could not read is tried again, a few times, while it is still news. */
const AI_TRIES = 3
const AI_RETRY_FOR = 3 * DAY
/** Requests kept back while reading, for the writes and the push that make anything visible. */
const KEEP_FOR_WRITES = 16
/** Requests kept back while asking the model. */
const KEEP_FOR_PUSH = 8
/** settings/inbox is read again after this long, or sooner when there is something to sort. */
const SETTINGS_TTL = 60 * 60_000
const SETTINGS_FRESH = 10 * 60_000
/** settings/reader is rewritten at least this often, so the apps can tell checks are running. */
const HEARTBEAT_MS = 15 * 60_000
const ANNOUNCED_KEPT = 300
const OVERFLOW_SLACK = 25
const CLASSROOM_SENDER = /classroom\.google\.com/i
/** With Classroom's API turned away, it is tried again this often in case the college changes its mind. */
const BLOCKED_RETRY = DAY
/** Posts remembered by course and title, to match one read from email with the API's. */
const POST_KEYS = 300

interface MailState {
  cursor?: string
  /** Ids found in the history but not fetched yet. */
  queue?: string[]
  seen?: string[]
  /** Whether reading was on last run: switching it on starts from that moment. */
  on?: boolean
}

interface WorkState {
  title: string
  due?: number
  allDay?: boolean
  submitted: boolean
}

interface ClassState {
  /** When Classroom was first read: anything posted before is not news. */
  since?: number
  courses?: Course[]
  coursesAt?: number
  /** Where the round of courses got to. */
  next?: number
  seen?: string[]
  work?: Record<string, WorkState>
  on?: boolean
  /** When the API last turned the account away; until a day on, Classroom is read from email. */
  blockedAt?: number
}

interface Pending {
  record: InboxRecord
  text?: string
  tries: number
}

export interface UserState {
  mail: Record<string, MailState>
  classroom: Record<string, ClassState>
  /** Waiting for the model, with the text it needs: the only place a message body is kept, sealed. */
  pending: Record<string, Pending>
  /** Folders the model has used, oldest first, so it reuses them. */
  folders: string[]
  announced: string[]
  /** Every record written, newest first, so the oldest can be deleted past KEEP_RECORDS. */
  recent: [string, number][]
  settings?: { value: InboxSettings; at: number }
  /** Digests sent, by digestKey. */
  sent: string[]
  reader?: { at: number; hash: string }
  ai?: { model?: string; error?: string }
  /** Posts the API read, by classroomPostKey, so the same post from an email is let go. */
  apiPosts?: string[]
  /** Posts read from email without the ids to match the API's, by classroomPostKey, with their record id. */
  emailPosts?: [string, string][]
}

export function emptyState(): UserState {
  return { mail: {}, classroom: {}, pending: {}, folders: [], announced: [], recent: [], sent: [], apiPosts: [], emailPosts: [] }
}

/**
 * The Classroom API turning a whole account away: the college's admin has
 * it off for students (ClassroomApiDisabled, PERMISSION_DENIED) or the
 * permission is missing. Not a rate limit, and not a sign-out.
 */
function classroomRefused(error: unknown): boolean {
  return error instanceof GoogleApiError && error.status === 403 && !error.rateLimited
}

export const stateContext = (uid: string) => `state:${uid}`

export interface CheckOptions {
  /** The model is asked nothing new after this; what is left waits for the next run. */
  aiUntil: number
  /** The real clock, for the deadline. */
  clock?: () => number
}

export interface CheckResult {
  checkedAt: number
  /** Records written for the first time. */
  found: number
  /** Another run had this person already. */
  busy?: boolean
  errors: string[]
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Every instant in a message, onto the wall clock (see zone.ts). */
function onWall(m: MailMessage, zone: Zone): MailMessage {
  const post = m.classroom
  return {
    ...m,
    receivedAt: zone.toWall(m.receivedAt),
    ...(post ? { classroom: { ...post, ...(post.due ? { due: { ...post.due, dueAt: zone.toWall(post.due.dueAt) } } : {}) } } : {}),
  }
}

function recordOnWall(r: InboxRecord, zone: Zone): InboxRecord {
  const moved = onWall(r as unknown as MailMessage, zone) as unknown as InboxRecord
  return {
    ...moved,
    reading: r.reading.dueAt === undefined ? r.reading : { ...r.reading, dueAt: zone.toWall(r.reading.dueAt) },
    ...(r.triage?.task ? { triage: { ...r.triage, task: { ...r.triage.task, dueAt: zone.toWall(r.triage.task.dueAt) } } } : {}),
  }
}

/** The plain rules' reading of a message, on the person's clock. */
function reading(m: MailMessage, now: number, zone: Zone): MailReading {
  const read = readMail(onWall(m, zone), zone.toWall(now))
  return read.dueAt === undefined ? read : { ...read, dueAt: zone.fromWall(read.dueAt) }
}

/**
 * Coursework as the inbox reads it. Classroom gives a due date without a
 * time as a calendar day, which core anchors at nine in the morning on the
 * local clock — here UTC — so it is moved onto the person's.
 */
function workMessage(course: Course, work: Parameters<typeof courseWorkMessage>[0]['work'], submitted: boolean, account: string, zone: Zone): MailMessage {
  const m = courseWorkMessage({ course, work, submitted }, account)
  const due = m.classroom!.due
  return {
    ...m,
    classroom: { ...m.classroom!, submitted, ...(due?.allDay ? { due: { dueAt: zone.fromWall(due.dueAt), allDay: true } } : {}) },
  }
}

/** The task a record offers, made automatically, with its times on the person's clock. */
function autoTask(record: InboxRecord, now: number, zone: Zone, important: boolean): { id: string; input: ReturnType<typeof taskFromInbox>['input'] } {
  const { id, input } = taskFromInbox(recordOnWall(record, zone), { now: zone.toWall(now), important, automatic: true })
  return { id, input: { ...input, dueAt: zone.fromWall(input.dueAt) } }
}

class Timeout extends Error {}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([work, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Timeout()), ms)))]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!)
    }),
  )
}

/** Runs the check for one person, unless a run for them is already going. */
export async function checkUser(ctx: Ctx, uid: string, options: CheckOptions): Promise<CheckResult> {
  const { env, store, now } = ctx
  const user = await store.user(uid)
  if (!user) return { checkedAt: now, found: 0, errors: ['Nobody by that id'] }
  if (!(await store.claim(uid, now + LEASE_MS, now))) return { checkedAt: now, found: 0, busy: true, errors: [] }
  let state: UserState | null = null
  try {
    state = await loadState(ctx, user)
    return await new Check(ctx, user, state, options).run()
  } finally {
    await store.finish(uid, state ? await sealJson(env, state, stateContext(uid)) : null)
  }
}

async function loadState(ctx: Ctx, user: UserRow): Promise<UserState> {
  if (!user.state) return emptyState()
  try {
    return { ...emptyState(), ...(await openJson<UserState>(ctx.env, user.state, stateContext(user.uid))) }
  } catch (error) {
    // Sealed under a key since replaced: start over rather than stop for good.
    if (error instanceof SealError || error instanceof SyntaxError) return emptyState()
    throw error
  }
}

interface WorkChange {
  message: MailMessage
  before: WorkState
  after: WorkState
}

class Check {
  private readonly zone: Zone
  private readonly errors: string[] = []
  private readonly status: Record<string, { checkedAt?: number; error?: string }> = {}
  private readonly messages: MailMessage[] = []
  private readonly changes: WorkChange[] = []
  private settings: InboxSettings = {}
  private ai: AiSetup | null = null
  private fs!: Firestore
  private accountsChanged = false
  /** Whether any account is read at all. */
  private watching = false

  constructor(
    private readonly ctx: Ctx,
    private readonly user: UserRow,
    private readonly state: UserState,
    private readonly options: CheckOptions,
  ) {
    this.zone = new Zone(zoneName(user.timeZone ?? state.settings?.value.timeZone))
    this.settings = state.settings?.value ?? {}
  }

  private get uid(): string {
    return this.user.uid
  }

  private get senders(): Record<string, SenderRule> {
    return this.settings.senders ?? {}
  }

  async run(): Promise<CheckResult> {
    const { store, now } = this.ctx
    const accounts = await store.accounts(this.uid)
    const owner = accounts.find((a) => a.role === 'owner')
    if (!owner) return { checkedAt: now, found: 0, errors: ['No account holds this person’s data'] }
    // Nothing to read and no phone to tell: nothing to do, and nothing worth a write.
    this.watching = accounts.some((a) => a.watchMail || a.watchClassroom)
    if (!this.watching && (await store.pushTokens(this.uid)).length === 0) return { checkedAt: now, found: 0, errors: [] }
    this.ai = await aiSetupOf(this.ctx.env, this.user)
    try {
      this.fs = await firestoreFor(this.ctx, this.uid, owner)
    } catch (error) {
      // Without a session nothing can be written; the phone sees the account's problem through /accounts.
      return { checkedAt: now, found: 0, errors: [message(error)] }
    }

    for (const account of accounts) await this.read(account)

    const fresh = this.messages.length > 0 || this.changes.length > 0
    await this.loadSettings(fresh)
    const found = await this.record()
    await this.digests()
    await this.writeReader()
    if (this.accountsChanged) await publishAccounts(this.ctx, this.uid, this.fs).catch((e: unknown) => this.errors.push(message(e)))
    return { checkedAt: now, found, errors: this.errors }
  }

  // ------------------------------------------------------------ reading

  private async read(account: AccountRow): Promise<void> {
    const { now } = this.ctx
    const services = servicesOf(account.scopes)
    const mail = account.watchMail && services.includes('mail')
    const classroom = account.watchClassroom && services.includes('classroom')
    const mailState = (this.state.mail[account.email] ??= {})
    const classState = (this.state.classroom[account.email] ??= {})
    // Switched on since the last run: start from now, not from wherever it was left.
    if (classroom && !classState.on) Object.assign(classState, { since: undefined, seen: [], work: {}, next: 0, blockedAt: undefined })
    classState.on = classroom
    // Turned away by the API: Classroom's own emails stand in for it, and the API is tried again a day on.
    const api = classroom && (classState.blockedAt === undefined || now - classState.blockedAt >= BLOCKED_RETRY)
    let byEmail = classroomByEmail(account) && !api
    const gmail = () => mail || byEmail
    if (gmail() && !mailState.on) Object.assign(mailState, { cursor: undefined, queue: [], seen: [] })
    if (!gmail() && !api) {
      mailState.on = false
      return
    }
    if (!this.ctx.net.can(2, KEEP_FOR_WRITES)) return
    try {
      const { accessToken: token } = await accessToken(this.ctx, account, 'run')
      if (api) {
        try {
          await this.readClassroom(account, token, classState, services.includes('announcements'))
          if (account.problem === CLASSROOM_BLOCKED) await this.classroomProblem(account, null)
          classState.blockedAt = undefined
        } catch (error) {
          if (!classroomRefused(error)) throw error
          classState.blockedAt = now
          await this.classroomProblem(account, CLASSROOM_BLOCKED)
          // Straight to the emails, this run: Gmail is read below.
          byEmail = services.includes('mail')
          if (byEmail && !mailState.on) Object.assign(mailState, { cursor: undefined, queue: [], seen: [] })
        }
      }
      mailState.on = gmail()
      if (gmail()) await this.readMail(account, token, mailState, { mail, classroomApi: classroom && !byEmail, byEmail })
      this.status[account.email] = { checkedAt: this.ctx.now }
    } catch (error) {
      if (error instanceof AccountSignedOut) this.accountsChanged = true
      this.status[account.email] = { error: message(error) }
      this.errors.push(`${account.email}: ${message(error)}`)
    }
  }

  /** Records, or clears, why an account's Classroom is read from email, for the phone to show. */
  private async classroomProblem(account: AccountRow, problem: string | null): Promise<void> {
    const row = await this.ctx.store.account(this.uid, account.email)
    if (!row || row.problem === problem || (problem === null && row.problem !== CLASSROOM_BLOCKED)) return
    // Being signed out says more, and is not overwritten.
    if (problem && row.problem && row.problem !== CLASSROOM_BLOCKED) return
    await this.ctx.store.putAccount({ ...row, problem })
    account.problem = problem
    this.accountsChanged = true
  }

  private async readMail(account: AccountRow, token: string, m: MailState, read: { mail: boolean; classroomApi: boolean; byEmail: boolean }): Promise<void> {
    const { net, now } = this.ctx
    const sorting = this.ai !== null
    if (!m.cursor) {
      m.cursor = await mailCursor(net.fetch, token)
      return
    }
    const seen = new Set(m.seen ?? [])
    try {
      // With a model to sort it, Promotions is worth reading: hackathons and job posts land there.
      const added = await mailAdded(net.fetch, token, m.cursor, sorting ? NEVER : [...NEVER, ...NOISY])
      m.cursor = added.cursor
      m.queue = [...new Set([...(m.queue ?? []), ...added.ids])].filter((id) => !seen.has(id)).slice(-MAIL_QUEUE)
    } catch (error) {
      // Away longer than Gmail keeps history: pick up from now rather than replay.
      if (!(error instanceof CursorExpired)) throw error
      m.cursor = await mailCursor(net.fetch, token)
      m.queue = []
      return
    }
    const queue = m.queue ?? []
    let take = 0
    while (take < queue.length && take < MAIL_PER_RUN && net.can(take + 1, KEEP_FOR_WRITES)) take++
    const batch = queue.slice(0, take)
    const fetched = await Promise.all(batch.map((id) => mailMessage(net.fetch, token, id, sorting)))
    m.queue = queue.slice(take)
    for (const [i, got] of fetched.entries()) {
      seen.add(batch[i]!)
      if (!got) continue
      const labels = got.labelIds ?? []
      const fromClassroom = CLASSROOM_SENDER.test(header(got, 'from'))
      // Read only for Classroom's emails, the rest is not this person's to have read.
      if (!read.mail && !(read.byEmail && fromClassroom)) continue
      if (labels.some((l) => NEVER.includes(l)) || (!sorting && !fromClassroom && labels.some((l) => NOISY.includes(l)))) continue
      const found: MailMessage = {
        id: got.id,
        account: account.email,
        from: header(got, 'from'),
        subject: header(got, 'subject'),
        snippet: got.snippet ?? '',
        receivedAt: Number(got.internalDate) || now,
        ...(got.threadId ? { threadId: got.threadId } : {}),
        ...(sorting ? { text: bodyText(got) } : {}),
      }
      if (fromClassroom) {
        // With Classroom read directly, its notification emails would only repeat it.
        if (read.classroomApi) continue
        if (read.byEmail) {
          const post = await this.classroomEmail(token, got, found)
          if (post !== undefined) {
            if (post) this.messages.push(post)
            continue
          }
        }
      }
      this.messages.push(found)
    }
    m.seen = [...seen].slice(-MAIL_SEEN)
  }

  /**
   * A Classroom notification email as the post it announces, null when it is
   * one already shown (or not shown at all, like course material), and
   * undefined when it is not a post — a grade, a comment — to leave as mail.
   */
  private async classroomEmail(token: string, got: GmailMessage, found: MailMessage): Promise<MailMessage | null | undefined> {
    const { net } = this.ctx
    // Without a model the body was not fetched; Classroom's emails need theirs.
    let full = got
    if (!got.payload?.parts && !got.payload?.body?.data) {
      if (!net.can(1, KEEP_FOR_WRITES)) return null
      full = (await mailMessage(net.fetch, token, got.id, true)) ?? got
    }
    const message = { ...found, text: found.text ?? bodyText(full) }
    const parsed = parseClassroomMail(onWall(message, this.zone), classroomHtml(full))
    if (!parsed) return undefined
    const due = parsed.due ? { ...parsed, due: { ...parsed.due, dueAt: this.zone.fromWall(parsed.due.dueAt) } } : parsed
    const post = classroomMailMessage(message, due)
    if (!post) return null
    const key = classroomPostKey(parsed.course, parsed.title)
    const known = Object.values(this.state.classroom).some((c) => c.seen?.includes(post.id))
    if (known || this.state.apiPosts?.includes(key)) return null
    if (post.id.startsWith('classroom-email-')) this.state.emailPosts = [...(this.state.emailPosts ?? []).filter(([k]) => k !== key), [key, post.id] as [string, string]].slice(-POST_KEYS)
    return post
  }

  private async readClassroom(account: AccountRow, token: string, c: ClassState, withAnnouncements: boolean): Promise<void> {
    const { net, now } = this.ctx
    c.since ??= now
    if (!c.courses || now - (c.coursesAt ?? 0) > COURSES_TTL) {
      c.courses = (await courses(net.fetch, token)).map(({ id, name, section, creationTime }) => ({ id, name, ...(section ? { section } : {}), ...(creationTime ? { creationTime } : {}) }))
      c.coursesAt = now
    }
    const list = c.courses
    const per = Math.min(list.length, COURSES_PER_RUN, Math.floor((net.left() - KEEP_FOR_WRITES) / 3))
    if (per <= 0) return
    const start = (c.next ?? 0) % list.length
    const picked = Array.from({ length: per }, (_, i) => list[(start + i) % list.length]!)
    c.next = (start + per) % list.length
    const seen = new Set(c.seen ?? [])
    const work = (c.work ??= {})
    const feeds = await Promise.all(
      picked.map((course) =>
        courseFeed(net.fetch, token, course, withAnnouncements).then(
          (feed) => ({ course, feed }),
          (error: unknown) => ({ course, error }),
        ),
      ),
    )
    for (const result of feeds) {
      if ('error' in result) {
        const error = result.error
        // One archived or odd course must not hide the others; a refusal of the whole account must.
        if (!(error instanceof GoogleApiError) || error.rateLimited || error.status === 401) throw error
        console.warn('Classroom would not open', result.course.name, error.message)
        continue
      }
      const { course, feed } = result
      for (const item of feed.work) {
        const submitted = feed.submitted.has(item.id)
        const post = workMessage(course, item, submitted, account.email, this.zone)
        const due = post.classroom!.due
        const after: WorkState = { title: item.title, submitted, ...(due ? { due: due.dueAt, allDay: due.allDay } : {}) }
        const before = work[item.id]
        if (before && (before.submitted !== after.submitted || before.due !== after.due || before.title !== after.title)) this.changes.push({ message: post, before, after })
        delete work[item.id]
        work[item.id] = after
        this.rememberApiPost(post)
        if (seen.has(post.id)) continue
        seen.add(post.id)
        if (post.receivedAt >= c.since && !submitted) this.messages.push(post)
      }
      for (const announcement of feed.announcements ?? []) {
        const post = announcementMessage(course, announcement, account.email)
        this.rememberApiPost(post)
        if (seen.has(post.id)) continue
        seen.add(post.id)
        if (post.receivedAt >= c.since) this.messages.push(post)
      }
    }
    c.seen = [...seen].slice(-POSTS_SEEN)
    const ids = Object.keys(work)
    for (const id of ids.slice(0, Math.max(0, ids.length - WORK_KEPT))) delete work[id]
  }

  /** Notes a post the API read, so the same one from an email is let go. */
  private rememberApiPost(post: MailMessage): void {
    const key = classroomPostKey(post.classroom!.course, post.subject)
    const keys = (this.state.apiPosts ??= [])
    if (!keys.includes(key)) {
      keys.push(key)
      if (keys.length > POST_KEYS) keys.splice(0, keys.length - POST_KEYS)
    }
  }

  private async loadSettings(fresh: boolean): Promise<void> {
    const kept = this.state.settings
    const age = kept ? this.ctx.now - kept.at : Infinity
    if (age < SETTINGS_FRESH || (!fresh && age < SETTINGS_TTL)) return
    try {
      const value = ((await this.fs.get(`users/${this.uid}/settings/inbox`)) ?? {}) as InboxSettings
      this.settings = value
      this.state.settings = { value, at: this.ctx.now }
    } catch (error) {
      this.errors.push(`Settings: ${message(error)}`)
    }
  }

  // ------------------------------------------------------------ writing

  /** Writes what was found, sorts it, makes tasks and tells the phone. Says how many records are new. */
  private async record(): Promise<number> {
    const { now } = this.ctx
    const uid = this.uid
    const path = (id: string) => `users/${uid}/inbox/${id}`
    const ai = this.ai
    const senders = this.senders

    const fresh: InboxRecord[] = []
    const texts = new Map<string, string>()
    for (const m of this.messages) {
      let record = recordOf(m, reading(m, now, this.zone), now)
      // Mail from a sender the person ruled on is not sent to the model at all.
      if (ai && !senders[senderAddress(record.from)]) {
        record = { ...record, sorting: true }
        if (m.text) texts.set(m.id, m.text.slice(0, TRIAGE_BODY_LIMIT))
      }
      fresh.push(record)
    }

    // A post read from email is only written if the API has not written it first: the API's says more.
    const writes: Write[] = fresh.map((r) => ({ kind: 'set', path: path(r.id), data: r, mask: Object.keys(r), ...(r.classroom?.fromEmail ? { exists: false } : {}) }))
    // And one read from email under an id of its own goes once the API turns it up.
    const emailPosts = new Map(this.state.emailPosts ?? [])
    for (const r of fresh) {
      if (!r.classroom || r.classroom.fromEmail) continue
      const twin = emailPosts.get(classroomPostKey(r.classroom.course, r.subject))
      if (twin) {
        writes.push({ kind: 'delete', path: path(twin) })
        emailPosts.delete(classroomPostKey(r.classroom.course, r.subject))
      }
    }
    this.state.emailPosts = [...emailPosts]
    for (const change of this.changes) {
      writes.push({ kind: 'set', path: path(change.message.id), data: { classroom: change.message.classroom, updatedAt: now }, mask: ['classroom', 'updatedAt'], exists: true })
    }
    writes.push(...(await this.followClassroom()))

    // Coursework keeps Classroom's own date, so its task need not wait for the model; announcements do.
    writes.push(...(await this.autoTasks(fresh)))
    // Classroom posts are announced as they arrive; mail once it is sorted.
    const announce = fresh.filter((r) => r.classroom || !r.sorting)
    if (writes.length) await this.write(writes)

    for (const r of fresh) if (r.sorting) this.state.pending[r.id] = { record: r, ...(texts.has(r.id) ? { text: texts.get(r.id) } : {}), tries: 0 }
    const sorted = await this.sort()
    announce.push(...sorted.filter((r) => !r.classroom))

    await this.announce(announce)
    await this.remember(fresh)
    return fresh.length
  }

  private async write(writes: readonly Write[]): Promise<boolean[]> {
    try {
      return await this.fs.write(writes)
    } catch (error) {
      this.errors.push(`Firestore: ${message(error)}`)
      return writes.map(() => false)
    }
  }

  /**
   * Keeps tasks made from coursework in step with Classroom: ticked off once
   * the work is handed in, moved when the teacher moves the deadline.
   */
  private async followClassroom(): Promise<Write[]> {
    if (this.changes.length === 0) return []
    const { now } = this.ctx
    const paths = this.changes.map((c) => `users/${this.uid}/reminders/${inboxTaskId(c.message)}`)
    let tasks: Map<string, Record<string, unknown>>
    try {
      tasks = await this.fs.getAll(paths)
    } catch (error) {
      this.errors.push(`Tasks: ${message(error)}`)
      return []
    }
    const writes: Write[] = []
    this.changes.forEach((change, i) => {
      const task = tasks.get(paths[i]!) as Reminder | undefined
      if (!task || task.deletedAt !== undefined || task.status === 'done') return
      let next: Reminder | null = null
      if (change.after.submitted && !change.before.submitted && task.autoCompleteOn === 'classroom-submission') next = completeReminder(task, now)
      else if (change.after.due !== undefined && (change.after.due !== change.before.due || change.after.title !== change.before.title)) {
        next = updateReminder(task, { title: change.after.title, dueAt: change.after.due, allDay: change.after.allDay ?? false }, now)
      }
      if (next) writes.push({ kind: 'set', path: paths[i]!, data: next as unknown as Record<string, unknown>, exists: true })
    })
    return writes
  }

  /**
   * With automatic tasks on, new coursework and announcements become tasks,
   * once: a task id that exists already — even deleted — counts as made.
   */
  private async autoTasks(records: InboxRecord[]): Promise<Write[]> {
    if (!this.settings.autoTasks) return []
    const { now } = this.ctx
    const plan = planAutoTasks(records, new Set(), true, now)
    if (plan.length === 0) return []
    const paths = plan.map((r) => `users/${this.uid}/reminders/${inboxTaskId(r)}`)
    let existing: Map<string, Record<string, unknown>>
    try {
      existing = await this.fs.getAll(paths)
    } catch (error) {
      this.errors.push(`Tasks: ${message(error)}`)
      return []
    }
    const writes: Write[] = []
    plan.forEach((record, i) => {
      if (!existing.has(paths[i]!)) {
        const important = record.classroom?.kind === 'work' || isImportant(record, this.senders)
        const { id, input } = autoTask(record, now, this.zone, important)
        const task = createReminder(input, { userId: this.uid, now, id })
        writes.push({ kind: 'set', path: paths[i]!, data: task as unknown as Record<string, unknown>, exists: false })
      }
      writes.push({ kind: 'set', path: `users/${this.uid}/inbox/${record.id}`, data: { tasked: true, updatedAt: now }, mask: ['tasked', 'updatedAt'], exists: true })
      record.tasked = true
    })
    return writes
  }

  /**
   * Has the model read what is waiting, a few at a time, until the run's
   * time for it is up. Whatever it could not read keeps the rules' reading
   * and is tried again on a later run; nothing is lost, only sorted later.
   * Returns the records it settled.
   */
  private async sort(): Promise<InboxRecord[]> {
    const { now, net } = this.ctx
    const uid = this.uid
    const path = (id: string) => `users/${uid}/inbox/${id}`
    const pending = this.state.pending
    const ai = this.ai
    if (!ai) {
      // The key was removed: what was waiting shows on the rules' reading.
      const waiting = Object.keys(pending)
      if (waiting.length) await this.write(waiting.map((id) => ({ kind: 'set', path: path(id), data: { updatedAt: now }, mask: ['sorting', 'updatedAt'], exists: true })))
      this.state.pending = {}
      return []
    }
    for (const [id, p] of Object.entries(pending)) if (now - p.record.foundAt > AI_RETRY_FOR) delete pending[id]
    const queue = Object.values(pending)
      .sort((a, b) => b.record.foundAt - a.record.foundAt)
      .slice(0, AI_PER_RUN)
    if (queue.length === 0) return []

    // What was found on an earlier run may have been hidden, opened or deleted since.
    const earlier = queue.filter((p) => p.record.foundAt < now)
    if (earlier.length && net.can(1, KEEP_FOR_PUSH)) {
      try {
        const current = await this.fs.getAll(earlier.map((p) => path(p.record.id)))
        for (const p of earlier) {
          const doc = current.get(path(p.record.id)) as InboxRecord | undefined
          if (doc) p.record = doc
          else delete pending[p.record.id]
        }
      } catch (error) {
        this.errors.push(`Inbox: ${message(error)}`)
        return []
      }
    }

    const clock = this.options.clock ?? Date.now
    const profile = this.settings.profile
    const folders = this.state.folders
    const triaged: InboxRecord[] = []
    const failed: InboxRecord[] = []
    let stop = false
    await eachLimit(
      queue.filter((p) => pending[p.record.id]),
      AI_AT_ONCE,
      async (p) => {
        const left = this.options.aiUntil - clock()
        // Each question may fall through to the second model: two requests.
        if (stop || left < 5_000 || !net.can(2, KEEP_FOR_PUSH)) return
        const record = p.record
        try {
          const message = onWall(messageOf(record, p.text), this.zone)
          const triage = await within(
            triageMail(ai, message, { now: this.zone.toWall(now), folders, timeZone: this.zone.name, ...(profile ? { profile } : {}) }, { fetchFn: net.fetch as never }),
            left,
          )
          if (!triage) throw new Error('The model’s answer could not be used')
          const read: MailTriage = triage.task ? { ...triage, task: { ...triage.task, dueAt: this.zone.fromWall(triage.task.dueAt) } } : triage
          if (read.folder && !folders.includes(read.folder)) folders.push(read.folder)
          const { sorting: _sorting, ...rest } = record
          triaged.push({ ...rest, triage: read, updatedAt: now })
          delete pending[record.id]
          this.state.ai = { ...(triage.model ? { model: triage.model } : {}) }
        } catch (error) {
          if (error instanceof Timeout) return
          if (error instanceof AiError && (error.badKey || error.rateLimited)) stop = true
          this.state.ai = { ...this.state.ai, error: message(error) }
          p.tries++
          const { sorting: _sorting, ...rest } = record
          failed.push(rest as InboxRecord)
          if (p.tries >= AI_TRIES) delete pending[record.id]
          else p.record = rest as InboxRecord
        }
      },
    )
    const writes: Write[] = [
      ...triaged.map((r): Write => ({ kind: 'set', path: path(r.id), data: { triage: r.triage, updatedAt: now }, mask: ['triage', 'sorting', 'updatedAt'], exists: true })),
      // Shown on the rules' reading while it waits for another go.
      ...failed.map((r): Write => ({ kind: 'set', path: path(r.id), data: { updatedAt: now }, mask: ['sorting', 'updatedAt'], exists: true })),
    ]
    // A record the model could not read is settled on the rules' reading for now.
    const settled = [...triaged, ...failed]
    writes.push(...(await this.autoTasks(settled)))
    if (writes.length) await this.write(writes)
    return settled
  }

  private async announce(records: readonly InboxRecord[]): Promise<void> {
    const announced = new Set(this.state.announced)
    const fresh = records.filter((r) => !announced.has(r.id) && worthAnnouncing(r, this.senders))
    if (fresh.length === 0) return
    this.state.announced = [...this.state.announced, ...fresh.map((r) => r.id)].slice(-ANNOUNCED_KEPT)
    await this.push(announcements(fresh, this.ctx.now, this.zone))
  }

  private async push(pushes: readonly Push[]): Promise<void> {
    if (pushes.length === 0) return
    const { env, store, net, now } = this.ctx
    const tokens = await store.pushTokens(this.uid)
    for (const push of pushes) {
      if (!net.can(tokens.length + 1)) break
      try {
        await sendPush(env, store, net.fetch, tokens, push, now)
      } catch (error) {
        this.errors.push(`Push: ${message(error)}`)
        break
      }
    }
  }

  /**
   * The evening's "due tomorrow", the morning's "due today" and the eight
   * o'clock summary, each once a day on the person's own clock.
   */
  private async digests(): Promise<void> {
    const { now, store } = this.ctx
    const zone = this.zone
    const wall = zone.toWall(now)
    const sent = new Set(this.state.sent)
    const kinds = dueDigests(wall, sent)
    if (kinds.length === 0) return
    for (const kind of kinds) sent.add(digestKey(kind, wall))
    this.state.sent = [...sent].slice(-9)
    if ((await store.pushTokens(this.uid)).length === 0) return
    const today = startOfLocalDay(wall)
    let tasks: Reminder[]
    let records: InboxRecord[] = []
    try {
      tasks = ((await this.fs.range(`users/${this.uid}`, 'reminders', 'dueAt', zone.fromWall(today - 14 * DAY), zone.fromWall(addLocalDays(today, 2)))) as unknown as Reminder[]).map(
        (r) => ({ ...r, dueAt: zone.toWall(r.dueAt) }),
      )
      if (kinds.includes('today')) {
        records = ((await this.fs.range(`users/${this.uid}`, 'inbox', 'foundAt', now - DAY, now + 1)) as unknown as InboxRecord[]).map((r) => ({ ...r, foundAt: zone.toWall(r.foundAt) }))
      }
    } catch (error) {
      this.errors.push(`Digest: ${message(error)}`)
      return
    }
    const pushes: Push[] = []
    for (const kind of kinds) {
      const digest = kind === 'today' ? todayDigest(tasks, records, wall, this.senders) : dueDigest(kind, tasks, wall)
      if (!digest) continue
      pushes.push({
        title: digest.title,
        body: digest.body,
        tag: `digest-${kind}`,
        data: digest.reminderId ? { kind: 'task', id: digest.reminderId } : { kind: 'today', id: '' },
      })
    }
    await this.push(pushes)
  }

  /** Remembers what was written, and deletes the oldest records once there are too many. */
  private async remember(fresh: readonly InboxRecord[]): Promise<void> {
    if (fresh.length === 0) return
    const recent = [...fresh.map((r): [string, number] => [r.id, r.receivedAt]), ...this.state.recent].sort((a, b) => b[1] - a[1])
    if (recent.length > KEEP_RECORDS + OVERFLOW_SLACK) {
      const gone = recent.slice(KEEP_RECORDS)
      this.state.recent = recent.slice(0, KEEP_RECORDS)
      for (const [id] of gone) delete this.state.pending[id]
      await this.write(gone.map(([id]): Write => ({ kind: 'delete', path: `users/${this.uid}/inbox/${id}` })))
    } else {
      this.state.recent = recent
    }
  }

  /** settings/reader: when the Worker last looked, and how each account fared. Written when it changes, and every quarter hour. */
  private async writeReader(): Promise<void> {
    const { now } = this.ctx
    const doc: ReaderDoc = {
      checkedAt: now,
      accounts: this.status,
      cursors: Object.fromEntries(
        Object.keys({ ...this.state.mail, ...this.state.classroom }).map((email) => [
          email,
          {
            ...(this.state.mail[email]?.cursor ? { mail: this.state.mail[email]!.cursor } : {}),
            ...(this.state.classroom[email]?.since ? { classroomSince: this.state.classroom[email]!.since } : {}),
          },
        ]),
      ),
      ...(this.state.ai ? { ai: this.state.ai } : {}),
    }
    const hash = JSON.stringify([Object.entries(this.status).map(([email, s]) => [email, s.error ?? '']), this.state.ai ?? null])
    const last = this.state.reader
    // The heartbeat is for the apps' "checks paused" notice, which only shows when something is read.
    if (last && last.hash === hash && (now - last.at < HEARTBEAT_MS || !this.watching)) return
    const [ok] = await this.write([{ kind: 'set', path: `users/${this.uid}/settings/reader`, data: doc as unknown as Record<string, unknown> }])
    if (ok) this.state.reader = { at: now, hash }
  }
}
