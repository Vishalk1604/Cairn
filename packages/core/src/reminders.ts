import { clean, tombstone } from './entity'
import { uuidv7 } from './ids'
import type { CreateContext, Priority, Reminder, Source } from './model'
import { buildRecurrence, nextOccurrence, rebaseRecurrence, type RecurrenceSpec } from './recurrence'
import { DAY, startOfNextLocalDay } from './time'

export interface ReminderInput {
  title: string
  dueAt: number
  allDay?: boolean
  priority?: Priority
  /** A serialized rule (e.g. from capture), anchored at or before dueAt. */
  rrule?: string
  alertOffsets?: number[]
  tags?: string[]
  noteId?: string
  courseId?: string
  source?: Source
  sourceRef?: string
  autoCompleteOn?: Reminder['autoCompleteOn']
}

export interface ReminderChanges {
  title?: string
  priority?: Priority
  tags?: string[]
  alertOffsets?: number[] | null
  noteId?: string | null
  courseId?: string | null
  dueAt?: number
  allDay?: boolean
  /** New repeat pattern anchored at the (new) due date, or null to stop repeating. */
  recurrence?: RecurrenceSpec | null
}

export function createReminder(input: ReminderInput, ctx: CreateContext): Reminder {
  const reminder = clean<Reminder>({
    id: ctx.id ?? uuidv7(ctx.now),
    userId: ctx.userId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    title: normalizeTitle(input.title),
    noteId: input.noteId,
    dueAt: input.dueAt,
    allDay: input.allDay ?? false,
    rrule: input.rrule,
    priority: input.priority ?? 'normal',
    status: 'pending',
    alertOffsets: normalizeOffsets(input.alertOffsets),
    tags: normalizeTags(input.tags),
    courseId: input.courseId,
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef,
    autoCompleteOn: input.autoCompleteOn,
  })
  return reminder.rrule ? alignToRule(reminder) : reminder
}

/**
 * Applies an edit from the reminder editor. Moving a recurring reminder moves
 * the whole series; to move a single occurrence use rescheduleReminder.
 */
export function updateReminder(r: Reminder, changes: ReminderChanges, now: number): Reminder {
  const next: Reminder = { ...r, updatedAt: now }
  if (changes.title !== undefined) next.title = normalizeTitle(changes.title)
  if (changes.priority !== undefined) next.priority = changes.priority
  if (changes.tags !== undefined) next.tags = normalizeTags(changes.tags)
  if (changes.alertOffsets !== undefined) next.alertOffsets = normalizeOffsets(changes.alertOffsets ?? undefined)
  if (changes.noteId !== undefined) next.noteId = changes.noteId ?? undefined
  if (changes.courseId !== undefined) next.courseId = changes.courseId ?? undefined
  if (changes.dueAt !== undefined) next.dueAt = changes.dueAt
  if (changes.allDay !== undefined) next.allDay = changes.allDay

  const timingChanged = next.dueAt !== r.dueAt || next.allDay !== r.allDay
  if (changes.recurrence !== undefined) {
    next.rrule = changes.recurrence ? buildRecurrence(changes.recurrence, next.dueAt) : undefined
  } else if (timingChanged && r.rrule) {
    next.rrule = rebaseRecurrence(r.rrule, next.dueAt)
  }
  if (timingChanged && next.status === 'snoozed') {
    next.status = 'pending'
    next.snoozedUntil = undefined
  }
  // Only a schedule change re-anchors the rule; any other edit must leave the
  // series (and its occurrence count) exactly as it was.
  const scheduleChanged = timingChanged || changes.recurrence !== undefined
  return clean(next.rrule && scheduleChanged ? alignToRule(next) : next)
}

/**
 * One-off reminders become done. Recurring ones advance to the next occurrence
 * after both now and the current due date, so completing early moves to the
 * following occurrence and completing late skips the ones already missed.
 */
