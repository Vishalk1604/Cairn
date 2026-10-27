import type { InboxRecord, SenderRule } from './inbox'
import { isImportant } from './inbox'
import type { Reminder } from './model'
import type { Digest } from './summary'
import { addLocalDays, DAY, HOUR, startOfLocalDay } from './time'

/**
 * The notifications that are not about one thing arriving but about the day:
 * what is due tomorrow, told the evening before; what is due today, told in
 * the morning; and a short "Today" summary at eight.
 *
 * Everything here reads the clock in local time. The phone's notifications
 * are sent by the Worker, which runs in UTC, so it hands in times already
 * moved onto the person's own clock (see apps/worker zone.ts); the desktop
 * runs it on its own clock as it is.
 */
export type DigestKind = 'evening' | 'morning' | 'today'

export interface DigestSlot {
  kind: DigestKind
  /** Local hour it goes out at. */
  hour: number
}

/** In the order they go out. */
export const DIGEST_SLOTS: readonly DigestSlot[] = [
  { kind: 'morning', hour: 7 },
  { kind: 'today', hour: 8 },
  { kind: 'evening', hour: 20 },
]

/**
 * A slot missed by more than this is skipped rather than sent late: a
 * "due tomorrow" at two in the morning helps nobody.
 */
export const DIGEST_WINDOW_MS = 2 * HOUR

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-10-27": one key per slot per local day, so each goes out once. */
export function digestKey(kind: DigestKind, t: number): string {
  const d = new Date(t)
  return `${kind}:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The slots due at `now` that have not gone out today. */
export function dueDigests(now: number, sent: ReadonlySet<string>, slots: readonly DigestSlot[] = DIGEST_SLOTS): DigestKind[] {
  const day = startOfLocalDay(now)
  return slots
    .filter((slot) => {
      const at = day + slot.hour * HOUR
      return now >= at && now - at < DIGEST_WINDOW_MS && !sent.has(digestKey(slot.kind, now))
    })
    .map((slot) => slot.kind)
}

/** The first moment after `now` that some slot goes out, for a timer. */
export function nextDigestAt(now: number, slots: readonly DigestSlot[] = DIGEST_SLOTS): number {
  const today = startOfLocalDay(now)
  const times = [today, addLocalDays(today, 1)].flatMap((day) => slots.map((s) => day + s.hour * HOUR))
  return Math.min(...times.filter((t) => t > now))
}

/** The window of tasks a slot is about: tomorrow for the evening, today otherwise. */
export function digestWindow(kind: DigestKind, now: number): { from: number; to: number } {
  const today = startOfLocalDay(now)
  return kind === 'evening' ? { from: addLocalDays(today, 1), to: addLocalDays(today, 2) } : { from: today, to: addLocalDays(today, 1) }
}

export interface DayDigest extends Digest {
  /** The task to open, when the digest is about one. */
  reminderId?: string
}

/** "6:30 pm", read off the local clock without Intl, which the Worker would have to build per zone. */
export function clockTime(t: number): string {
  const d = new Date(t)
  const h = d.getHours()
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`
}

function live(reminders: readonly Reminder[]): Reminder[] {
  return reminders.filter((r) => r.deletedAt === undefined && r.status !== 'done')
}

function due(r: Pick<Reminder, 'title' | 'dueAt' | 'allDay'>): string {
  return r.allDay ? r.title : `${r.title} at ${clockTime(r.dueAt)}`
}

function list(items: readonly Reminder[], limit = 3): string {
  const shown = items.slice(0, limit).map(due)
  const more = items.length - shown.length
  return more > 0 ? `${shown.join(' · ')} · and ${more} more` : shown.join(' · ')
}

/**
 * The due-soon reminders: tomorrow's tasks the evening before, today's in the
 * morning. Nothing to say means no notification at all.
 */
export function dueDigest(kind: 'evening' | 'morning', reminders: readonly Reminder[], now: number): DayDigest | null {
  const { from, to } = digestWindow(kind, now)
  const items = live(reminders)
    .filter((r) => r.dueAt >= from && r.dueAt < to)
    .sort((a, b) => a.dueAt - b.dueAt)
  if (items.length === 0) return null
  const when = kind === 'evening' ? 'tomorrow' : 'today'
  if (items.length === 1) {
    const only = items[0]!
    return { title: `Due ${when}`, body: due(only), reminderId: only.id }
  }
  return { title: `${items.length} things due ${when}`, body: list(items) }
}

/**
 * The eight o'clock summary: what is due today and still open, what is
 * overdue, and what turned up in Classroom and the mail since yesterday
 * morning. Quiet days get no notification.
 */
export function todayDigest(
  reminders: readonly Reminder[],
  records: readonly Pick<InboxRecord, 'from' | 'triage' | 'reading' | 'classroom' | 'foundAt' | 'read' | 'dismissed'>[],
  now: number,
  senders: Readonly<Record<string, SenderRule>> = {},
): DayDigest | null {
  const { from, to } = digestWindow('today', now)
  const open = live(reminders)
  const today = open.filter((r) => r.dueAt >= from && r.dueAt < to).sort((a, b) => a.dueAt - b.dueAt)
  const late = open.filter((r) => r.dueAt < from && !r.rrule)
  const fresh = records.filter((r) => !r.dismissed && !r.read && now - r.foundAt < DAY)
  const posts = fresh.filter((r) => r.classroom && !r.classroom.submitted).length
  const mail = fresh.filter((r) => !r.classroom && isImportant(r, senders)).length
  const parts = [
    today.length ? `${today.length} due today` : '',
    late.length ? `${late.length} overdue` : '',
    posts ? `${posts} new in Classroom` : '',
    mail ? `${mail} important ${mail === 1 ? 'email' : 'emails'}` : '',
  ].filter(Boolean)
  if (parts.length === 0) return null
  return { title: 'Today', body: today.length ? `${parts.join(' · ')}\n${list(today)}` : parts.join(' · ') }
}
