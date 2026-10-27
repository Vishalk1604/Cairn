import { parseCapture } from './capture'
import type { ClassroomPost, MailMessage } from './mail'

/**
 * Classroom read from its own notification emails, for an account whose
 * college keeps the Classroom API from Cairn (or never granted it) but lets
 * Gmail through. The post becomes the same inbox record the API path makes,
 * only thinner: the email says less than the API does, and nothing tells
 * Cairn when work is handed in.
 *
 * It runs inside the Worker's 10 ms of CPU, so it is a handful of anchored
 * regular expressions over text Gmail already decoded, and nothing else.
 *
 * Only the English emails are recognised. Classroom writes these in the
 * reader's language, and the other languages' wording has not been checked
 * against real messages; an email in one is left as ordinary mail.
 */

export type ClassroomMailType = 'assignment' | 'quiz' | 'question' | 'announcement' | 'material'

export interface ClassroomMail {
  type: ClassroomMailType
  course: string
  title: string
  /** As written: "Oct 22, 11:59 PM", "tomorrow". */
  dueText?: string
  due?: { dueAt: number; allDay: boolean }
  /** The post in Classroom. */
  link?: string
  /** The API's own ids, read off the link, so the record is the one the API would make. */
  courseId?: string
  itemId?: string
}

const SENDER = /no-reply@classroom\.google\.com/i

/** New assignment: "Lab 4" · New quiz assignment: "Unit test" · New question: "…" · New announcement: "…" */
const SUBJECT = /^\s*new\s+(quiz\s+assignment|assignment|quiz|question|announcement|material)\s*:\s*(.*?)\s*$/i

/** "Prof. Rao posted a new assignment in CS301 DBMS" */
const POSTED = /^\s*(?:.{1,80}?\s+)?posted\s+(?:a\s+)?(?:new\s+)?(quiz\s+assignment|assignment|quiz|question|announcement|material)s?\s+in\s+(.{1,120}?)\s*$/im

/** A line of its own starting "Due": "Due Oct 22, 11:59 PM", "Due: tomorrow". Never "No due date". */
const DUE = /^\s*due\s*:?\s+(.{3,60}?)\s*$/im

/** classroom.google.com/c/<course>/<a|sa|mc|p|…>/<item>, possibly with /u/1/ and inside a google.com/url redirect. */
const LINK = /https:\/\/classroom\.google\.com\/(?:u\/\d+\/)?c\/([A-Za-z0-9_-]{4,64})(?:\/([a-z]{1,3})\/([A-Za-z0-9_-]{4,64}))?(?:\/details)?/

