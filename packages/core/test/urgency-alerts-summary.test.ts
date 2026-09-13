import { describe, expect, it } from 'vitest'
import {
  alertsBetween,
  alertsFor,
  buildDigest,
  buildTodaySummary,
  compareByUrgency,
  completeReminder,
  createReminder,
  deleteReminder,
  HOUR,
  MINUTE,
  nextAlertAt,
  nextUrgencyChangeAt,
  snoozeReminder,
  summariesEqual,
  upcomingAlerts,
  urgencyOf,
  worstUrgency,
  type Reminder,
} from '../src'
import { at, ctx, NOW } from './helpers'

const due = (dueAt: number, extra: Partial<Parameters<typeof createReminder>[0]> = {}): Reminder =>
  createReminder({ title: `due ${new Date(dueAt).toISOString()}`, dueAt, ...extra }, ctx)

describe('urgencyOf', () => {
  it.each([
    ['overdue', at(2026, 9, 14, 9, 59)],
    ['soon', at(2026, 9, 14, 11, 30)],
    ['today', at(2026, 9, 14, 18)],
    ['week', at(2026, 9, 20, 23)],
    ['later', at(2026, 9, 21, 0, 1)],
  ] as const)('%s', (level, dueAt) => {
    expect(urgencyOf(due(dueAt), NOW)).toBe(level)
  })

  it('is done once completed or deleted', () => {
    expect(urgencyOf(completeReminder(due(NOW), NOW), NOW)).toBe('done')
    expect(urgencyOf(deleteReminder(due(NOW), NOW), NOW)).toBe('done')
  })

  it('keeps an all-day reminder "today" after its alert time has passed', () => {
    const r = due(at(2026, 9, 14, 9), { allDay: true })
    expect(urgencyOf(r, NOW)).toBe('today')
    expect(urgencyOf(r, at(2026, 9, 14, 22, 30))).toBe('soon')
    expect(urgencyOf(r, at(2026, 9, 15, 0, 0))).toBe('overdue')
  })

  it('turns high-priority reminders "soon" a day ahead', () => {
    expect(urgencyOf(due(at(2026, 9, 15, 9)), NOW)).toBe('week')
    expect(urgencyOf(due(at(2026, 9, 15, 9), { priority: 'high' }), NOW)).toBe('soon')
  })

  it('judges a snoozed reminder by when it comes back', () => {
    const snoozed = snoozeReminder(due(at(2026, 9, 13, 9)), at(2026, 9, 14, 20), NOW)
    expect(urgencyOf(snoozed, NOW)).toBe('today')
    expect(urgencyOf(snoozed, at(2026, 9, 14, 20, 1))).toBe('overdue')
  })
})

describe('nextUrgencyChangeAt', () => {
  it('points at the next color flip', () => {
    const r = due(at(2026, 9, 14, 15))
    expect(nextUrgencyChangeAt(r, NOW)).toBe(at(2026, 9, 14, 13))
    expect(nextUrgencyChangeAt(r, at(2026, 9, 14, 13))).toBe(at(2026, 9, 14, 15))
    expect(nextUrgencyChangeAt(r, at(2026, 9, 14, 15))).toBeNull()
  })

  it('includes the day boundaries for far-off reminders', () => {
    const r = due(at(2026, 9, 25, 12))
    expect(urgencyOf(r, NOW)).toBe('later')
    const flip = nextUrgencyChangeAt(r, NOW)!
    expect(flip).toBe(at(2026, 9, 19))
    expect(urgencyOf(r, flip)).toBe('week')
  })
})

describe('ordering', () => {
  it('sorts by urgency, then time, then priority', () => {
    const a = due(at(2026, 9, 16, 9), { title: 'week' })
    const b = due(at(2026, 9, 13, 9), { title: 'overdue' })
    const c = due(at(2026, 9, 14, 18), { title: 'today low', priority: 'low' })
    const d = due(at(2026, 9, 14, 18), { title: 'today high', priority: 'high' })
    const sorted = [a, b, c, d].sort(compareByUrgency(NOW)).map((r) => r.title)
    expect(sorted).toEqual(['overdue', 'today high', 'today low', 'week'])
    expect(worstUrgency([a, c], NOW)).toBe('today')
    expect(worstUrgency([], NOW)).toBeNull()
  })
})

