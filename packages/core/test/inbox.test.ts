import { describe, expect, it } from 'vitest'
import {
  accountChips,
  accountsIn,
  classroomTaskId,
  createReminder,
  dueOf,
  inboxFolders,
  inboxOverflow,
  inboxWrites,
  isImportant,
  mailTaskId,
  mergeInbox,
  planAutoTasks,
  readMail,
  recordOf,
  SNIPPET_LIMIT,
  taskFromInbox,
  toAnnounce,
  type InboxRecord,
  type MailMessage,
} from '../src'
import { at, NOW } from './helpers'

const email: MailMessage = {
  id: 'm1',
  account: 'me@gmail.com',
  from: 'Devfolio <hello@devfolio.co>',
  subject: 'HackMIT registrations close Friday',
  snippet: 'Register before Friday. '.repeat(30),
  text: 'The whole body, which must never be stored.',
  receivedAt: NOW - 60_000,
  threadId: 't1',
}

const record = (extra: Partial<InboxRecord> = {}, message: MailMessage = email): InboxRecord => ({
  ...recordOf(message, readMail(message, NOW), NOW),
  ...extra,
})

const work = (id: string, extra: Partial<InboxRecord['classroom']> = {}): InboxRecord =>
  record({}, {
    id: `classroom-work-${id}`,
    account: 'me@uni.edu',
    from: 'CS301',
    subject: `Lab ${id}`,
    snippet: '',
    receivedAt: NOW,
    classroom: { kind: 'work', courseId: 'c1', course: 'CS301', workId: id, due: { dueAt: at(2026, 9, 18, 23, 59), allDay: false }, ...extra },
  })

const announcement = (id: string, extra: Partial<InboxRecord> = {}): InboxRecord => ({
  ...record({}, {
    id: `classroom-announcement-${id}`,
    account: 'me@uni.edu',
    from: 'CS301',
    subject: 'Quiz moved',
    snippet: 'The quiz is now on Thursday',
    receivedAt: NOW,
    classroom: { kind: 'announcement', courseId: 'c1', course: 'CS301' },
  }),
  ...extra,
})

describe('recordOf', () => {
  it('keeps no body and only a short preview', () => {
    const r = recordOf(email, readMail(email, NOW), NOW)
    expect(r).not.toHaveProperty('text')
    expect(JSON.stringify(r)).not.toContain('must never be stored')
    expect(r.snippet.length).toBeLessThanOrEqual(SNIPPET_LIMIT)
    expect(r.reading).not.toHaveProperty('confident')
  })

  it('leaves no undefined anywhere, which Firestore would refuse', () => {
    const r = work('w1', { link: undefined })
    const hasUndefined = (v: unknown): boolean =>
      v === undefined || (v !== null && typeof v === 'object' && Object.values(v).some(hasUndefined))
    expect(hasUndefined(r)).toBe(false)
  })
})

describe('mergeInbox', () => {
  it('dedupes by message id, newest first', () => {
    const a = record()
    const b = record({ id: 'm2', receivedAt: NOW })
    const merged = mergeInbox([a], [a, b, { ...a }])
    expect(merged.map((r) => r.id)).toEqual(['m2', 'm1'])
  })

  it('never undoes what the person did, or loses a reading', () => {
    const read = record({ read: true, dismissed: true, foundAt: NOW - 5000, triage: { important: true, summary: 'Register' } })
    const again = record({ foundAt: NOW, sorting: true })
    const [merged] = mergeInbox([read], [again])
    expect(merged!.read).toBe(true)
    expect(merged!.dismissed).toBe(true)
    expect(merged!.foundAt).toBe(NOW - 5000)
    expect(merged!.triage?.summary).toBe('Register')
    expect(merged!.sorting).toBeUndefined()
  })
})

describe('inboxWrites', () => {
  it('writes nothing for mail another device already stored the same way', () => {
    const stored = record({ triage: { important: true, summary: 'Register' } })
    expect(inboxWrites([stored], [record({ foundAt: NOW + 10 })])).toEqual([])
  })

  it('writes new mail once, and stored mail again only when its reading changed', () => {
    const waiting = record({ sorting: true })
    const fresh = record({ id: 'm2' })
    const sorted = record({ triage: { important: false, summary: 'Newsletter' } })
    const writes = inboxWrites([waiting], [fresh, sorted, fresh])
    expect(writes.map((r) => r.id)).toEqual(['m2', 'm1'])
    expect(writes[1]!.triage?.summary).toBe('Newsletter')
    expect(writes[1]!.sorting).toBeUndefined()
  })
})

describe('isImportant', () => {
  it('takes the sender rule over the model, and the model over the rules', () => {
    const r = record({ triage: { important: false, summary: 's' } })
    expect(isImportant(r)).toBe(false)
    expect(isImportant(r, { 'hello@devfolio.co': 'important' })).toBe(true)
    expect(isImportant(record({ triage: undefined, reading: { kind: 'deadline', title: 't', allDay: false } }))).toBe(true)
  })
})

describe('dueOf', () => {
  it('lets Classroom’s own due date win over the model’s', () => {
    const r = { ...work('w1'), triage: { important: true, summary: 's', task: { title: 'Do lab', dueAt: NOW, allDay: true } } }
    expect(dueOf(r)).toEqual({ title: 'Do lab', dueAt: at(2026, 9, 18, 23, 59), allDay: false })
  })
})

