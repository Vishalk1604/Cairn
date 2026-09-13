import {
  alertsBetween,
  atLocalTime,
  buildDigest,
  buildTodaySummary,
  DAY,
  MINUTE,
  startOfLocalDay,
  type Alert,
  type Reminder,
} from '@cairn/core'
import { describeAlert } from '@cairn/ui'

export interface SchedulerState {
  /** The instant the previous tick covered up to. */
  lastTick: number
  /** Start of the local day the morning digest last went out. */
  lastDigestDay: number | null
}

export interface TickNotification {
  title: string
  body?: string
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag?: string
  reminderId?: string
}

export interface TickOptions {
  /** Alerts older than this when noticed (laptop asleep, app closed) are grouped as missed. */
  staleAfterMs?: number
  /** More simultaneous alerts than this collapse into one notification. */
  groupAbove?: number
  /** Morning digest goes out at this hour, or at first launch before digestUntilHour. */
  digestHour?: number
  digestUntilHour?: number
  digest?: boolean
  /** For notification text. Defaults to the system locale. */
  locale?: string
}

/**
 * Decides what to show on one scheduler tick. Pure: the caller persists the
 * returned state and shows the notifications.
 */
export function planTick(
  reminders: readonly Reminder[],
  state: SchedulerState,
  now: number,
  options: TickOptions = {},
): { notifications: TickNotification[]; state: SchedulerState } {
  const staleAfter = options.staleAfterMs ?? 15 * MINUTE
  const groupAbove = options.groupAbove ?? 3
  const notifications: TickNotification[] = []

  // Never replay more than a week of backlog.
  const alerts = alertsBetween(reminders, Math.max(state.lastTick, now - 7 * DAY), now)
  const fresh = alerts.filter((a) => now - a.at <= staleAfter)
  const stale = alerts.filter((a) => now - a.at > staleAfter)

  if (fresh.length > groupAbove) {
    notifications.push({ title: `${fresh.length} reminders`, body: titles(fresh), tag: 'batch' })
  } else {
    for (const a of fresh) {
      notifications.push({ title: a.title, body: describeAlert(a, now, options.locale), tag: a.reminderId, reminderId: a.reminderId })
    }
  }
  if (stale.length > 0) {
    notifications.push({
      title: stale.length === 1 ? 'Missed while you were away' : `${stale.length} reminders came due while you were away`,
      body: titles(stale),
      tag: 'missed',
    })
  }

  let lastDigestDay = state.lastDigestDay
  const today = startOfLocalDay(now)
  const digestWindowOpen =
    now >= atLocalTime(now, options.digestHour ?? 8) && now < atLocalTime(now, options.digestUntilHour ?? 12)
  if ((options.digest ?? true) && lastDigestDay !== today && digestWindowOpen) {
    const digest = buildDigest(buildTodaySummary(reminders, now))
    if (digest) notifications.push({ ...digest, tag: 'digest' })
    lastDigestDay = today
  }

  return { notifications, state: { lastTick: now, lastDigestDay } }
}

function titles(alerts: readonly Alert[]): string {
  const unique = [...new Set(alerts.map((a) => a.title))]
  return unique.length > 3 ? `${unique.slice(0, 3).join(' · ')} +${unique.length - 3} more` : unique.join(' · ')
}
