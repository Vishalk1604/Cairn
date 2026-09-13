import { createReminder, DAY, HOUR, MINUTE, snoozeReminder, type Reminder } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { planTick, type SchedulerState } from '../src/scheduler'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 9, 14, 13)
const due = (title: string, dueAt: number, extra: Partial<Parameters<typeof createReminder>[0]> = {}): Reminder =>
  createReminder({ title, dueAt, ...extra }, { userId: 'u', now: NOW - 10 * HOUR })
const state = (lastTick: number): SchedulerState => ({ lastTick, lastDigestDay: at(2026, 9, 14) })

describe('planTick', () => {
  it('fires what came due since the last tick, once', () => {
    const rs = [due('Call mom', NOW - 5_000), due('Later', NOW + HOUR)]
    const first = planTick(rs, state(NOW - 15_000), NOW)
    expect(first.notifications).toEqual([{ title: 'Call mom', body: 'Due now', tag: rs[0]!.id, reminderId: rs[0]!.id }])
    expect(planTick(rs, first.state, NOW + 15_000).notifications).toEqual([])
  })

  it('describes advance and all-day alerts', () => {
    const rs = [
      due('Exam', at(2026, 9, 15, 9), { alertOffsets: [0, 24 * 60] }),
      due('Laundry', at(2026, 9, 14, 9), { allDay: true }),
    ]
    const { notifications } = planTick(rs, state(at(2026, 9, 14, 8, 59)), at(2026, 9, 14, 9), { locale: 'en-US' })
    expect(notifications.map((n) => [n.title, n.body?.replace(/ /g, ' ')])).toEqual([
      ['Exam', 'Due Tomorrow 9:00 AM'],
      ['Laundry', 'Due today'],
    ])
  })

  it('collapses a burst into one notification', () => {
    const rs = ['a', 'b', 'c', 'd', 'e'].map((t) => due(t, NOW - 1000))
    const { notifications } = planTick(rs, state(NOW - 15_000), NOW)
    expect(notifications).toEqual([{ title: '5 reminders', body: 'a · b · c +2 more', tag: 'batch' }])
  })

  it('groups alerts missed while the app was closed', () => {
    const rs = [due('Yesterday', NOW - 20 * HOUR), due('Morning', NOW - 3 * HOUR), due('Just now', NOW - MINUTE)]
    const { notifications } = planTick(rs, state(NOW - DAY), NOW)
    expect(notifications.map((n) => n.title)).toEqual(['Just now', '2 reminders came due while you were away'])
  })

  it('fires when a snooze ends', () => {
    const r = snoozeReminder(due('Stretch', NOW - HOUR), NOW - 1000, NOW - 30 * MINUTE)
    expect(planTick([r], state(NOW - 15_000), NOW).notifications.map((n) => n.title)).toEqual(['Stretch'])
  })

  it('sends the morning digest once a day, only in the morning', () => {
    const rs = [due('Essay', at(2026, 9, 15, 17)), due('Quiz', at(2026, 9, 15, 10))]
    const fresh: SchedulerState = { lastTick: at(2026, 9, 15, 7, 59), lastDigestDay: at(2026, 9, 14) }

    const early = planTick(rs, fresh, at(2026, 9, 15, 7, 59))
    expect(early.notifications).toEqual([])

    const morning = planTick(rs, { ...fresh, lastTick: at(2026, 9, 15, 8) }, at(2026, 9, 15, 8, 0))
    expect(morning.notifications).toEqual([{ title: '2 things due today', body: 'Quiz · Essay', tag: 'digest' }])
    expect(planTick(rs, morning.state, at(2026, 9, 15, 8, 1)).notifications).toEqual([])

    const afternoon = planTick(rs, { ...fresh, lastTick: at(2026, 9, 15, 12) }, at(2026, 9, 15, 12))
    expect(afternoon.notifications.filter((n) => n.tag === 'digest')).toEqual([])
  })
})
