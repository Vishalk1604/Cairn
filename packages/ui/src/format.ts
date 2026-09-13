import { addLocalDays, describeRecurrence, isSameLocalDay, startOfLocalDay, type Reminder } from '@cairn/core'

export interface FormatOptions {
  /** BCP 47 locale; defaults to the runtime's. */
  locale?: string
}

export function formatTime(t: number, options: FormatOptions = {}): string {
  return new Date(t).toLocaleTimeString(options.locale, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Compact due label: "6:00 PM", "Today", "Tomorrow 9:00 AM", "Fri", "Sep 30",
 * "Sep 30, 2027". Relative words within a day either side, weekday names
 * within a week, dates beyond.
 */
export function formatDue(dueAt: number, allDay: boolean, now: number, options: FormatOptions = {}): string {
  const { locale } = options
  const time = allDay ? '' : formatTime(dueAt, options)
  const withTime = (day: string) => (time ? `${day} ${time}` : day)

  if (isSameLocalDay(dueAt, now)) return time || 'Today'
  if (isSameLocalDay(dueAt, addLocalDays(now, 1))) return withTime('Tomorrow')
  if (isSameLocalDay(dueAt, addLocalDays(now, -1))) return withTime('Yesterday')

  const days = Math.round((startOfLocalDay(dueAt) - startOfLocalDay(now)) / 86_400_000)
  const date = new Date(dueAt)
  if (Math.abs(days) < 7) return withTime(date.toLocaleDateString(locale, { weekday: 'short' }))
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return withTime(
    date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) }),
  )
}

/** Due label plus repeat and snooze details, e.g. "Mon 9:00 AM · every week on Monday". */
export function formatReminderWhen(r: Reminder, now: number, options: FormatOptions = {}): string {
  const parts = [formatDue(r.dueAt, r.allDay, now, options)]
  if (r.rrule) parts.push(describeRecurrence(r.rrule))
  if (r.status === 'snoozed' && r.snoozedUntil !== undefined && r.snoozedUntil > now) {
    parts.push(`snoozed until ${formatDue(r.snoozedUntil, false, now, options)}`)
  }
  return parts.join(' · ')
}
