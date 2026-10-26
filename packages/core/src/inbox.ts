import { clean } from './entity'
import { inboxTaskId, type ClassroomPost, type MailMessage, type MailReading } from './mail'
import { senderAddress, type MailTriage } from './mailTriage'
import type { ReminderInput } from './reminders'
import { atLocalTime, DAY, MINUTE } from './time'

/**
 * The shared inbox: one record per email or Classroom post, written by
 * whichever device is reading and shown the same way on every device.
 *
 * A record is what Cairn made of a message, never the message itself: the
 * sender, the subject, Gmail's short snippet and the model's one-line
 * summary, but no body. The body was for reading once, on the device that
 * fetched it; Gmail and Classroom still have it for anyone who taps through.
 */
export interface InboxRecord {
  /** Gmail's message id, or classroom-work-… / classroom-announcement-…. One record per id, on every device. */
  id: string
  /** The connected account it arrived in, by address. */
  account: string
  from: string
  subject: string
  /** Gmail's preview, or the start of a Classroom post. Never more than SNIPPET_LIMIT. */
  snippet: string
  receivedAt: number
  threadId?: string
  classroom?: ClassroomPost
  /** The plain rules' reading, for when there is no model or it could not answer. */
  reading: InboxReading
  /** The model's reading, once it has made one. */
  triage?: MailTriage
  /** Written before the model answered; the same record is written again with its reading. */
  sorting?: boolean
  /** Opened on any device. */
  read?: boolean
  /** Hidden from the lists on every device. */
  dismissed?: boolean
  /** A task was made from it, by hand or automatically, so none is ever made again. */
  tasked?: boolean
  /** When the reading device first found it. */
  foundAt: number
  updatedAt: number
}

export type InboxReading = Omit<MailReading, 'confident'>

/** What the person has said about a sender: their mail always or never belongs in Important. */
export type SenderRule = 'important' | 'unimportant'

/** A preview, not a body: enough to recognise the message by. */
export const SNIPPET_LIMIT = 200

/** Records kept in the cloud. Older ones are deleted, so the collection never grows past a few hundred small documents. */
export const KEEP_RECORDS = 250

/** Firestore refuses undefined anywhere in a document, so it is taken out at every depth. */
function defined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(defined) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) if (v !== undefined) out[key] = defined(v)
    return out as T
  }
  return value
}

/** The record for a message just read: its body left behind, its preview cut short. */
export function recordOf(message: MailMessage, reading: MailReading, now: number, triage?: MailTriage): InboxRecord {
  const { confident: _confident, ...kept } = reading
  return defined(
    clean<InboxRecord>({
      id: message.id,
      account: message.account,
      from: message.from.slice(0, 300),
      subject: message.subject.slice(0, 300),
      snippet: message.snippet.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT),
      receivedAt: message.receivedAt,
      threadId: message.threadId,
      classroom: message.classroom,
      reading: kept,
      triage,
      foundAt: now,
      updatedAt: now,
    }),
  )
}

/** Only what a record says about the message, for asking the model again or opening it. */
export function messageOf(record: InboxRecord, text?: string): MailMessage {
  return clean<MailMessage>({
    id: record.id,
    account: record.account,
    from: record.from,
    subject: record.subject,
    snippet: record.snippet,
    text,
    receivedAt: record.receivedAt,
    threadId: record.threadId,
    classroom: record.classroom,
  })
}

/** Whether a message belongs in Important: the person's word on its sender first, then the model's, then the rules'. */
export function isImportant(record: Pick<InboxRecord, 'from' | 'triage' | 'reading'>, senders: Readonly<Record<string, SenderRule>> = {}): boolean {
  const rule = senders[senderAddress(record.from)]
  if (rule) return rule === 'important'
  if (record.triage) return record.triage.important
  return record.reading.kind !== 'other'
}

/**
 * The deadline or start time a message offers: Classroom's own due date when
 * it has one, then the model's reading, then the rules'.
 */