describe('inboxFolders', () => {
  it('lists folders in the order they first appeared', () => {
    const rs = [record({ id: 'a', foundAt: 3, triage: { important: true, summary: 's', folder: 'Jobs' } }), record({ id: 'b', foundAt: 1, triage: { important: true, summary: 's', folder: 'Hackathons' } })]
    expect(inboxFolders(rs)).toEqual(['Hackathons', 'Jobs'])
  })
})

describe('accountChips', () => {
  it('offers All only when there is more than one account', () => {
    expect(accountChips(['me@gmail.com'])).toEqual({ all: false, accounts: ['me@gmail.com'] })
    expect(accountChips(['me@gmail.com', 'me@uni.edu', 'me@gmail.com'])).toEqual({ all: true, accounts: ['me@gmail.com', 'me@uni.edu'] })
  })

  it('takes accounts from the records too, after the connected ones', () => {
    expect(accountsIn([record(), work('w1')], ['me@uni.edu'])).toEqual(['me@uni.edu', 'me@gmail.com'])
  })
})

describe('inboxOverflow', () => {
  it('deletes the oldest past the limit, in batches', () => {
    const rs = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, receivedAt: i }))
    expect(inboxOverflow(rs, 20, 15)).toEqual([])
    expect(inboxOverflow(rs, 20, 5)).toEqual(['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2', 'r1', 'r0'])
  })
})

describe('toAnnounce', () => {
  const base = { since: NOW - 1000, announced: new Set<string>(), now: NOW }

  it('announces new important mail found by any device, once', () => {
    const important = record({ triage: { important: true, summary: 's' } })
    expect(toAnnounce([important], base)).toHaveLength(1)
    expect(toAnnounce([important], { ...base, announced: new Set(['m1']) })).toHaveLength(0)
    expect(toAnnounce([important], { ...base, since: NOW })).toHaveLength(0)
    expect(toAnnounce([{ ...important, read: true }], base)).toHaveLength(0)
  })

  it('waits a little for the model before announcing', () => {
    const waiting = record({ sorting: true, reading: { kind: 'deadline', title: 't', allDay: false } })
    expect(toAnnounce([waiting], base)).toHaveLength(0)
    expect(toAnnounce([waiting], { ...base, now: NOW + 11 * 60_000 })).toHaveLength(1)
  })
})

describe('planAutoTasks', () => {
  it('does nothing while switched off', () => {
    expect(planAutoTasks([work('w1')], new Set(), false, NOW)).toEqual([])
  })

  it('takes coursework and announcements, never twice and never one handed in', () => {
    const posts = [work('w1'), work('w1'), work('w2', { submitted: true }), announcement('a1'), record()]
    expect(planAutoTasks(posts, new Set(), true, NOW).map((r) => r.id)).toEqual(['classroom-work-w1', 'classroom-announcement-a1'])
  })

  it('skips posts already turned into tasks on any device, even if since deleted', () => {
    const posts = [work('w1'), work('w2'), work('w3', {}), announcement('a1', { tasked: true })]
    posts[2] = { ...posts[2]!, dismissed: true }
    const known = new Set([classroomTaskId('w1')])
    expect(planAutoTasks(posts, known, true, NOW).map((r) => r.id)).toEqual(['classroom-work-w2'])
  })

  it('waits for the model to read an announcement, so its date is known', () => {
    expect(planAutoTasks([announcement('a1', { sorting: true })], new Set(), true, NOW)).toEqual([])
  })

  it('leaves work already past due and announcements over a week old', () => {
    const late = work('w1', { due: { dueAt: NOW - 1, allDay: false } })
    const old = announcement('a1', { foundAt: NOW - 8 * 86_400_000 })
    expect(planAutoTasks([late, old, work('w2', { due: undefined })], new Set(), true, NOW).map((r) => r.id)).toEqual(['classroom-work-w2'])
  })
})

describe('taskFromInbox', () => {
  it('makes coursework a task that completes on hand-in, at Classroom’s due date', () => {
    const { id, input } = taskFromInbox(work('w1'), { now: NOW, important: true, automatic: true })
    expect(id).toBe(classroomTaskId('w1'))
    expect(input.dueAt).toBe(at(2026, 9, 18, 23, 59))
    expect(input.autoCompleteOn).toBe('classroom-submission')
    expect(input.priority).toBe('high')
  })

  it('files an undated announcement on its day, silently, when made automatically', () => {
    const { id, input } = taskFromInbox(announcement('a1'), { now: NOW, important: false, automatic: true })
    expect(id).toBe(mailTaskId({ id: 'classroom-announcement-a1' }))
    expect(input.dueAt).toBe(at(2026, 9, 14, 9))
    expect(input.alertOffsets).toEqual([])
    expect(createReminder(input, { userId: 'u', now: NOW, id }).alertOffsets).toEqual([])
  })

  it('uses the date the model found in an announcement', () => {
    const due = at(2026, 9, 17, 10)
    const r = announcement('a1', { triage: { important: true, summary: 's', task: { title: 'Take quiz', dueAt: due, allDay: false } } })
    const { input } = taskFromInbox(r, { now: NOW, important: true, automatic: true })
    expect(input.title).toBe('Take quiz')
    expect(input.dueAt).toBe(due)
    expect(input.alertOffsets).toBeUndefined()
  })
})
