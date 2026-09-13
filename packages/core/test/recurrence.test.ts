import { describe, expect, it } from 'vitest'
import {
  buildRecurrence,
  describeRecurrence,
  isValidRecurrence,
  nextOccurrence,
  occurrencesBetween,
  rebaseRecurrence,
  recurrenceSpec,
  recurrenceStart,
} from '../src'
import { at, show } from './helpers'

describe('recurrence', () => {
  it('stores floating local time (no UTC marker)', () => {
    const rule = buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, at(2026, 10, 26, 9))
    expect(rule).toBe('DTSTART:20261026T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO')
  })

  it('keeps the wall-clock time when DST ends', () => {
    const rule = buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, at(2026, 10, 26, 9))
    expect(show(nextOccurrence(rule, at(2026, 10, 26, 9))!)).toBe(show(at(2026, 11, 2, 9)))
  })

  it('keeps the wall-clock time when DST starts', () => {
    const rule = buildRecurrence({ freq: 'daily' }, at(2026, 3, 7, 9))
    expect(nextOccurrence(rule, at(2026, 3, 7, 9))).toBe(at(2026, 3, 8, 9))
  })

  it('is exclusive by default and inclusive on request', () => {
    const rule = buildRecurrence({ freq: 'daily' }, at(2026, 9, 14, 9))
    expect(nextOccurrence(rule, at(2026, 9, 14, 9))).toBe(at(2026, 9, 15, 9))
    expect(nextOccurrence(rule, at(2026, 9, 14, 9), true)).toBe(at(2026, 9, 14, 9))
  })

  it('supports intervals', () => {
    const rule = buildRecurrence({ freq: 'weekly', interval: 2 }, at(2026, 9, 14, 9))
    expect(rule).toContain('INTERVAL=2')
    expect(nextOccurrence(rule, at(2026, 9, 14, 9))).toBe(at(2026, 9, 28, 9))
  })

  it('stops after count', () => {
    const rule = buildRecurrence({ freq: 'daily', count: 2 }, at(2026, 9, 14, 9))
    expect(nextOccurrence(rule, at(2026, 9, 14, 9))).toBe(at(2026, 9, 15, 9))
    expect(nextOccurrence(rule, at(2026, 9, 15, 9))).toBeNull()
  })

  it('stops after until', () => {
    const rule = buildRecurrence({ freq: 'daily', until: at(2026, 9, 15, 23) }, at(2026, 9, 14, 9))
    expect(rule).not.toMatch(/UNTIL=\d{8}T\d{6}Z/)
    expect(nextOccurrence(rule, at(2026, 9, 14, 9))).toBe(at(2026, 9, 15, 9))
    expect(nextOccurrence(rule, at(2026, 9, 15, 9))).toBeNull()
  })

  it('skips a start date that is not one of the rule days', () => {
    const rule = buildRecurrence({ freq: 'weekly', byWeekday: ['WE', 'FR'] }, at(2026, 9, 14, 9))
    expect(nextOccurrence(rule, at(2026, 9, 14, 9), true)).toBe(at(2026, 9, 16, 9))
  })

  it('lists occurrences in a range', () => {
    const rule = buildRecurrence({ freq: 'weekly', byWeekday: ['MO', 'WE'] }, at(2026, 9, 14, 9))
    expect(occurrencesBetween(rule, at(2026, 9, 14), at(2026, 9, 22))).toEqual([
      at(2026, 9, 14, 9),
      at(2026, 9, 16, 9),
      at(2026, 9, 21, 9),
    ])
  })

  it('round-trips the editable spec', () => {
    const spec = { freq: 'weekly' as const, interval: 2, byWeekday: ['MO' as const, 'TH' as const], count: 5 }
    const rule = buildRecurrence(spec, at(2026, 9, 14, 9))
    expect(recurrenceSpec(rule)).toEqual(spec)
    expect(recurrenceStart(rule)).toBe(at(2026, 9, 14, 9))
  })

  it('rebases onto a new start, keeping the pattern', () => {
    const rule = buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, at(2026, 9, 14, 9))
    const moved = rebaseRecurrence(rule, at(2026, 9, 21, 10))
    expect(moved).toBe('DTSTART:20260921T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO')
  })

  it('describes itself in English', () => {
    expect(describeRecurrence(buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, at(2026, 9, 14, 9)))).toBe(
      'every week on Monday',
    )
    expect(describeRecurrence(buildRecurrence({ freq: 'monthly', interval: 2 }, at(2026, 10, 1, 9)))).toBe(
      'every 2 months',
    )
  })

  it('rejects garbage and unsupported frequencies', () => {
    expect(isValidRecurrence('not a rule')).toBe(false)
    expect(isValidRecurrence('DTSTART:20260914T090000\nRRULE:FREQ=HOURLY')).toBe(false)
    expect(isValidRecurrence('DTSTART:20260914T090000\nRRULE:FREQ=DAILY')).toBe(true)
  })
})
