import { describe, expect, it } from 'vitest'
import { classroomDueAt, readMail, type MailMessage } from '../src'
import { at, NOW, show } from './helpers'

const mail = (subject: string, text: string, from = 'someone@uni.edu'): MailMessage => ({
  id: 'm1',
  account: 'me@uni.edu',
  from,
  subject,
  snippet: text.slice(0, 100),
  text,
  receivedAt: NOW,
})

describe('readMail: Classroom notifications', () => {
  const classroom = 'Prof. Rao (Classroom) <no-reply@classroom.google.com>'

  it('reads the title, course and due date of a new assignment', () => {
    const reading = readMail(
      mail('New assignment: "DBMS Lab 4"', 'Prof. Rao posted a new assignment in CS301 DBMS\nDBMS Lab 4\nDue Sep 18, 11:59 PM\nOpen', classroom),
      NOW,
    )
    expect(reading).toMatchObject({ kind: 'classroom', title: 'DBMS Lab 4', course: 'CS301 DBMS', confident: true })
    expect(show(reading.dueAt)).toBe(show(at(2026, 9, 18, 23, 59)))
  })

  it('does not make a task of course material', () => {
    const reading = readMail(mail('New material: "Week 3 slides"', 'Prof. Rao posted new material in CS301', classroom), NOW)
    expect(reading.kind).toBe('other')
    expect(reading.confident).toBe(false)
  })

  it('is not confident about an assignment with no due date', () => {
    expect(readMail(mail('New assignment: "Reading"', 'posted a new assignment in CS301', classroom), NOW).confident).toBe(false)
  })
})

describe('readMail: ordinary email', () => {
  it('offers a deadline with a date as a suggestion, never automatically', () => {
    const reading = readMail(mail('Project report submission', 'Please submit the final report. Due date: Friday 5pm.'), NOW)
    expect(reading).toMatchObject({ kind: 'deadline', confident: false })
    expect(show(reading.dueAt)).toBe(show(at(2026, 9, 18, 17)))
  })

  it('ignores a date that has nothing to do with a deadline', () => {
    expect(readMail(mail('Lunch on Friday?', 'Shall we get lunch on Friday?'), NOW).kind).toBe('other')
  })

  it('ignores a deadline already well past', () => {
    expect(readMail(mail('Registration closes', 'Registration closed on 1 September.'), NOW).kind).toBe('other')
  })

  it('strips reply prefixes from the title', () => {
    expect(readMail(mail('Re: Fwd: Assignment 2 due tomorrow', ''), NOW).title).toBe('Assignment 2 due tomorrow')
  })
})

describe('classroomDueAt', () => {
  it('reads a UTC date and time as an instant', () => {
    expect(classroomDueAt({ dueDate: { year: 2026, month: 10, day: 22 }, dueTime: { hours: 18, minutes: 29 } })).toEqual({
      dueAt: Date.UTC(2026, 9, 22, 18, 29),
      allDay: false,
    })
  })

  it('treats a date with no time as due on that day', () => {
    const due = classroomDueAt({ dueDate: { year: 2026, month: 10, day: 22 } })
    expect(due?.allDay).toBe(true)
    expect(show(due?.dueAt)).toBe(show(at(2026, 10, 22, 9)))
  })

  it('has nothing to say about undated work', () => {
    expect(classroomDueAt({})).toBeNull()
  })
})
