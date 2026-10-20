import { buildTodaySummary, createReminder, completeReminder, type Reminder } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { describeWorkload } from '../src'

const at = (y: number, mo: number, d: number, h = 0) => new Date(y, mo - 1, d, h).getTime()
const NOW = at(2026, 9, 14, 10)
const due = (title: string, dueAt: number): Reminder => createReminder({ title, dueAt }, { userId: 'u', now: NOW })
const describe_ = (reminders: Reminder[]) => describeWorkload(buildTodaySummary(reminders, NOW))

describe('describeWorkload', () => {
  it('counts what is due today and what is late', () => {
    expect(describe_([due('a', at(2026, 9, 14, 18)), due('b', at(2026, 9, 14, 11))])).toBe('2 due today')
    expect(describe_([due('a', at(2026, 9, 13, 9))])).toBe('1 overdue')
    expect(describe_([due('a', at(2026, 9, 14, 18)), due('b', at(2026, 9, 12, 9))])).toBe('1 due today, 1 overdue')
  })

  it('never claims nothing is due while something this week is', () => {
    expect(describe_([due('a', at(2026, 9, 17, 9)), due('b', at(2026, 9, 18, 9))])).toBe('2 this week')
  })

  it('separates an empty week from an empty list', () => {
    expect(describe_([])).toBe('nothing due')
    expect(describe_([completeReminder(due('a', at(2026, 9, 14, 18)), NOW)])).toBe('nothing due')
    expect(describe_([due('a', at(2026, 10, 1, 9))])).toBe('nothing due this week')
  })
})
