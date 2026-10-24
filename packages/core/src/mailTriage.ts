import type { MailMessage } from './mail'
import { DAY } from './time'

/**
 * What a language model made of one email or Classroom post: whether it
 * matters to this person, which inbox folder and tags it belongs under, and
 * whether it asks for something by a date or sets a time for something.
 *
 * The model only ever suggests. Everything it says is checked here before
 * Cairn shows it — a folder name is tidied and matched against the ones that
 * exist, a date is parsed strictly and dropped if it is already history — so
 * a confused reply costs one badly sorted email, never a broken inbox.
 */
export interface MailTriage {
  important: boolean
  /** The inbox folder it belongs in. Absent when no group fits. */
  folder?: string
  /**
   * Lower-case tags, kind first, then the particular name: hackathon, shi;
   * internship, google; assignment, cs301. They go on a task made from it.
   * Absent on mail read before Cairn asked for tags.
   */
  tags?: string[]
  /** One sentence on what it says. */
  summary: string
  /** Why it matters, in a few words. Only for important mail. */
  why?: string
  /** Something to do by a date, or an event at a set time, when it has one. */
  task?: { title: string; dueAt: number; allDay: boolean }
  /** Which model read it. */
  model?: string
}

export interface TriageContext {
  now: number
  /** Folders already in use, so the model reuses them rather than inventing near-twins. */
  folders: readonly string[]
  /** IANA name, so "Friday 6pm" is read against the person's own clock. */
  timeZone?: string
  /** In the person's own words, what matters to them. */
  profile?: string
}

/** What a student who has not said otherwise cares about. Shown in Settings, where it can be changed. */
export const DEFAULT_PROFILE =
  "I'm a student. Important to me: hackathons, internships, jobs and interviews, assignments and other coursework, exams, quizzes and results, scholarships, and anything from my college or teachers that needs me to act. Not important: promotions, newsletters, social media and shopping."

/** Long enough to say what matters; a profile is not a place for an essay. */
export const PROFILE_LIMIT = 600

/** Enough of any email to understand it; the rest is footers and quoted replies. */
export const TRIAGE_BODY_LIMIT = 6000

/** Past this, the model is told to reuse folders rather than add more. A dozen chips is already a lot. */
export const MAX_FOLDERS = 12

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = (n: number) => String(n).padStart(2, '0')

