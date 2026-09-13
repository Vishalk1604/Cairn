import { createReminder, HOUR, snoozeReminder } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { planNotifications } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 9, 14, 10)
const due = (title: string, dueAt: number, extra: Partial<Parameters<typeof createReminder>[0]> = {}) =>
  createReminder({ title, dueAt, ...extra }, { userId: 'u', now: NOW - HOUR })
const plain = (s: string) => s.replace(/ /g, ' ')

describe('planNotifications', () => {
  it('schedules upcoming alerts, worded for when they fire', () => {
    const exam = due('Exam', at(2026, 9, 16, 9), { alertOffsets: [0, 60 * 24] })
    const plan = planNotifications([exam, due('Past', NOW - HOUR)], NOW, { digest: false, locale: 'en-US' })
    expect(plan.map((p) => [p.id, p.at, plain(p.body)])).toEqual([
      [`${exam.id}@${at(2026, 9, 15, 9)}`, at(2026, 9, 15, 9), 'Due Tomorrow 9:00 AM'],
      [`${exam.id}@${at(2026, 9, 16, 9)}`, at(2026, 9, 16, 9), 'Due now'],
    ])
  })

  it('includes the snooze alert and respects the limit', () => {
    const r = snoozeReminder(due('Stretch', NOW + 2 * HOUR), NOW + HOUR, NOW)
    const many = Array.from({ length: 60 }, (_, i) => due(`r${i}`, NOW + (i + 1) * HOUR))
    expect(planNotifications([r], NOW, { digest: false }).map((p) => p.at)).toEqual([NOW + HOUR, NOW + 2 * HOUR])
    expect(planNotifications(many, NOW, { digest: false, limit: 10 })).toHaveLength(10)
  })

  it('adds digests for the next mornings that have something due', () => {
    const plan = planNotifications([due('Quiz', at(2026, 9, 15, 10)), due('Essay', at(2026, 9, 17, 17))], NOW, { locale: 'en-US' })
    const digests = plan.filter((p) => p.id.startsWith('digest@'))
    expect(digests.map((d) => [d.at, d.title, d.body])).toEqual([
      [at(2026, 9, 15, 8), '1 thing due today', 'Quiz'],
      [at(2026, 9, 16, 8), '1 overdue', 'Quiz'],
      [at(2026, 9, 17, 8), '1 thing due today, 1 overdue', 'Quiz · Essay'],
    ])
  })
})