export function dueOf(record: Pick<InboxRecord, 'classroom' | 'triage' | 'reading' | 'subject'>): { title: string; dueAt: number; allDay: boolean } | undefined {
  const post = record.classroom
  if (post?.due) return { title: record.triage?.task?.title ?? record.subject, ...post.due }
  if (record.triage?.task) return record.triage.task
  if (record.reading.dueAt !== undefined) return { title: record.reading.title || record.subject, dueAt: record.reading.dueAt, allDay: record.reading.allDay }
  return undefined
}

/** The tags a task made from this message carries: the model's, else its folder, else where it came from. */
export function tagsOf(record: Pick<InboxRecord, 'triage' | 'classroom'>): string[] {
  if (record.triage?.tags?.length) return record.triage.tags
  if (record.triage?.folder) return [record.triage.folder.toLowerCase().replace(/\s+/g, '-')]
  return record.classroom ? ['classroom'] : []
}

/** Folders in the order they first turned up, oldest first, so chips do not reshuffle. */
export function inboxFolders(records: readonly Pick<InboxRecord, 'triage' | 'foundAt'>[]): string[] {
  const seen = new Map<string, number>()
  for (const r of records) {
    const folder = r.triage?.folder
    if (folder) seen.set(folder, Math.min(seen.get(folder) ?? Infinity, r.foundAt))
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name)
}

/**
 * Folds newly read records into those already stored. The newer reading of
 * a message wins, but what a person did to it — opened it, hid it, made a
 * task of it — is never undone by a device reading it again, and it keeps
 * the moment it was first found.
 */
export function mergeInbox(current: readonly InboxRecord[], incoming: readonly InboxRecord[]): InboxRecord[] {
  const byId = new Map(current.map((r) => [r.id, r]))
  for (const fresh of incoming) {
    const known = byId.get(fresh.id)
    if (!known) {
      byId.set(fresh.id, fresh)
      continue
    }
    const merged: InboxRecord = { ...known, ...fresh, foundAt: Math.min(known.foundAt, fresh.foundAt) }
    if (!fresh.sorting) delete merged.sorting
    // A reading never goes backwards: a record still waiting on the model does not replace one it has read.
    if (known.triage && !fresh.triage) {
      merged.triage = known.triage
      delete merged.sorting
    }
    for (const flag of ['read', 'dismissed', 'tasked'] as const) {
      if (known[flag] || fresh[flag]) merged[flag] = true
    }
    merged.updatedAt = Math.max(known.updatedAt, fresh.updatedAt)
    byId.set(fresh.id, merged)
  }
  return [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt)
}

/**
 * What a read actually needs to write: messages not stored yet, and stored
 * ones whose reading changed. Everything else costs nothing, so a device that
 * reads the same mail as another — or the same mail twice — writes nothing.
 */
export function inboxWrites(current: readonly InboxRecord[], incoming: readonly InboxRecord[]): InboxRecord[] {
  const byId = new Map(current.map((r) => [r.id, r]))
  const merged = new Map(mergeInbox(current, incoming).map((r) => [r.id, r]))
  const out: InboxRecord[] = []
  const seen = new Set<string>()
  for (const fresh of incoming) {
    if (seen.has(fresh.id)) continue
    seen.add(fresh.id)
    const known = byId.get(fresh.id)
    const next = merged.get(fresh.id)!
    if (!known || !sameReading(known, next)) out.push(next)
  }
  return out
}

function sameReading(a: InboxRecord, b: InboxRecord): boolean {
  return (
    JSON.stringify(a.triage ?? null) === JSON.stringify(b.triage ?? null) &&
    !!a.sorting === !!b.sorting &&
    !!a.tasked === !!b.tasked &&
    !!a.dismissed === !!b.dismissed &&
    !!a.read === !!b.read
  )
}

/** Ids of the oldest records past `keep`, to delete. Nothing is deleted until there is a batch worth deleting. */
export function inboxOverflow(records: readonly Pick<InboxRecord, 'id' | 'receivedAt'>[], keep = KEEP_RECORDS, slack = 25): string[] {
  if (records.length <= keep + slack) return []
  return [...records]
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(keep)
    .map((r) => r.id)
}

/**
 * The account chips over a list: All and one per account when there are
 * several; just the one, with no All, when there is only one.
 */
