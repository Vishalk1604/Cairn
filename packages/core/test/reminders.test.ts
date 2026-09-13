import { describe, expect, it } from 'vitest'
import {
  buildRecurrence,
  completeReminder,
  createReminder,
  deadlineOf,
  deleteReminder,
  HOUR,
  isMissed,
  isOverdue,
  reopenReminder,
  rescheduleReminder,
  skipOccurrence,
  snoozeReminder,
  updateReminder,
  type Reminder,
} from '../src'
import { at, ctx, NOW, show } from './helpers'

const oneOff = (overrides: Partial<Parameters<typeof createReminder>[0]> = {}) =>
  createReminder({ title: 'Submit DBMS assignment', dueAt: at(2026, 9, 18, 18), ...overrides }, ctx)

const everyMonday9 = () =>
  createReminder(
    { title: 'Standup', dueAt: at(2026, 9, 14, 9), rrule: buildRecurrence({ freq: 'weekly', byWeekday: ['MO'] }, at(2026, 9, 14, 9)) },
    ctx,
  )

describe('createReminder', () => {
  it('fills defaults and stores no undefined fields', () => {
    const r = oneOff({ tags: ['#DBMS', 'dbms', ' Uni '] })
    expect(r).toMatchObject({ status: 'pending', priority: 'normal', source: 'manual', allDay: false, userId: 'u1' })
    expect(r.tags).toEqual(['dbms', 'uni'])
    expect(r.createdAt).toBe(NOW)
    expect(Object.values(r)).not.toContain(undefined)
  })

  it('uses a supplied id so imports are idempotent', () => {
    expect(createReminder({ title: 'x', dueAt: NOW }, { ...ctx, id: 'classroom-123' }).id).toBe('classroom-123')
  })

  it('rejects a blank title', () => {
    expect(() => oneOff({ title: '   ' })).toThrow(/title/)
  })

  it('snaps a recurring reminder onto its first real occurrence', () => {
    const r = createReminder(
      { title: 'Gym', dueAt: at(2026, 9, 14, 7), rrule: buildRecurrence({ freq: 'weekly', byWeekday: ['WE'] }, at(2026, 9, 14, 7)) },
      ctx,
    )
    expect(show(r.dueAt)).toBe(show(at(2026, 9, 16, 7)))
    expect(r.rrule).toContain('DTSTART:20260916T070000')
  })

  it('drops alert offsets that mean "just at the due time"', () => {
    expect(oneOff({ alertOffsets: [0] }).alertOffsets).toBeUndefined()
    expect(oneOff({ alertOffsets: [0, 60, 1440, 60] }).alertOffsets).toEqual([1440, 60, 0])
  })
})

describe('completing', () => {
  it('marks a one-off reminder done', () => {
    const done = completeReminder(oneOff(), NOW)
    expect(done).toMatchObject({ status: 'done', completedAt: NOW, updatedAt: NOW })
    expect(completeReminder(done, NOW + 1)).toBe(done)
  })

  it('advances a recurring reminder completed early to the following occurrence', () => {
    const r = everyMonday9()
    const done = completeReminder(r, at(2026, 9, 14, 8))
    expect(done.status).toBe('pending')
    expect(show(done.dueAt)).toBe(show(at(2026, 9, 21, 9)))
    expect(done.completedAt).toBe(at(2026, 9, 14, 8))
  })

  it('skips occurrences missed while overdue', () => {
    const done = completeReminder(everyMonday9(), at(2026, 9, 30, 12))
    expect(show(done.dueAt)).toBe(show(at(2026, 10, 5, 9)))
  })

  it('finishes a recurring reminder once its rule runs out', () => {
    const rrule = buildRecurrence({ freq: 'daily', count: 2 }, at(2026, 9, 14, 9))
    let r = createReminder({ title: 'Twice', dueAt: at(2026, 9, 14, 9), rrule }, ctx)
    r = completeReminder(r, at(2026, 9, 14, 9, 30))
    expect(r.status).toBe('pending')
    r = completeReminder(r, at(2026, 9, 15, 9, 30))
    expect(r.status).toBe('done')
  })

  it('clears an active snooze', () => {
    const snoozed = snoozeReminder(oneOff(), NOW + HOUR, NOW)
    const done = completeReminder(snoozed, NOW)
    expect(done.snoozedUntil).toBeUndefined()
    expect('snoozedUntil' in done).toBe(false)
  })

  it('reopens a completed reminder', () => {
    const reopened = reopenReminder(completeReminder(oneOff(), NOW), NOW + 1)
    expect(reopened.status).toBe('pending')
    expect('completedAt' in reopened).toBe(false)
  })

  it('skips a recurring occurrence without recording a completion', () => {
    const skipped = skipOccurrence(everyMonday9(), at(2026, 9, 14, 8))
    expect(show(skipped.dueAt)).toBe(show(at(2026, 9, 21, 9)))
    expect(skipped.completedAt).toBeUndefined()
    expect(skipOccurrence(oneOff(), NOW)).toMatchObject({ status: 'pending', dueAt: at(2026, 9, 18, 18) })
  })
})

