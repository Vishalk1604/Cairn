import { describe, expect, it } from 'vitest'
import {
  classroomLinkId,
  classroomMailMessage,
  classroomPostKey,
  findClassroomLink,
  parseClassroomMail,
  recordOf,
  readMail,
  taskFromInbox,
  type MailMessage,
} from '../src'
import * as fixtures from './fixtures/classroomMail'
import { at, NOW, show } from './helpers'

/** Each fixture as the Worker would hand it over: arrived at NOW, Monday 14 September 2026. */
const message = (f: fixtures.Fixture, id = 'gmail-1'): MailMessage => ({ id, account: 'me@college.edu', from: f.from, subject: f.subject, snippet: f.snippet, text: f.text, receivedAt: NOW, threadId: 't1' })
const parse = (f: fixtures.Fixture) => parseClassroomMail(message(f), f.html)

describe('Classroom notification emails', () => {
  it('reads a new assignment: course, title, due date and the API ids from its link', () => {
    const mail = parse(fixtures.assignment)!
    expect(mail).toMatchObject({
      type: 'assignment',
      course: 'CS301 DBMS',
      title: 'DBMS Lab 4: Normalisation',
      dueText: 'Oct 22, 11:59 PM',
      link: 'https://classroom.google.com/c/NjQ3MDk0NjE1MDk1/a/NjQ3MDk2MzQ1OTkz/details',
      courseId: '647094615095',
      itemId: '647096345993',
    })
    expect(show(mail.due?.dueAt)).toBe(show(at(2026, 10, 22, 23, 59)))
    expect(mail.due?.allDay).toBe(false)
  })

  it('takes a due date without a time as due on that day, and finds the link in the HTML redirect', () => {
    const mail = parse(fixtures.quiz)!
    expect(mail).toMatchObject({ type: 'quiz', course: 'CS302 Computer Networks', title: 'Unit 2 quiz', courseId: '647102345678', itemId: '647105555555' })
    expect(mail.due?.allDay).toBe(true)
    expect(show(mail.due?.dueAt).slice(0, 15)).toBe(show(at(2026, 10, 24)).slice(0, 15))
  })

  it('reads questions, with a relative due date', () => {
    const mail = parse(fixtures.question)!
    expect(mail).toMatchObject({ type: 'question', course: 'CS301 DBMS', itemId: '647123456789' })
    expect(show(mail.due?.dueAt)).toBe(show(at(2026, 9, 15, 9)))
  })

  it('reads announcements, which have no due date', () => {
    expect(parse(fixtures.announcement)).toMatchObject({ type: 'announcement', course: 'CS302 Computer Networks', title: 'Quiz moved to Thursday', itemId: '647133333333' })
    expect(parse(fixtures.announcement)?.due).toBeUndefined()
  })

  it('takes an announcement\'s title from its first line when the subject has none', () => {
    expect(parse(fixtures.bareAnnouncement)).toEqual({ type: 'announcement', course: 'Physics Lab', title: 'Bring your lab coats on Monday.' })
  })

  it('leaves grades, other senders and anything it does not recognise alone', () => {
    expect(parse(fixtures.returned)).toBeNull()
    expect(parse(fixtures.lookalike)).toBeNull()
    expect(parseClassroomMail({ ...message(fixtures.assignment), subject: 'Nueva tarea: "Lab 4"', text: 'Prof. Rao publicó una tarea nueva en CS301' })).toBeNull()
  })

  it('decodes the ids in Classroom links, and keeps any it cannot read', () => {
    expect(classroomLinkId('NjQ3MDk0NjE1MDk1')).toBe('647094615095')
    expect(classroomLinkId('abc_def-ghi')).toBe('abc_def-ghi')
    expect(findClassroomLink('nothing here')).toBeUndefined()
  })
})

describe('the inbox record from a Classroom email', () => {
  it('is the record the API would write, so the two paths meet on one id', () => {
    const m = classroomMailMessage(message(fixtures.assignment), parse(fixtures.assignment)!)!
    expect(m.id).toBe('classroom-work-647096345993')
    expect(m.classroom).toMatchObject({ kind: 'work', courseId: '647094615095', course: 'CS301 DBMS', workId: '647096345993', fromEmail: true })
    const announcement = classroomMailMessage(message(fixtures.announcement), parse(fixtures.announcement)!)!
    expect(announcement.id).toBe('classroom-announcement-647133333333')
    expect(announcement.classroom?.kind).toBe('announcement')
  })

  it('falls back on the email\'s own id, and the course\'s name for its colour, without a link', () => {
    const m = classroomMailMessage(message(fixtures.bareAnnouncement, 'g9'), parse(fixtures.bareAnnouncement)!)!
    expect(m.id).toBe('classroom-email-g9')
    expect(m.classroom?.courseId).toBe('name:physics lab')
  })

  it('shows no materials, as the API path does not read them either', () => {
    expect(classroomMailMessage(message(fixtures.material), parse(fixtures.material)!)).toBeNull()
  })

  it('makes a task at Classroom\'s due date, filed under the course', () => {
    const m = classroomMailMessage(message(fixtures.assignment), parse(fixtures.assignment)!)!
    const record = recordOf(m, readMail(m, NOW), NOW)
    const { id, input } = taskFromInbox(record, { now: NOW, important: true, automatic: true })
    expect(id).toBe('classroom-647096345993')
    expect(input).toMatchObject({ title: 'DBMS Lab 4: Normalisation', courseId: '647094615095', source: 'classroom', allDay: false })
    expect(show(input.dueAt)).toBe(show(at(2026, 10, 22, 23, 59)))
  })

  it('matches an API post by course and title, however they were spaced or quoted', () => {
    expect(classroomPostKey(' CS301  DBMS', '“DBMS Lab 4: Normalisation”')).toBe(classroomPostKey('CS301 DBMS', 'DBMS Lab 4: Normalisation'))
    expect(classroomPostKey('CS301 DBMS', 'Lab 4')).not.toBe(classroomPostKey('CS302', 'Lab 4'))
  })
})