function localStamp(t: number): string {
  const d = new Date(t)
  return `${WEEKDAYS[d.getDay()]} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const SYSTEM = `You sort the incoming email and Google Classroom posts of a person who uses Cairn, a notes and tasks app. They tell you what matters to them; judge everything against that. Read the whole message, not just the subject, and decide:

important: true when this person would want to see it soon — something on their list of what matters; a deadline; an opportunity they can act on; anything from their college or a teacher that needs them to act; a reply from a real person; a security, account or payment notice that needs action. Classroom coursework is always important. false for newsletters with nothing to act on, marketing, social-media notifications, receipts that need nothing done, and anything on their list of what does not matter.

folder: a short plural group name, one or two words in Title Case, such as Hackathons, Internships, Jobs, Assignments, Exams, Classes, Events, Scholarships, Finance or Security. Reuse an existing folder when the message truly belongs there; make a new one when none fits — do not force it: a hackathon is not a job. null for one-off mail that fits no group.

tags: one to four lower-case tags without "#", each one word or hyphenated words. First what kind of thing it is (hackathon, internship, job, interview, assignment, exam, quiz, result, scholarship, event, meeting, registration, payment, announcement, newsletter, promotion), then the particular name when there is one: the hackathon, company, event or course, shortened the way people say it (shi for Smart India Hackathon, hackmit, google, cs301). [] when nothing fits.

summary: one plain sentence saying what it is about and what to do, including any key date.

why: up to six words on why it matters. null when not important.

task: when it asks the reader to do something by a date or time (register, apply, submit, pay, reply), or sets a time for something they would attend (an exam, interview, class, meeting, event, a hackathon starting), {"title": a short imperative of at most eight words, such as "Register for HackMIT" or "Attend Google interview", "due": when}. For a deadline, "due" is the last moment it can still be done: "by Friday" is that Friday at 23:59. For an event, it is the start. Write "due" in the reader's local time as exactly YYYY-MM-DDTHH:mm in 24-hour time, for example 2026-10-24T18:30, or exactly YYYY-MM-DD when no time is given. Work out words like "tomorrow", "this Friday" or "in two days" from Now. When Classroom gives a due date, use it. null when there is no date, or it has already passed. Never invent a date that is not in the message.

Reply with exactly one JSON object and nothing else:
{"important": true|false, "folder": string|null, "tags": [string], "summary": string, "why": string|null, "task": {"title": string, "due": string}|null}`

function dueStamp(due: { dueAt: number; allDay: boolean }): string {
  const d = new Date(due.dueAt)
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return due.allDay ? day : `${day}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The two messages to send the model for one email or Classroom post. */
export function triagePrompt(message: MailMessage, context: TriageContext): { system: string; user: string } {
  const folders = context.folders.length ? context.folders.join(', ') : 'none yet'
  const full = context.folders.length >= MAX_FOLDERS ? ' (that is plenty: use one of these, or null)' : ''
  const body = (message.text ?? message.snippet).replace(/\n{3,}/g, '\n\n').trim().slice(0, TRIAGE_BODY_LIMIT)
  const profile = (context.profile?.trim() || DEFAULT_PROFILE).replace(/\s+/g, ' ').slice(0, PROFILE_LIMIT)
  const post = message.classroom
  const source = post
    ? [
        `Source: Google Classroom, ${post.kind === 'work' ? 'new coursework' : 'an announcement'} in the course "${post.course}"`,
        ...(post.due ? [`Classroom due date: ${dueStamp(post.due)}`] : []),
        `Posted: ${localStamp(message.receivedAt)}`,
        `Title: ${message.subject}`,
      ]
    : ['Source: Gmail', `From: ${message.from}`, `Received: ${localStamp(message.receivedAt)}`, `Subject: ${message.subject}`]
  const user = [
    `What matters to me: ${profile}`,
    `Existing folders: ${folders}${full}`,
    `Now: ${localStamp(context.now)}${context.timeZone ? ` (${context.timeZone})` : ''}`,
    '',
    ...source,
    '',
    body || '(no text)',
  ].join('\n')
  return { system: SYSTEM, user }
}

/** Plural, case and spacing differences, so "hackathon" finds "Hackathons". */
function folderKey(name: string): string {
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '')
  // Classes → class, boxes → box, jobs → job; but class stays class.
  if (/(ss|x|z|ch|sh)es$/.test(key)) return key.slice(0, -2)
  if (/[^s]s$/.test(key)) return key.slice(0, -1)
  return key
}

const NOT_A_FOLDER = new Set(['', 'null', 'none', 'other', 'others', 'inbox', 'general', 'misc', 'miscellaneous', 'important', 'unknown', 'na'])