describe('snoozing and rescheduling', () => {
  it('snoozes into the future only', () => {
    expect(() => snoozeReminder(oneOff(), NOW, NOW)).toThrow(/future/)
    expect(snoozeReminder(oneOff(), NOW + HOUR, NOW)).toMatchObject({ status: 'snoozed', snoozedUntil: NOW + HOUR })
  })

  it('reschedules one occurrence, keeping the series', () => {
    const r = everyMonday9()
    const moved = rescheduleReminder(snoozeReminder(r, NOW + HOUR, NOW), at(2026, 9, 15, 9), NOW)
    expect(moved).toMatchObject({ status: 'pending', dueAt: at(2026, 9, 15, 9), rrule: r.rrule })
    expect(show(completeReminder(moved, at(2026, 9, 15, 10)).dueAt)).toBe(show(at(2026, 9, 21, 9)))
  })
})

describe('updateReminder', () => {
  it('moves the whole series when a recurring reminder is re-timed', () => {
    const moved = updateReminder(everyMonday9(), { dueAt: at(2026, 9, 21, 10) }, NOW)
    expect(moved.rrule).toBe('DTSTART:20260921T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO')
    expect(show(completeReminder(moved, at(2026, 9, 21, 11)).dueAt)).toBe(show(at(2026, 9, 28, 10)))
  })

  it('sets and clears the repeat pattern', () => {
    const repeating = updateReminder(oneOff(), { recurrence: { freq: 'daily' } }, NOW)
    expect(repeating.rrule).toBe('DTSTART:20260918T180000\nRRULE:FREQ=DAILY')
    expect('rrule' in updateReminder(repeating, { recurrence: null }, NOW)).toBe(false)
  })

  it('un-snoozes when the due time changes, but not for other edits', () => {
    const snoozed = snoozeReminder(oneOff(), NOW + HOUR, NOW)
    expect(updateReminder(snoozed, { title: 'Renamed' }, NOW)).toMatchObject({ status: 'snoozed', title: 'Renamed' })
    const moved = updateReminder(snoozed, { dueAt: at(2026, 9, 19, 9) }, NOW)
    expect(moved.status).toBe('pending')
    expect('snoozedUntil' in moved).toBe(false)
  })

  it('clears optional fields with null', () => {
    const r = oneOff({ alertOffsets: [60], courseId: 'c1' })
    const cleared = updateReminder(r, { alertOffsets: null, courseId: null }, NOW)
    expect('alertOffsets' in cleared).toBe(false)
    expect('courseId' in cleared).toBe(false)
  })
})

describe('derived states', () => {
  it('treats all-day reminders as due until the end of the day', () => {
    const r = oneOff({ dueAt: at(2026, 9, 14, 9), allDay: true })
    expect(deadlineOf(r)).toBe(at(2026, 9, 15))
    expect(isOverdue(r, at(2026, 9, 14, 23, 59))).toBe(false)
    expect(isOverdue(r, at(2026, 9, 15))).toBe(true)
  })

  it('calls a one-off reminder missed after a day overdue', () => {
    const r = oneOff({ dueAt: at(2026, 9, 14, 9) })
    expect(isMissed(r, at(2026, 9, 15, 8))).toBe(false)
    expect(isMissed(r, at(2026, 9, 15, 9))).toBe(true)
    expect(isMissed(completeReminder(r, NOW), at(2026, 9, 20))).toBe(false)
    expect(isMissed(snoozeReminder(r, at(2026, 9, 21), NOW), at(2026, 9, 20))).toBe(false)
  })

  it('never calls a recurring reminder missed', () => {
    expect(isMissed(everyMonday9(), at(2026, 9, 30))).toBe(false)
  })

  it('tombstones instead of deleting', () => {
    const dead: Reminder = deleteReminder(oneOff(), NOW + 5)
    expect(dead.deletedAt).toBe(NOW + 5)
    expect(isOverdue(dead, at(2027, 1, 1))).toBe(false)
  })
})