export function accountChips(accounts: readonly string[]): { all: boolean; accounts: string[] } {
  const unique = [...new Set(accounts.filter(Boolean))]
  return { all: unique.length > 1, accounts: unique }
}

/** Every account a set of records came from, in the order given and then any others. */
export function accountsIn(records: readonly Pick<InboxRecord, 'account'>[], connected: readonly string[] = []): string[] {
  const out = [...connected]
  for (const r of records) if (!out.includes(r.account)) out.push(r.account)
  return out
}

/** How long a record may wait on the model before it is announced on what the rules said. */
const SORTING_GRACE_MS = 10 * MINUTE

/**
 * New important messages to announce on this device. Every device announces
 * what arrives, not only the one that read it, so a phone hears about mail
 * the computer found. A record still waiting on the model is held back for a
 * few minutes so it is announced with its summary.
 */
export function toAnnounce(
  records: readonly InboxRecord[],
  options: { since: number; announced: ReadonlySet<string>; senders?: Readonly<Record<string, SenderRule>>; now: number },
): InboxRecord[] {
  return records.filter(
    (r) =>
      r.foundAt > options.since &&
      !options.announced.has(r.id) &&
      !r.dismissed &&
      !r.read &&
      (!r.sorting || options.now - r.foundAt > SORTING_GRACE_MS) &&
      (r.classroom ? r.classroom.kind === 'work' || isImportant(r, options.senders) : isImportant(r, options.senders)),
  )
}

/** Announcements older than this are history, not something to do. */
const AUTO_TASK_WINDOW_MS = 7 * DAY

/**
 * Classroom posts that should become tasks on their own: switched on, still
 * open, not hidden, and never turned into a task before on any device.
 * Coursework past its due date and announcements more than a week old are
 * left alone, so switching this on never floods Tasks with old posts. A task
 * id already known — even one deleted since — counts as made: the person
 * deleting it is an answer, not an invitation to make it again.
 */
export function planAutoTasks(records: readonly InboxRecord[], taskIds: ReadonlySet<string>, on: boolean, now: number): InboxRecord[] {
  if (!on) return []
  const planned = new Set<string>()
  return records.filter((r) => {
    const post = r.classroom
    if (!post || r.tasked || r.dismissed || post.submitted) return false
    if (post.kind === 'announcement' && (r.sorting || now - r.foundAt > AUTO_TASK_WINDOW_MS)) return false
    if (post.kind === 'work' && post.due && post.due.dueAt < now) return false
    const id = inboxTaskId(r)
    if (taskIds.has(id) || planned.has(id)) return false
    planned.add(id)
    return true
  })
}

/**
 * The task a message offers, at the time it gives, with the model's tags.
 * Coursework keeps Classroom's id, so its task follows a moved deadline and
 * completes itself on hand-in; Classroom's due date always wins.
 *
 * With no date at all, a task asked for by hand is due tomorrow; one made
 * automatically from an announcement has no deadline to invent, so it is
 * filed on the day it was posted and stays silent.
 */
export function taskFromInbox(
  record: InboxRecord,
  options: { now: number; important: boolean; automatic?: boolean },
): { id: string; input: ReminderInput } {
  const post = record.classroom
  const due = dueOf(record)
  const sender = record.from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || record.from
  const body = [record.triage?.summary ?? record.snippet, post ? `${post.course}: ${record.subject}` : `From ${sender}: ${record.subject}`, post?.link]
    .filter(Boolean)
    .join('\n\n')
  const undated = !due
  const input: ReminderInput = {
    title: due?.title || record.subject || (post ? 'From Classroom' : 'From email'),
    body,
    dueAt: due?.dueAt ?? (options.automatic ? atLocalTime(record.receivedAt, 9) : options.now + DAY),
    allDay: due ? due.allDay : true,
    priority: options.important ? 'high' : undated && options.automatic ? 'low' : 'normal',
    tags: tagsOf(record),
    courseId: post?.courseId,
    source: post ? 'classroom' : 'email',
    sourceRef: post?.workId ?? record.id,
    autoCompleteOn: post?.workId ? 'classroom-submission' : undefined,
    ...(undated && options.automatic ? { alertOffsets: [] } : {}),
  }
  return { id: inboxTaskId(record), input }
}
