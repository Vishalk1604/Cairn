import { describe, expect, it } from 'vitest'
import { clockTime, createReminder, digestKey, dueDigest, dueDigests, nextDigestAt, todayDigest, type InboxRecord } from '../src'
import { at, ctx } from './helpers'

const task = (title: string, dueAt: number, allDay = false) => createReminder({ title, dueAt, allDay }, { ...ctx, id: title })

describe('dueDigests', () => {
  it('sends each slot once, within two hours of its time', () => {
    expect(dueDigests(at(2026, 10, 27, 6, 50), new Set())).toEqual([])
    expect(dueDigests(at(2026, 10, 27, 7, 5), new Set())).toEqual(['morning'])
    expect(dueDigests(at(2026, 10, 27, 8, 10), new Set())).toEqual(['morning', 'today'])
    expect(dueDigests(at(2026, 10, 27, 8, 10), new Set([digestKey('morning', at(2026, 10, 27, 7))]))).toEqual(['today'])
    expect(dueDigests(at(2026, 10, 27, 20, 0), new Set())).toEqual(['evening'])
  })

  it('skips a slot missed by more than two hours', () => {
    expect(dueDigests(at(2026, 10, 27, 23, 0), new Set())).toEqual([])
    expect(dueDigests(at(2026, 10, 27, 10, 0), new Set())).toEqual([])
  })

  it('keys by local day', () => {
    expect(digestKey('evening', at(2026, 10, 27, 20))).toBe('evening:2026-10-27')
  })

  it('finds the next slot, tomorrow when today is over', () => {
    expect(nextDigestAt(at(2026, 10, 27, 7, 30))).toBe(at(2026, 10, 27, 8))
    expect(nextDigestAt(at(2026, 10, 27, 21))).toBe(at(2026, 10, 28, 7))
  })
})

describe('dueDigest', () => {
  const now = at(2026, 10, 27, 20, 0)

  it('lists tomorrow’s tasks the evening before', () => {
    const tasks = [task('Lab 4', at(2026, 10, 28, 23, 59)), task('Quiz', at(2026, 10, 28, 9), true), task('Later', at(2026, 10, 30, 9))]
    expect(dueDigest('evening', tasks, now)).toEqual({ title: '2 things due tomorrow', body: 'Quiz · Lab 4 at 11:59 pm' })
  })

  it('names the one task when there is only one, so a tap opens it', () => {
    expect(dueDigest('morning', [task('Lab 4', at(2026, 10, 27, 23, 59))], at(2026, 10, 27, 7))).toEqual({
      title: 'Due today',
      body: 'Lab 4 at 11:59 pm',
      reminderId: 'Lab 4',
    })
  })

  it('says nothing about done, deleted or far-off tasks', () => {
    const done = { ...task('Done', at(2026, 10, 28, 9)), status: 'done' as const }
    const gone = { ...task('Gone', at(2026, 10, 28, 9)), deletedAt: now }
    expect(dueDigest('evening', [done, gone, task('Far', at(2026, 11, 3, 9))], now)).toBeNull()
  })

  it('shortens a long list', () => {
    const tasks = ['A', 'B', 'C', 'D', 'E'].map((t, i) => task(t, at(2026, 10, 28, 9 + i), true))
    expect(dueDigest('evening', tasks, now)?.body).toBe('A · B · C · and 2 more')
  })
})

describe('todayDigest', () => {
  const now = at(2026, 10, 27, 8)
  const record = (over: Partial<InboxRecord>): InboxRecord => ({
    id: 'm',
    account: 'me@x.com',
    from: 'a@b.com',
    subject: 's',
    snippet: '',
    receivedAt: now - 3600_000,
    reading: { kind: 'other', title: 's', allDay: false },
    foundAt: now - 3600_000,
    updatedAt: now,
    ...over,
  })

  it('sums up the day', () => {
    const tasks = [task('Lab 4', at(2026, 10, 27, 23, 59)), task('Old', at(2026, 10, 25, 9))]
    const records = [
      record({ id: 'w', classroom: { kind: 'work', courseId: 'c', course: 'DBMS' } }),
      record({ id: 'i', triage: { important: true, summary: 'x' } }),
      record({ id: 'n', triage: { important: false, summary: 'x' } }),
      record({ id: 'r', triage: { important: true, summary: 'x' }, read: true }),
    ]
    expect(todayDigest(tasks, records, now)).toEqual({
      title: 'Today',
      body: '1 due today · 1 overdue · 1 new in Classroom · 1 important email\nLab 4 at 11:59 pm',
    })
  })

  it('stays quiet on a quiet day', () => {
    expect(todayDigest([], [record({ foundAt: now - 3 * 86_400_000 })], now)).toBeNull()
  })
})

describe('clockTime', () => {
  it('reads the local clock', () => {
    expect(clockTime(at(2026, 10, 27, 0, 5))).toBe('12:05 am')
    expect(clockTime(at(2026, 10, 27, 12, 0))).toBe('12:00 pm')
    expect(clockTime(at(2026, 10, 27, 18, 30))).toBe('6:30 pm')
  })
})
