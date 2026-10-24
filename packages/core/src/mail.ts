import { parseCapture, type CaptureOptions } from './capture'
import { DAY } from './time'

/**
 * One email, reduced to what Cairn reads. A Classroom post — new coursework
 * or an announcement — takes the same shape, so it is read, sorted and
 * offered as a task the same way.
 */
export interface MailMessage {
  id: string
  /** Which linked account it arrived in. */
  account: string
  from: string
  subject: string
  snippet: string
  /** The plain-text body, when it was fetched. */
  text?: string
  receivedAt: number
  /** Gmail's conversation id: what a link into Gmail opens. */
  threadId?: string
  /** Set when this is a Classroom post rather than an email. */
  classroom?: ClassroomPost
}

export interface ClassroomPost {
  kind: 'work' | 'announcement'
  courseId: string
  course: string
  /** The coursework, for work. A task made from it follows the teacher's changes and completes on hand-in. */
  workId?: string
  /** Classroom's own due date, exact, for work that has one. */
  due?: { dueAt: number; allDay: boolean }
  /** The post in Classroom. */
  link?: string
}

export type MailKind = 'classroom' | 'deadline' | 'other'

export interface MailReading {
  kind: MailKind
  /** What the task would be called. */
  title: string
  dueAt?: number
  allDay: boolean
  course?: string
  /**
   * Sure enough to add without asking. Only Classroom's own notifications
   * qualify: a date in an ordinary email is a suggestion, because "the
   * meeting moved from Friday" mentions Friday without anything being due.
   */
  confident: boolean
}

const CLASSROOM_SENDER = /classroom\.google\.com/i

/** Words that make a date in an email worth offering as a task. */
const DEADLINE = /\b(due|deadline|submit|submission|last date|exam|test|quiz|assignment|viva|presentation|register|registration|closes?|ends?)\b/i

/** "Due Oct 22, 11:59 PM", "Due: tomorrow", "Due date: 22 October". */
const DUE_LINE = /\bdue(?:\s+date)?\s*[:-]?\s*([^\n]{3,60})/i

/** Classroom subjects put the title in quotes: New assignment: "Lab 4". */
const QUOTED = /["“”']([^"“”']{2,120})["“”']/

/** "… posted a new assignment in CS301 DBMS" */
const COURSE = /posted (?:a new )?(?:assignment|question|material|announcement)s? in ([^\n]+?)(?:\n|$)/i

function tidy(subject: string): string {
  return subject.replace(/^(?:(?:re|fwd?|fw)\s*:\s*)+/i, '').replace(/\s+/g, ' ').trim()
}

/** The date a phrase names, if any, read with the same parser as typed capture. */
function dateIn(phrase: string, now: number, options?: CaptureOptions): { dueAt: number; allDay: boolean } | null {
  // A stand-in title keeps the parser from treating the whole phrase as a name.
  const parsed = parseCapture(`it ${phrase}`, now, options)
  if (parsed.kind !== 'reminder' || parsed.dueAt === undefined) return null
  return { dueAt: parsed.dueAt, allDay: parsed.allDay }
}

/**
 * Decides whether an email is about something due, and when.
 *
 * Deterministic on purpose: every rule here can be read and tested, and a
 * wrong guess can be traced to the line that made it.
 */
export function readMail(message: MailMessage, now: number, options?: CaptureOptions): MailReading {
  const subject = tidy(message.subject)
  const body = message.text ?? message.snippet

  // Coursework read from Classroom itself: its due date is exact, but
  // whether it becomes a task is still the person's tap.
  const post = message.classroom
  if (post?.kind === 'work') {
    return { kind: 'classroom', title: subject, course: post.course, dueAt: post.due?.dueAt, allDay: post.due?.allDay ?? false, confident: false }
  }

  if (CLASSROOM_SENDER.test(message.from)) {
    const title = QUOTED.exec(subject)?.[1]?.trim() ?? subject.replace(/^[^:]{0,40}:\s*/, '')
    const course = COURSE.exec(body)?.[1]?.trim()
    const dueText = DUE_LINE.exec(body)?.[1] ?? DUE_LINE.exec(subject)?.[1]
    const due = dueText ? dateIn(dueText, message.receivedAt, options) : null
    const isWork = /assignment|question|due/i.test(subject)
    return {
      kind: isWork ? 'classroom' : 'other',
      title,
      course,
      dueAt: due?.dueAt,
      allDay: due?.allDay ?? false,
      confident: isWork && due !== null,
    }
  }

  const haystack = `${subject}\n${body}`
  if (DEADLINE.test(haystack)) {
    const dueText = DUE_LINE.exec(haystack)?.[1]
    const due = (dueText ? dateIn(dueText, message.receivedAt, options) : null) ?? dateIn(subject, message.receivedAt, options)
    // A date long past at the time of reading is history, not a deadline.
    if (due && due.dueAt > now - DAY) {
      return { kind: 'deadline', title: subject, dueAt: due.dueAt, allDay: due.allDay, confident: false }
    }
  }
  return { kind: 'other', title: subject, allDay: false, confident: false }
}

/** The reminder id for an email, so adding the same one twice merges instead of duplicating. */
export function mailTaskId(message: Pick<MailMessage, 'id'>): string {
  return `mail-${message.id}`
}

/**
 * The reminder id for anything in the inbox. Coursework keeps Classroom's
 * id, so its task follows a moved deadline and completes on hand-in.
 */
export function inboxTaskId(message: Pick<MailMessage, 'id' | 'classroom'>): string {
  return message.classroom?.workId ? classroomTaskId(message.classroom.workId) : mailTaskId(message)
}

/** Classroom's own representation of a due date: a UTC calendar date and optional UTC time. */
export interface ClassroomDue {
  dueDate?: { year: number; month: number; day: number }
  dueTime?: { hours?: number; minutes?: number }
}

/**
 * When a piece of coursework is due, in this device's clock. Classroom keeps
 * dates in UTC; with no time given, the work is due on that day, so it is an
 * all-day task anchored at the morning alert hour.
 */
export function classroomDueAt(work: ClassroomDue, alertHour = 9): { dueAt: number; allDay: boolean } | null {
  const date = work.dueDate
  if (!date) return null
  if (work.dueTime && (work.dueTime.hours !== undefined || work.dueTime.minutes !== undefined)) {
    return {
      dueAt: Date.UTC(date.year, date.month - 1, date.day, work.dueTime.hours ?? 0, work.dueTime.minutes ?? 0),
      allDay: false,
    }
  }
  return { dueAt: new Date(date.year, date.month - 1, date.day, alertHour).getTime(), allDay: true }
}

export function classroomTaskId(courseWorkId: string): string {
  return `classroom-${courseWorkId}`
}
