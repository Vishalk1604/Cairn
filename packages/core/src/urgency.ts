import type { Priority, Reminder } from './model'
import { deadlineOf, isSnoozeActive } from './reminders'
import { HOUR, addLocalDays, isSameLocalDay, startOfLocalDay } from './time'

/** One scale for every surface: widgets, tray icon, in-app list. */
export type UrgencyLevel = 'overdue' | 'soon' | 'today' | 'week' | 'later' | 'done'

export const URGENCY_LEVELS: readonly UrgencyLevel[] = ['overdue', 'soon', 'today', 'week', 'later', 'done']

export interface UrgencyOptions {
  /** How close the deadline must be to count as "soon". */
  soonWindowMs?: number
  /** High-priority reminders turn "soon" earlier. */
  highPrioritySoonWindowMs?: number
}

const DEFAULT_SOON_WINDOW = 2 * HOUR
const DEFAULT_HIGH_PRIORITY_SOON_WINDOW = 24 * HOUR

const PRIORITY_RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 }

/**
 * A snoozed reminder is judged by when it comes back rather than by its
 * original deadline, so snoozing an overdue item stops it glaring red until
 * the snooze ends.
 */
function anchorOf(r: Reminder, now: number): { at: number; allDay: boolean } {
  return isSnoozeActive(r, now) ? { at: r.snoozedUntil!, allDay: false } : { at: r.dueAt, allDay: r.allDay }
}

function soonWindow(priority: Priority, options: UrgencyOptions): number {
  return priority === 'high'
    ? (options.highPrioritySoonWindowMs ?? DEFAULT_HIGH_PRIORITY_SOON_WINDOW)
    : (options.soonWindowMs ?? DEFAULT_SOON_WINDOW)
}

/**
 * - overdue: past the deadline (end of day, for all-day reminders)
 * - soon: deadline within the soon window (2h, or 24h for high priority)
 * - today: due today
 * - week: due within the next 7 calendar days
 * - later: anything further out
 * - done: completed or deleted
 */
export function urgencyOf(r: Reminder, now: number, options: UrgencyOptions = {}): UrgencyLevel {
  if (r.status === 'done' || r.deletedAt !== undefined) return 'done'
  const anchor = anchorOf(r, now)
  const deadline = deadlineOf({ dueAt: anchor.at, allDay: anchor.allDay })
  if (now >= deadline) return 'overdue'
  if (deadline - now <= soonWindow(r.priority, options)) return 'soon'
  if (isSameLocalDay(anchor.at, now)) return 'today'
  if (anchor.at < addLocalDays(startOfLocalDay(now), 7)) return 'week'
  return 'later'
}

/**
 * The next instant at which urgencyOf(r) may change, so widgets can refresh
 * exactly when a color flips instead of polling. Null once nothing can change.
 */
export function nextUrgencyChangeAt(r: Reminder, now: number, options: UrgencyOptions = {}): number | null {
  if (r.status === 'done' || r.deletedAt !== undefined) return null
  const anchor = anchorOf(r, now)
  const deadline = deadlineOf({ dueAt: anchor.at, allDay: anchor.allDay })
  const dayStart = startOfLocalDay(anchor.at)
  const candidates = [
    addLocalDays(dayStart, -6),
    dayStart,
    deadline - soonWindow(r.priority, options),
    deadline,
  ]
  if (isSnoozeActive(r, now)) candidates.push(r.snoozedUntil!)
  let next: number | null = null
  for (const t of candidates) {
    if (t > now && (next === null || t < next)) next = t
  }
  return next
}

/** Most urgent first; within a level, soonest first, then higher priority. */
export function compareByUrgency(now: number, options: UrgencyOptions = {}) {
  const rank = (r: Reminder) => URGENCY_LEVELS.indexOf(urgencyOf(r, now, options))
  return (a: Reminder, b: Reminder): number =>
    rank(a) - rank(b) ||
    anchorOf(a, now).at - anchorOf(b, now).at ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** The most urgent level among the given reminders, e.g. for the tray icon. */
export function worstUrgency(reminders: Iterable<Reminder>, now: number, options: UrgencyOptions = {}): UrgencyLevel | null {
  let worst: number | null = null
  for (const r of reminders) {
    const index = URGENCY_LEVELS.indexOf(urgencyOf(r, now, options))
    if (worst === null || index < worst) worst = index
  }
  return worst === null ? null : URGENCY_LEVELS[worst]!
}
