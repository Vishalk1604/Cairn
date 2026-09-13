import type { Reminder } from './model'
import { MINUTE } from './time'

export type AlertKind = 'due' | 'advance' | 'snooze'

export interface Alert {
  reminderId: string
  at: number
  kind: AlertKind
  title: string
  dueAt: number
  allDay: boolean
}

/**
 * Every alert a reminder will raise for its current occurrence. Snoozing
 * silences all alerts until the snooze ends, then fires once at its end.
 * Recurring reminders only alert for the current occurrence; completing one
 * advances dueAt and the next occurrence's alerts follow from that.
 */
export function alertsFor(r: Reminder): Alert[] {
  if (r.status === 'done' || r.deletedAt !== undefined) return []
  const snoozeEnd = r.status === 'snoozed' ? r.snoozedUntil : undefined
  const byTime = new Map<number, Alert>()
  const base = { reminderId: r.id, title: r.title, dueAt: r.dueAt, allDay: r.allDay }

  for (const offset of r.alertOffsets ?? [0]) {
    const at = r.dueAt - offset * MINUTE
    if (snoozeEnd !== undefined && at < snoozeEnd) continue
    byTime.set(at, { ...base, at, kind: offset === 0 ? 'due' : 'advance' })
  }
  if (snoozeEnd !== undefined) byTime.set(snoozeEnd, { ...base, at: snoozeEnd, kind: 'snooze' })

  return [...byTime.values()].sort((a, b) => a.at - b.at)
}

export function nextAlertAt(r: Reminder, now: number): number | null {
  return alertsFor(r).find((a) => a.at > now)?.at ?? null
}

/** Alerts in (from, to]. For tick-driven schedulers: pass the previous tick as `from`. */
export function alertsBetween(reminders: Iterable<Reminder>, from: number, to: number): Alert[] {
  const out: Alert[] = []
  for (const r of reminders) {
    for (const alert of alertsFor(r)) {
      if (alert.at > from && alert.at <= to) out.push(alert)
    }
  }
  return out.sort((a, b) => a.at - b.at)
}

/** The next alerts after now within the horizon, soonest first. For OS-level scheduling. */
export function upcomingAlerts(
  reminders: Iterable<Reminder>,
  now: number,
  horizonMs: number,
  limit = Number.POSITIVE_INFINITY,
): Alert[] {
  return alertsBetween(reminders, now, now + horizonMs).slice(0, limit)
}
