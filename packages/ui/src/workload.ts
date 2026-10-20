import type { TodaySummary } from '@cairn/core'

/**
 * One short phrase for everything still pending, used for the tray tooltip.
 * Covers the quiet cases too: a week that has something in it should never
 * read as "nothing due" while the tray icon is showing that week's colour.
 */
export function describeWorkload(summary: TodaySummary): string {
  const { overdue, soon, today, week } = summary.counts
  const dueToday = soon + today
  const parts = [dueToday > 0 ? `${dueToday} due today` : null, overdue > 0 ? `${overdue} overdue` : null].filter(Boolean)
  if (parts.length > 0) return parts.join(', ')
  if (week > 0) return `${week} this week`
  return summary.worst === null ? 'nothing due' : 'nothing due this week'
}