export function completeReminder(r: Reminder, now: number): Reminder {
  if (r.status === 'done') return r
  if (r.rrule) {
    const next = nextOccurrence(r.rrule, Math.max(now, r.dueAt))
    if (next !== null) {
      return clean({ ...r, dueAt: next, status: 'pending', snoozedUntil: undefined, completedAt: now, updatedAt: now })
    }
  }
  return clean({ ...r, status: 'done', snoozedUntil: undefined, completedAt: now, updatedAt: now })
}

/** Recurring only: move to the next occurrence without recording a completion. */
export function skipOccurrence(r: Reminder, now: number): Reminder {
  if (!r.rrule || r.status === 'done') return r
  const next = nextOccurrence(r.rrule, Math.max(now, r.dueAt))
  if (next === null) return clean({ ...r, status: 'done', snoozedUntil: undefined, updatedAt: now })
  return clean({ ...r, dueAt: next, status: 'pending', snoozedUntil: undefined, updatedAt: now })
}

export function snoozeReminder(r: Reminder, until: number, now: number): Reminder {
  if (until <= now) throw new Error('Snooze has to end in the future')
  if (r.status === 'done') return r
  return { ...r, status: 'snoozed', snoozedUntil: until, updatedAt: now }
}

export function reopenReminder(r: Reminder, now: number): Reminder {
  if (r.status !== 'done') return r
  return clean({ ...r, status: 'pending', completedAt: undefined, updatedAt: now })
}

/** Moves this occurrence (not the series) and makes it active again. */
export function rescheduleReminder(r: Reminder, dueAt: number, now: number, allDay = r.allDay): Reminder {
  return clean({ ...r, dueAt, allDay, status: 'pending', snoozedUntil: undefined, updatedAt: now })
}

export function deleteReminder(r: Reminder, now: number): Reminder {
  return tombstone(r, now)
}

export function isSnoozeActive(r: Reminder, now: number): boolean {
  return r.status === 'snoozed' && r.snoozedUntil !== undefined && r.snoozedUntil > now
}

/** The moment it becomes overdue: the due time, or the end of the due day for all-day reminders. */
export function deadlineOf(r: Pick<Reminder, 'dueAt' | 'allDay'>): number {
  return r.allDay ? startOfNextLocalDay(r.dueAt) : r.dueAt
}

export function isOverdue(r: Reminder, now: number): boolean {
  return r.status !== 'done' && r.deletedAt === undefined && now >= deadlineOf(r)
}

/**
 * A one-off reminder left overdue for longer than the grace period. Derived,
 * never stored. Recurring reminders are never missed; they wait to be completed.
 */
export function isMissed(r: Reminder, now: number, graceMs = DAY): boolean {
  return !r.rrule && isOverdue(r, now) && !isSnoozeActive(r, now) && now >= deadlineOf(r) + graceMs
}

export function isRecurring(r: Reminder): boolean {
  return r.rrule !== undefined
}

/** Snaps dueAt forward onto the rule and re-anchors the rule there. */
function alignToRule(r: Reminder): Reminder {
  const first = nextOccurrence(r.rrule!, r.dueAt, true)
  if (first === null) throw new Error('That repeat pattern has no dates on or after the due date')
  return { ...r, dueAt: first, rrule: rebaseRecurrence(r.rrule!, first) }
}

function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) throw new Error('A reminder needs a title')
  return normalized
}

export function normalizeTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  for (const tag of tags) {
    const t = tag.trim().replace(/^#+/, '').toLowerCase()
    if (t) seen.add(t)
  }
  return [...seen]
}

/** Absent means the default single alert at the due time; an empty list means silent. */
function normalizeOffsets(offsets: readonly number[] | undefined): number[] | undefined {
  if (!offsets) return undefined
  const unique = [...new Set(offsets.filter((o) => Number.isFinite(o) && o >= 0).map((o) => Math.round(o)))]
  unique.sort((a, b) => b - a)
  if (unique.length === 1 && unique[0] === 0) return undefined
  return unique
}