const QUOTED = /^["“”'‘’]+|["“”'‘’]+$/g

const TYPES: Record<string, ClassroomMailType> = {
  'quiz assignment': 'quiz',
  quiz: 'quiz',
  assignment: 'assignment',
  question: 'question',
  announcement: 'announcement',
  material: 'material',
}

export function isClassroomMail(from: string): boolean {
  return SENDER.test(from)
}

/**
 * Classroom's links carry each id as the base64 of its decimal digits:
 * /c/NjQ3MDk0NjE1MDk1 is course 647094615095 in the API. Anything else is
 * kept as it is, which still tells two posts apart.
 */
export function classroomLinkId(segment: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let bits = 0
  let value = 0
  let out = ''
  for (const ch of segment.replace(/=+$/, '')) {
    const index = ch === '-' || ch === '+' ? 62 : ch === '_' || ch === '/' ? 63 : alphabet.indexOf(ch)
    if (index < 0) return segment
    value = (value << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((value >> bits) & 0xff)
    }
  }
  return /^\d{4,30}$/.test(out) ? out : segment
}

/** The first link to a Classroom post, from plain text or HTML, unwrapping Google's redirect if it is in one. */
export function findClassroomLink(text: string): { link: string; courseId: string; itemId?: string } | undefined {
  const at = text.indexOf('classroom.google.com')
  if (at < 0) return undefined
  // Only around the first mention, unescaped, so a long body costs nothing more.
  const near = text
    .slice(Math.max(0, at - 40), at + 300)
    .replace(/%3A/gi, ':')
    .replace(/%2F/gi, '/')
    .replace(/&amp;/g, '&')
  const match = LINK.exec(near)
  if (!match) return undefined
  return { link: match[0], courseId: classroomLinkId(match[1]!), ...(match[3] ? { itemId: classroomLinkId(match[3]) } : {}) }
}

function tidyTitle(text: string): string {
  return text.replace(QUOTED, '').replace(/\s+/g, ' ').trim()
}

/** The date a "Due" line names, read the way typed capture reads one, relative to when the email came. */
function dueFrom(text: string, receivedAt: number): { dueAt: number; allDay: boolean } | undefined {
  // A stand-in title keeps the parser from taking the date itself for a name.
  const parsed = parseCapture(`it ${text.replace(/,/g, ' ')}`, receivedAt)
  return parsed.kind === 'reminder' && parsed.dueAt !== undefined ? { dueAt: parsed.dueAt, allDay: parsed.allDay } : undefined
}

/**
 * What a Classroom notification email says, or null when it is not one of
 * the posts the inbox shows (a grade, a comment, a reminder, another
 * language). Times come back on the clock `receivedAt` is on.
 */
export function parseClassroomMail(message: Pick<MailMessage, 'from' | 'subject' | 'snippet' | 'text' | 'receivedAt'>, html?: string): ClassroomMail | null {
  if (!isClassroomMail(message.from)) return null
  const body = message.text ?? message.snippet
  const subject = SUBJECT.exec(message.subject)
  const posted = POSTED.exec(body)
  const kind = (subject?.[1] ?? posted?.[1])?.toLowerCase().replace(/\s+/g, ' ')
  const type = kind ? TYPES[kind] : undefined
  if (!type) return null
  const course = posted?.[2]?.replace(/\s+/g, ' ').trim()
  if (!course) return null

  let title = subject ? tidyTitle(subject[2]!) : ''
  if (!title) {
    // No title in the subject (some announcements): the first line of the post itself.
    const after = body.slice((posted?.index ?? 0) + (posted?.[0].length ?? 0)).split('\n')
    title = tidyTitle(after.find((line) => line.trim() && !DUE.test(line)) ?? '') || 'Announcement'
  }
  if (title.length > 120) title = `${title.slice(0, 117)}…`

  const dueText = type === 'announcement' || type === 'material' ? undefined : DUE.exec(body)?.[1]
  const due = dueText ? dueFrom(dueText, message.receivedAt) : undefined
  const found = findClassroomLink(body) ?? (html ? findClassroomLink(html) : undefined)
  return {
    type,
    course,
    title,
    ...(dueText ? { dueText } : {}),
    ...(due ? { due } : {}),
    ...(found ? { link: found.link, courseId: found.courseId, ...(found.itemId ? { itemId: found.itemId } : {}) } : {}),
  }
}

/** The same course and title, however Classroom spaced or quoted them: how a post read from email is matched to the API's. */
export function classroomPostKey(course: string, title: string): string {
  const norm = (s: string) => tidyTitle(s).toLowerCase()
  return `${norm(course)}|${norm(title)}`
}

/**
 * The inbox message for a Classroom email: the same id, course and kind the
 * API would give the post when the link carries its ids, so the two paths
 * write one record. Materials are not shown, as the API path does not read
 * them either.
 */
export function classroomMailMessage(message: MailMessage, mail: ClassroomMail): MailMessage | null {
  if (mail.type === 'material') return null
  const work = mail.type !== 'announcement'
  const id = mail.itemId ? `classroom-${work ? 'work' : 'announcement'}-${mail.itemId}` : `classroom-email-${message.id}`
  const post: ClassroomPost = {
    kind: work ? 'work' : 'announcement',
    // Without a link there is no API id; the name keeps one course one colour.
    courseId: mail.courseId ?? `name:${mail.course.toLowerCase()}`,
    course: mail.course,
    ...(work && mail.itemId ? { workId: mail.itemId } : {}),
    ...(mail.due ? { due: mail.due } : {}),
    ...(mail.link ? { link: mail.link } : {}),
    fromEmail: true,
  }
  return {
    id,
    account: message.account,
    from: mail.course,
    subject: mail.title,
    snippet: message.snippet,
    receivedAt: message.receivedAt,
    ...(message.threadId ? { threadId: message.threadId } : {}),
    classroom: post,
  }
}
