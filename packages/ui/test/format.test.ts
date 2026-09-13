import { buildRecurrence, createReminder, snoozeReminder, URGENCY_LEVELS } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { formatDue, formatReminderWhen, URGENCY } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 9, 14, 10)
const en = { locale: 'en-US' }
// ICU may put a narrow no-break space before AM/PM.
const fmt = (...args: Parameters<typeof formatDue>) => formatDue(...args).replace(/ /g, ' ')

describe('formatDue', () => {
  it.each([
    [at(2026, 9, 14, 18), false, '6:00 PM'],
    [at(2026, 9, 14, 9), true, 'Today'],
    [at(2026, 9, 15, 9), false, 'Tomorrow 9:00 AM'],
    [at(2026, 9, 15, 9), true, 'Tomorrow'],
    [at(2026, 9, 13, 18), false, 'Yesterday 6:00 PM'],
    [at(2026, 9, 18, 18), false, 'Fri 6:00 PM'],
    [at(2026, 9, 10, 9), true, 'Thu'],
    [at(2026, 9, 30, 9), true, 'Sep 30'],
    [at(2027, 1, 5, 9), true, 'Jan 5, 2027'],
  ])('%#: %s', (dueAt, allDay, label) => {
    expect(fmt(dueAt, allDay, NOW, en)).toBe(label)
  })
})

describe('formatReminderWhen', () => {
  it('adds the repeat pattern and snooze', () => {
    const dueAt = at(2026, 9, 21, 9)
    const r = createReminder(
      { title: 'Standup', dueAt, rrule: buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, dueAt) },
      { userId: 'u', now: NOW },
    )
    const snoozed = snoozeReminder(r, at(2026, 9, 14, 12), NOW)
    expect(formatReminderWhen(snoozed, NOW, en).replace(/ /g, ' ')).toBe(
      'Sep 21 9:00 AM · every week on Monday · snoozed until 12:00 PM',
    )
  })
})

describe('tokens', () => {
  it('covers every urgency level with a distinct symbol', () => {
    expect(Object.keys(URGENCY).sort()).toEqual([...URGENCY_LEVELS].sort())
    expect(new Set(Object.values(URGENCY).map((t) => t.symbol)).size).toBe(URGENCY_LEVELS.length)
  })
})