function titleCase(word: string): string {
  // Short capitals are acronyms (AI, GATE, IIT); longer ones are shouting.
  if (word.length <= 4 && word === word.toUpperCase()) return word
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

/**
 * The folder a suggested name means: an existing one when it is the same
 * name written differently, a tidied new one otherwise, and none when it
 * names nothing or there are already enough folders.
 */
export function canonicalFolder(name: unknown, existing: readonly string[]): string | undefined {
  if (typeof name !== 'string') return undefined
  const words = name
    // A plain range rather than \p{L}: not every engine Cairn runs on has Unicode property escapes.
    .replace(/[^A-Za-z0-9À-ɏ&+ -]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
  const tidy = words.map(titleCase).join(' ').slice(0, 24).trim()
  if (NOT_A_FOLDER.has(tidy.toLowerCase())) return undefined
  const key = folderKey(tidy)
  if (!key) return undefined
  const match = existing.find((f) => folderKey(f) === key)
  if (match) return match
  return existing.length >= MAX_FOLDERS ? undefined : tidy
}

/**
 * "2026-10-24", "2026-10-24T23:59", "2026-10-24 23:59:00+05:30". A date alone
 * is due that day, alerting at the morning hour; a time without a zone is the
 * person's own; a zone is honoured.
 */
export function parseDue(text: unknown, alertHour = 9): { dueAt: number; allDay: boolean } | null {
  if (typeof text !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text.trim())
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (m[4] === undefined) return { dueAt: new Date(year, month - 1, day, alertHour).getTime(), allDay: true }
  const [hour, minute] = [Number(m[4]), Number(m[5])]
  if (hour > 23 || minute > 59) return null
  const zone = m[7]
  if (!zone) return { dueAt: new Date(year, month - 1, day, hour, minute).getTime(), allDay: false }
  const utc = Date.UTC(year, month - 1, day, hour, minute)
  if (zone.toUpperCase() === 'Z') return { dueAt: utc, allDay: false }
  const z = /([+-])(\d{2}):?(\d{2})/.exec(zone)!
  const offset = (Number(z[2]) * 60 + Number(z[3])) * 60_000 * (z[1] === '-' ? -1 : 1)
  return { dueAt: utc - offset, allDay: false }
}

const NOT_A_TAG = new Set(['null', 'none', 'other', 'misc', 'general', 'important', 'email', 'mail', 'inbox'])

/** Up to four tags as Cairn writes them: lower-case, no "#", words joined by hyphens. */
export function canonicalTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const tags: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const tag = item
      .toLowerCase()
      .replace(/^#+/, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24)
    if (tag && !NOT_A_TAG.has(tag) && !tags.includes(tag)) tags.push(tag)
    if (tags.length === 4) break
  }
  return tags
}

function text(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean && clean.toLowerCase() !== 'null' ? clean.slice(0, limit) : undefined
}

/** The first JSON object in a reply, skipping any thinking or prose around it. */
function firstObject(reply: string): Record<string, unknown> | null {
  const visible = reply.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const start = visible.indexOf('{')
  const end = visible.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(visible.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Reads the model's reply. Null when there is nothing usable in it, so the
 * caller can fall back to the plain rules rather than show a guess.
 *
 * For Classroom coursework, Classroom's own due date wins over the model's
 * reading of it: it is exact, and in the right time zone by construction.
 */
export function readTriage(
  reply: string,
  context: Pick<TriageContext, 'now' | 'folders'>,
  message?: Pick<MailMessage, 'subject' | 'classroom'>,
): MailTriage | null {
  const raw = firstObject(reply)
  if (!raw) return null
  const classroomDue = message?.classroom?.due
  const important = raw.important === true || raw.important === 'true' || message?.classroom?.kind === 'work'
  const summary = text(raw.summary, 280)
  if (!summary) return null

  let task: MailTriage['task']
  const rawTask = raw.task as { title?: unknown; due?: unknown } | null | undefined
  const title = rawTask && typeof rawTask === 'object' ? text(rawTask.title, 120) : undefined
  const due = classroomDue ?? (rawTask && typeof rawTask === 'object' ? parseDue(rawTask.due) : null)
  // A deadline already past when the mail is read is history, and one years
  // away is almost certainly a misreading.
  const plausible = due && due.dueAt > context.now - DAY && due.dueAt < context.now + 730 * DAY
  if (due && plausible && (title || classroomDue)) task = { title: title ?? message!.subject, ...due }

  const triage: MailTriage = { important, summary }
  const folder = canonicalFolder(raw.folder, context.folders)
  if (folder) triage.folder = folder
  const tags = canonicalTags(raw.tags)
  if (tags.length) triage.tags = tags
  const why = important ? text(raw.why, 80) : undefined
  if (why) triage.why = why
  if (task) triage.task = task
  return triage
}

/** The address part of a From header, lower-cased, for remembering what the person said about a sender. */
export function senderAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from)?.[1]
  return (angled ?? from).trim().toLowerCase()
}