describe('alerts', () => {
  it('alerts once at the due time by default', () => {
    expect(alertsFor(due(at(2026, 9, 14, 18))).map((a) => [a.at, a.kind])).toEqual([[at(2026, 9, 14, 18), 'due']])
  })

  it('adds advance alerts, earliest first', () => {
    const r = due(at(2026, 9, 15, 18), { alertOffsets: [0, 60, 1440] })
    expect(alertsFor(r).map((a) => a.kind)).toEqual(['advance', 'advance', 'due'])
    expect(alertsFor(r)[0]!.at).toBe(at(2026, 9, 14, 18))
  })

  it('silences alerts during a snooze and fires when it ends', () => {
    const r = snoozeReminder(due(at(2026, 9, 14, 18), { alertOffsets: [0, 120] }), at(2026, 9, 14, 17), NOW)
    expect(alertsFor(r).map((a) => [a.at, a.kind])).toEqual([
      [at(2026, 9, 14, 17), 'snooze'],
      [at(2026, 9, 14, 18), 'due'],
    ])
  })

  it('stops alerting when done', () => {
    expect(alertsFor(completeReminder(due(NOW + HOUR), NOW))).toEqual([])
    expect(nextAlertAt(due(NOW - MINUTE), NOW)).toBeNull()
    expect(nextAlertAt(due(NOW + HOUR), NOW)).toBe(NOW + HOUR)
  })

  it('finds alerts in a half-open window, for tick-based scheduling', () => {
    const rs = [due(NOW), due(NOW + MINUTE), due(NOW + 2 * MINUTE)]
    expect(alertsBetween(rs, NOW, NOW + MINUTE).map((a) => a.at)).toEqual([NOW + MINUTE])
    expect(upcomingAlerts(rs, NOW - 1, HOUR, 2).map((a) => a.at)).toEqual([NOW, NOW + MINUTE])
  })
})

describe('today summary', () => {
  const reminders = [
    due(at(2026, 9, 13, 9), { title: 'overdue' }),
    due(at(2026, 9, 14, 11), { title: 'soon' }),
    due(at(2026, 9, 14, 18), { title: 'today' }),
    due(at(2026, 9, 16, 9), { title: 'week 1' }),
    due(at(2026, 9, 17, 9), { title: 'week 2' }),
    due(at(2026, 10, 1, 9), { title: 'later' }),
    completeReminder(due(at(2026, 9, 14, 12), { title: 'done' }), NOW),
    deleteReminder(due(at(2026, 9, 14, 12), { title: 'deleted' }), NOW),
  ]

  it('lists the next five live reminders, most urgent first', () => {
    const summary = buildTodaySummary(reminders, NOW)
    expect(summary.items.map((i) => i.title)).toEqual(['overdue', 'soon', 'today', 'week 1', 'week 2'])
    expect(summary.counts).toEqual({ overdue: 1, soon: 1, today: 1, week: 2 })
    expect(summary.worst).toBe('overdue')
    expect(summary.nextChangeAt).toBe(at(2026, 9, 14, 11))
  })

  it('only differs when something visible changed', () => {
    const a = buildTodaySummary(reminders, NOW)
    const b = buildTodaySummary(reminders, NOW + MINUTE)
    expect(summariesEqual(a, b)).toBe(true)
    expect(summariesEqual(a, buildTodaySummary(reminders, at(2026, 9, 14, 11, 1)))).toBe(false)
  })

  it('writes a morning digest, or nothing on a clear day', () => {
    expect(buildDigest(buildTodaySummary(reminders, NOW))).toEqual({
      title: '2 things due today, 1 overdue',
      body: 'overdue · soon · today',
    })
    expect(buildDigest(buildTodaySummary([due(at(2026, 10, 1, 9))], NOW))).toBeNull()
  })
})
