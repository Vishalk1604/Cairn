import { addLocalDays, atLocalTime, buildDigest, buildTodaySummary, DAY, upcomingAlerts, type Alert, type Reminder } from '@cairn/core'
import { formatDue } from './format'

/** Notification body for an alert, worded for the moment it fires. */
export function describeAlert(a: Alert, firesAt: number, locale?: string): string {
  if (a.kind === 'due') return a.allDay ? 'Due today' : 'Due now'
  const when = formatDue(a.dueAt, a.allDay, firesAt, { locale })
  return a.dueAt <= firesAt ? `Was due ${when}` : `Due ${when}`
}

export interface PlannedNotification {
  /** Stable per alert, so rescheduling the same plan is idempotent. */
  id: string
  at: number
  title: string
  body: string
  reminderId?: string
}

export interface NotificationPlanOptions {
  horizonMs?: number
  /** Android caps how many alarms an app may hold; stay well under it. */
  limit?: number
  digest?: boolean
  digestHour?: number
  /** How many upcoming mornings get a digest scheduled in advance. */
  digestDays?: number
  locale?: string
}

/**
 * Everything to hand an OS scheduler that fires while the app isn't running
 * (Android): the next alerts plus the next few morning digests. Digests are
 * computed from today's data, so the app refreshes the plan whenever it opens.
 */
export function planNotifications(
  reminders: readonly Reminder[],
  now: number,
  options: NotificationPlanOptions = {},
): PlannedNotification[] {
  const { horizonMs = 7 * DAY, limit = 48, digest = true, digestHour = 8, digestDays = 3, locale } = options

  const plan: PlannedNotification[] = upcomingAlerts(reminders, now, horizonMs, limit).map((a) => ({
    id: `${a.reminderId}@${a.at}`,
    at: a.at,
    title: a.title,
    body: describeAlert(a, a.at, locale),
    reminderId: a.reminderId,
  }))

  if (digest) {
    for (let day = 0; day <= digestDays; day++) {
      const morning = atLocalTime(addLocalDays(now, day), digestHour)
      if (morning <= now || plan.filter((p) => p.id.startsWith('digest@')).length >= digestDays) continue
      const message = buildDigest(buildTodaySummary(reminders, morning))
      if (message) plan.push({ id: `digest@${morning}`, at: morning, ...message })
    }
  }

  return plan.sort((a, b) => a.at - b.at)
}
