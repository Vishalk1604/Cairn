import type { Priority, Reminder } from './model'
import { isSnoozeActive } from './reminders'
import { compareByUrgency, nextUrgencyChangeAt, urgencyOf, type UrgencyLevel, type UrgencyOptions } from './urgency'

export interface SummaryItem {
  id: string
  title: string
  dueAt: number
  allDay: boolean
  urgency: UrgencyLevel
  priority: Priority
  recurring: boolean
  snoozedUntil?: number
}

/**
 * The denormalized payload both widgets render. Written to one document so a
 * widget refresh costs one read instead of a query.
 */
export interface TodaySummary {
  generatedAt: number
  items: SummaryItem[]
  counts: { overdue: number; soon: number; today: number; week: number }
  /** Most urgent live reminder, for the tray icon. */
  worst: UrgencyLevel | null
  /** When the next color flip happens, so a widget can schedule its refresh. */
  nextChangeAt: number | null
}

export interface SummaryOptions extends UrgencyOptions {
  limit?: number
}

export function buildTodaySummary(reminders: Iterable<Reminder>, now: number, options: SummaryOptions = {}): TodaySummary {
  const live = [...reminders].filter((r) => r.deletedAt === undefined && r.status !== 'done')
  live.sort(compareByUrgency(now, options))

  const counts = { overdue: 0, soon: 0, today: 0, week: 0 }
  let nextChangeAt: number | null = null
  for (const r of live) {
    const level = urgencyOf(r, now, options)
    if (level === 'overdue' || level === 'soon' || level === 'today' || level === 'week') counts[level]++
    const change = nextUrgencyChangeAt(r, now, options)
    if (change !== null && (nextChangeAt === null || change < nextChangeAt)) nextChangeAt = change
  }

  const items = live.slice(0, options.limit ?? 5).map((r): SummaryItem => {
    const item: SummaryItem = {
      id: r.id,
      title: r.title,
      dueAt: r.dueAt,
      allDay: r.allDay,
      urgency: urgencyOf(r, now, options),
      priority: r.priority,
      recurring: r.rrule !== undefined,
    }
    if (isSnoozeActive(r, now)) item.snoozedUntil = r.snoozedUntil!
    return item
  })

  return { generatedAt: now, items, counts, worst: items[0]?.urgency ?? null, nextChangeAt }
}

/** True when rewriting the summary document would change nothing a widget shows. */
export function summariesEqual(a: TodaySummary, b: TodaySummary): boolean {
  const { generatedAt: _a, ...restA } = a
  const { generatedAt: _b, ...restB } = b
  return JSON.stringify(restA) === JSON.stringify(restB)
}

export interface Digest {
  title: string
  body: string
}

/** The single morning notification: counts in the title, first few items in the body. Null on a clear day. */
export function buildDigest(summary: TodaySummary): Digest | null {
  const { overdue, soon, today } = summary.counts
  const dueToday = soon + today
  if (overdue === 0 && dueToday === 0) return null
  const parts: string[] = []
  if (dueToday > 0) parts.push(`${dueToday} ${dueToday === 1 ? 'thing' : 'things'} due today`)
  if (overdue > 0) parts.push(`${overdue} overdue`)
  const shown = summary.items.filter((i) => i.urgency === 'overdue' || i.urgency === 'soon' || i.urgency === 'today')
  return { title: parts.join(', '), body: shown.slice(0, 3).map((i) => i.title).join(' · ') }
}
