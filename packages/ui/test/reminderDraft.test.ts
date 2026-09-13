import { buildRecurrence, completeReminder, createReminder, updateReminder, type RecurrenceSpec } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import {
  applyWhen,
  changesFromDraft,
  draftFromReminder,
  emptyDraft,
  fromInputs,
  inputFromDraft,
  repeatChoiceOf,
  type RepeatChoice,
} from '../src/reminderDraft'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 9, 14, 10)
const ctx = { userId: 'u', now: NOW }

describe('inputs', () => {
  it('reads date and time inputs as local time, all-day at the default hour', () => {
    expect(fromInputs('2026-09-18', '18:30', 9)).toBe(at(2026, 9, 18, 18, 30))
    expect(fromInputs('2026-09-18', '9:05', 9)).toBe(at(2026, 9, 18, 9, 5))
    expect(fromInputs('2026-09-18', '', 9)).toBe(at(2026, 9, 18, 9))
    expect(fromInputs('', '18:30', 9)).toBeNull()
    expect(fromInputs('2026-09-18', '25:00', 9)).toBeNull()
  })

  it('explains a bad time separately from a missing date', () => {
    expect(inputFromDraft({ ...emptyDraft(NOW), title: 'x', time: '6pm' })).toEqual({
      ok: false,
      error: 'Use a time like 18:30, or leave it empty for all day',
    })
  })
})

describe('repeat presets', () => {
  // NOW is a Monday.
  const cases: [RecurrenceSpec, RepeatChoice][] = [
    [{ freq: 'daily' }, 'daily'],
    [{ freq: 'weekly' }, 'weekly'],
    [{ freq: 'weekly', byWeekday: ['MO'] }, 'weekly'],
    [{ freq: 'weekly', byWeekday: ['TU'] }, 'custom'],
    [{ freq: 'weekly', byWeekday: ['MO', 'TU', 'WE', 'TH', 'FR'] }, 'weekdays'],
    [{ freq: 'weekly', interval: 2 }, 'custom'],
    [{ freq: 'monthly' }, 'monthly'],
  ]
  it.each(cases)('%j → %s', (spec, choice) => {
    expect(repeatChoiceOf(spec, NOW)).toBe(choice)
  })
})

describe('drafts', () => {
  it('round-trips a reminder', () => {
    const r = createReminder({ title: 'Gym', dueAt: at(2026, 9, 16, 7), rrule: buildRecurrence({ freq: 'weekly', interval: 2 }, at(2026, 9, 16, 7)), tags: ['health'], alertOffsets: [0, 60] }, ctx)
    const draft = draftFromReminder(r)
    expect(draft).toMatchObject({ title: 'Gym', date: '2026-09-16', time: '07:00', repeat: 'custom', tags: 'health', alerts: [60, 0] })
    expect(draft.customRule).toEqual({ freq: 'weekly', interval: 2 })
  })

  it('validates before creating', () => {
    expect(inputFromDraft({ ...emptyDraft(NOW), title: ' ' })).toEqual({ ok: false, error: 'Give it a title' })
    const result = inputFromDraft({ ...emptyDraft(NOW), title: 'Pay rent', repeat: 'monthly' })
    expect(result.ok && result.value).toMatchObject({ title: 'Pay rent', dueAt: at(2026, 9, 14, 9), allDay: true })
    expect(result.ok && result.value.rrule).toBe('DTSTART:20260914T090000\nRRULE:FREQ=MONTHLY')
  })

  it('keeps a series intact when only the title changes', () => {
    const rrule = buildRecurrence({ freq: 'daily', count: 3 }, at(2026, 9, 14, 9))
    const r = completeReminder(createReminder({ title: 'Meds', dueAt: at(2026, 9, 14, 9), rrule }, ctx), at(2026, 9, 14, 9, 30))
    const changes = changesFromDraft(r, { ...draftFromReminder(r), title: 'Take meds' })
    expect(changes.ok && changes.value.recurrence).toBeUndefined()
    const saved = updateReminder(r, changes.ok ? changes.value : {}, NOW)
    expect(saved.rrule).toBe(rrule)
    expect(saved.title).toBe('Take meds')
  })

  it('re-anchors the series when the schedule changes', () => {
    const r = createReminder({ title: 'Standup', dueAt: at(2026, 9, 14, 9), rrule: buildRecurrence({ freq: 'daily' }, at(2026, 9, 14, 9)) }, ctx)
    const changes = changesFromDraft(r, { ...draftFromReminder(r), time: '09:30' })
    expect(changes.ok && changes.value).toMatchObject({ dueAt: at(2026, 9, 14, 9, 30), recurrence: { freq: 'daily' } })
  })

  it('fills the schedule from natural language', () => {
    const draft = applyWhen(emptyDraft(NOW), 'every weekday at 9:30', NOW)
    expect(draft).toMatchObject({ date: '2026-09-15', time: '09:30', repeat: 'weekdays' })
    expect(applyWhen(emptyDraft(NOW), 'every other week', NOW)).toMatchObject({ repeat: 'custom', customRule: { freq: 'weekly', interval: 2 } })
    expect(applyWhen(emptyDraft(NOW), 'whenever', NOW)).toBeNull()
  })
})
