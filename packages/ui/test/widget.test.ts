import { createReminder, DAY, HOUR, MINUTE, type InboxRecord, type Reminder } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { courseColor, readWidgetLink, URGENCY, unseenCounts, WIDGET_LINKS, widgetData, widgetRowsFor } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
/** Wednesday 14 October 2026, 10:00. */
const NOW = at(2026, 10, 14, 10)
const task = (title: string, dueAt: number, extra: Partial<Reminder> = {}): Reminder => ({ ...createReminder({ title, dueAt }, { userId: 'u', now: NOW - DAY, id: title }), ...extra })

describe('the home-screen widget', () => {
  const tasks = [
    task('Later today', NOW + 5 * HOUR),
    task('Next week', NOW + 6 * DAY),
    task('Late lab', NOW - 2 * HOUR),
    task('Quiz soon', NOW + 30 * MINUTE),
    task('Done', NOW + HOUR, { status: 'done' }),
    task('Binned', NOW + HOUR, { deletedAt: NOW - HOUR }),
    task('Lab 4', at(2026, 10, 14, 18), { courseId: 'c1' }),
  ]

  it('shows what is late, due soon and due today, in the Tasks tab\'s order', () => {
    const data = widgetData(tasks, NOW, { limit: 3 })
    expect(data.rows.map((r) => r.title)).toEqual(['Late lab', 'Quiz soon', 'Later today'])
    expect(data.more).toBe(1)
    expect(data.empty).toBeUndefined()
  })

  it('gives every row a symbol and label as well as a colour', () => {
    const [late, soon] = widgetData(tasks, NOW, { limit: 5 }).rows
    expect(late).toMatchObject({ urgency: 'overdue', color: URGENCY.overdue.color, symbol: '!', label: 'Overdue' })
    expect(soon).toMatchObject({ urgency: 'soon', symbol: '▲', label: 'Due soon' })
  })

  it('carries the class colour of coursework, in the theme showing', () => {
    const rows = widgetData(tasks, NOW, { limit: 5, courseColors: { c1: 'pink' }, scheme: 'light' }).rows
    expect(rows.find((r) => r.id === 'Lab 4')?.course).toBe(courseColor('c1', { c1: 'pink' }, 'light'))
    expect(rows.find((r) => r.id === 'Late lab')?.course).toBeUndefined()
  })

  it('says when nothing is due today, and what is next', () => {
    const data = widgetData([task('Next week', NOW + 6 * DAY)], NOW, { limit: 3, locale: 'en-US' })
    expect(data.rows).toEqual([])
    expect(data.empty).toMatch(/^Nothing due today\. Next: Next week, /)
    expect(widgetData([], NOW, { limit: 3 }).empty).toBe('Nothing due today.')
  })

  it('knows when to draw itself again', () => {
    // "Quiz soon" turns overdue at 10:30.
    expect(widgetData(tasks, NOW, { limit: 3 }).nextChangeAt).toBe(NOW + 30 * MINUTE)
  })

  it('fits three rows on the smallest size and more as it grows', () => {
    expect(widgetRowsFor(110)).toBe(3)
    expect(widgetRowsFor(250)).toBe(4)
    expect(widgetRowsFor(400)).toBe(7)
    expect(widgetRowsFor(2000)).toBe(8)
  })
})

describe('the widget\'s counts', () => {
  const rec = (id: string, over: Partial<InboxRecord>): InboxRecord => ({
    id,
    account: 'me@college.edu',
    from: 'a@b.com',
    subject: id,
    snippet: '',
    receivedAt: NOW,
    reading: { kind: 'other', title: id, allDay: false },
    foundAt: NOW,
    updatedAt: NOW,
    ...over,
  })

  it('count new Classroom posts and important mail since each tab was opened, as the badges do', () => {
    const records = [
      rec('post', { classroom: { kind: 'work', courseId: 'c', course: 'DBMS' } }),
      rec('old-post', { classroom: { kind: 'work', courseId: 'c', course: 'DBMS' }, foundAt: NOW - DAY }),
      rec('handed-in', { classroom: { kind: 'work', courseId: 'c', course: 'DBMS', submitted: true } }),
      rec('important', { triage: { important: true, summary: '' } }),
      rec('newsletter', { triage: { important: false, summary: '' } }),
      rec('ruled-in', { from: 'Dean <dean@college.edu>' }),
      rec('read', { triage: { important: true, summary: '' }, read: true }),
      rec('hidden', { triage: { important: true, summary: '' }, dismissed: true }),
    ]
    expect(unseenCounts({ records, seenAt: NOW - HOUR, seenClassroomAt: NOW - HOUR, senders: { 'dean@college.edu': 'important' } })).toEqual({ mail: 2, classroom: 1 })
  })
})

describe('the widget\'s links', () => {
  it('open a task, quick capture or a tab', () => {
    expect(readWidgetLink(WIDGET_LINKS.task('classroom-w 1/2'))).toEqual({ kind: 'task', id: 'classroom-w 1/2' })
    expect(readWidgetLink(WIDGET_LINKS.capture)).toEqual({ kind: 'capture' })
    expect(readWidgetLink(WIDGET_LINKS.classroom)).toEqual({ kind: 'section', section: 'classroom' })
  })

  it('leave every other link alone, sign-in redirects included', () => {
    expect(readWidgetLink('cairn://auth?code=abc&state=x')).toBeNull()
    expect(readWidgetLink('io.github.vishalk1604.cairn:/oauth2redirect?code=1')).toBeNull()
    expect(readWidgetLink('cairn://task/')).toBeNull()
    expect(readWidgetLink(null)).toBeNull()
  })
})
