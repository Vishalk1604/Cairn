import {
  alertsBetween,
  DAY,
  digestKey,
  dueDigest,
  dueDigests,
  MINUTE,
  todayDigest,
  type Alert,
  type InboxRecord,
  type Reminder,
  type SenderRule,
} from '@cairn/core'
import { describeAlert } from '@cairn/ui'

export interface SchedulerState {
  /** The instant the previous tick covered up to. */
  lastTick: number
  /** Digests already sent, by digestKey: each goes out once a day. */
  sent?: string[]
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
  /** The evening's "due tomorrow", the morning's "due today" and the eight o'clock summary. */
  digest?: boolean
  /** What the inbox holds, for the summary. */
  records?: readonly InboxRecord[]
  senders?: Readonly<Record<string, SenderRule>>
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

  // The same digests the phone is sent, on this computer's own clock, while Cairn runs.
  const sent = new Set(state.sent ?? [])
  if (options.digest ?? true) {
    for (const kind of dueDigests(now, sent)) {
      sent.add(digestKey(kind, now))
      const digest = kind === 'today' ? todayDigest(reminders, options.records ?? [], now, options.senders) : dueDigest(kind, reminders, now)
      if (digest) notifications.push({ title: digest.title, body: digest.body, tag: `digest-${kind}`, ...(digest.reminderId ? { reminderId: digest.reminderId } : {}) })
    }
  }

  return { notifications, state: { lastTick: now, sent: [...sent].slice(-9) } }
}

function titles(alerts: readonly Alert[]): string {
  const unique = [...new Set(alerts.map((a) => a.title))]
  return unique.length > 3 ? `${unique.slice(0, 3).join(' · ')} +${unique.length - 3} more` : unique.join(' · ')
}
