import { refreshTokens, type TokenSet } from '@cairn/auth'
import { GoogleApiError, htmlToText, type Announcement, type Course, type CourseWork } from '@cairn/sync/google'
import { GOOGLE_SCOPES } from '@cairn/sync/scopes'
import type { Service, Want } from '@cairn/sync/worker'
import { fromBase64Url, fromUtf8 } from './crypto'
import type { Env } from './env'
import type { FetchFn } from './net'

/**
 * Google, from the Worker: the consent flow it runs as a confidential Web
 * client, and the few Gmail and Classroom calls a check needs, each asking
 * for only the fields it uses so there is less to parse.
 */

const has = (scopes: readonly string[], wanted: readonly string[]) => wanted.every((s) => scopes.includes(s))

const COURSES = 'https://www.googleapis.com/auth/classroom.courses.readonly'
const COURSEWORK = 'https://www.googleapis.com/auth/classroom.coursework.me.readonly'
const OLD_COURSEWORK = 'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'
const ANNOUNCEMENTS = 'https://www.googleapis.com/auth/classroom.announcements.readonly'

/** What to ask Google for. The identity scopes always, so every grant also says who it is. */
export function scopesFor(want: readonly Want[]): string[] {
  const out = new Set<string>(GOOGLE_SCOPES.identity)
  for (const group of want) {
    if (group === 'drive') for (const s of GOOGLE_SCOPES.media) out.add(s)
    if (group === 'mail') for (const s of GOOGLE_SCOPES.mail) out.add(s)
    if (group === 'classroom' || group === 'files') for (const s of GOOGLE_SCOPES.classroom) out.add(s)
    if (group === 'files') for (const s of GOOGLE_SCOPES.classroomFiles) out.add(s)
  }
  return [...out]
}

/** What a grant allows, in the apps' terms. */
export function servicesOf(scopes: readonly string[]): Service[] {
  const out: Service[] = []
  if (has(scopes, GOOGLE_SCOPES.media)) out.push('drive')
  if (has(scopes, GOOGLE_SCOPES.mail)) out.push('mail')
  const classroom = scopes.includes(COURSES) && (scopes.includes(COURSEWORK) || scopes.includes(OLD_COURSEWORK))
  if (classroom) out.push('classroom')
  if (classroom && scopes.includes(ANNOUNCEMENTS)) out.push('announcements')
  if (scopes.includes(COURSES) && has(scopes, GOOGLE_SCOPES.classroomFiles)) out.push('files')
  return out
}

/** The scopes a device's token is narrowed to, by what it is for. */
export function purposeScopes(purpose: 'drive' | 'classroomFiles', granted: readonly string[]): string[] | null {
  if (purpose === 'drive') return has(granted, GOOGLE_SCOPES.media) ? [...GOOGLE_SCOPES.media] : null
  if (!servicesOf(granted).includes('files')) return null
  return [COURSES, ...GOOGLE_SCOPES.classroomFiles, ...[COURSEWORK, OLD_COURSEWORK, ANNOUNCEMENTS].filter((s) => granted.includes(s))]
}

export function callbackUrl(env: Pick<Env, 'PUBLIC_URL'>): string {
  return `${env.PUBLIC_URL.replace(/\/+$/, '')}/auth/callback`
}

/**
 * A fresh access token. Narrowed to `scopes` when given; Google refuses a
 * narrowing it does not like with invalid_scope, and then the full grant is
 * used instead.
 */
export async function refresh(env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_SECRET'>, refreshToken: string, fetchFn: FetchFn, now: number, scopes?: readonly string[]): Promise<TokenSet> {
  const request = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, refreshToken }
  const deps = { fetch: fetchFn as never, now: () => now }
  if (!scopes) return refreshTokens(request, deps)
  try {
    return await refreshTokens({ ...request, scopes }, deps)
  } catch (error) {
    if ((error as { code?: string }).code !== 'invalid_scope') throw error
    return refreshTokens(request, deps)
  }
}

/** Gives a refresh token back to Google, so the permission goes too. Best effort. */
export async function revoke(token: string, fetchFn: FetchFn): Promise<void> {
  await fetchFn('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(token)}`,
  }).catch(() => undefined)
}

async function api<T>(name: string, fetchFn: FetchFn, token: string, url: string): Promise<T> {
  const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (response.ok) return (await response.json()) as T
  let reason = String(response.status)
  let message = `${name} refused the request (${response.status})`
  try {
    const body = (await response.json()) as { error?: { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }
    reason = body.error?.details?.find((d) => d.reason)?.reason ?? body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason
    message = body.error?.message ?? message
  } catch {
    // Not JSON; the status is all there is.
  }
  throw new GoogleApiError(name, response.status, reason, message)
}

// ---------------------------------------------------------------- Gmail

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Mail Cairn never reads, whatever else is asked. */
export const NEVER = ['SPAM', 'TRASH']
/** Tabs left alone when there is no model to sort them. */
export const NOISY = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']

export async function mailCursor(fetchFn: FetchFn, token: string): Promise<string> {
  return (await api<{ historyId: string }>('Gmail', fetchFn, token, `${GMAIL}/profile?fields=historyId`)).historyId
}

export class CursorExpired extends Error {
  constructor() {
    super('Gmail no longer has history that far back')
    this.name = 'CursorExpired'
  }
}

/**
 * Ids of mail that reached the inbox since `cursor`, Spam and Trash already
 * left out, and where to start next time. One cheap request when nothing is
 * new; at most a couple of pages when a lot is.
 */
export async function mailAdded(fetchFn: FetchFn, token: string, cursor: string, skip: readonly string[]): Promise<{ ids: string[]; cursor: string }> {
  const ids: string[] = []
  let next = cursor
  let page: string | undefined
  for (let i = 0; i < 2; i++) {
    const query = `startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX&maxResults=100&fields=history(messagesAdded(message(id,labelIds))),historyId,nextPageToken${page ? `&pageToken=${page}` : ''}`
    let result: { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId?: string; nextPageToken?: string }
    try {
      result = await api('Gmail', fetchFn, token, `${GMAIL}/history?${query}`)
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) throw new CursorExpired()
      throw error
    }
    for (const entry of result.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        if ((added.message.labelIds ?? []).some((label) => skip.includes(label))) continue
        if (!ids.includes(added.message.id)) ids.push(added.message.id)
      }
    }
    if (result.historyId) next = result.historyId
    page = result.nextPageToken
    if (!page) break
  }
  return { ids, cursor: next }
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

export interface GmailMessage {
  id: string
  threadId?: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
}

/** One message: its headers, Gmail's preview and, when it is going to the model, its body. */
export async function mailMessage(fetchFn: FetchFn, token: string, id: string, body: boolean): Promise<GmailMessage | null> {
  const url = body
    ? `${GMAIL}/messages/${id}?format=full&fields=id,threadId,labelIds,snippet,internalDate,payload(headers,mimeType,body/data,parts(mimeType,body/data,parts(mimeType,body/data,parts(mimeType,body/data))))`
    : `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&fields=id,threadId,labelIds,snippet,internalDate,payload/headers`
  try {
    return await api<GmailMessage>('Gmail', fetchFn, token, url)
  } catch (error) {
    // Gone between the history and the fetch: a draft sent, or mail deleted straight away.
    if (error instanceof GoogleApiError && error.status === 404) return null
    throw error
  }
}

/** Gmail bodies are base64url UTF-8; the runtime decodes them far faster than script could. */
function decodeBody(data: string): string {
  try {
    return fromUtf8(fromBase64Url(data.replace(/[=\s]/g, '')))
  } catch {
    return ''
  }
}

function firstOfType(part: GmailPart | undefined, mime: string): string | undefined {
  if (!part) return undefined
  if (part.mimeType === mime && part.body?.data) return decodeBody(part.body.data)
  for (const child of part.parts ?? []) {
    const found = firstOfType(child, mime)
    if (found) return found
  }
  return undefined
}

/** The body as text: the plain version unless it is a stub and the HTML has the message. */
export function bodyText(message: GmailMessage, limit = 8000): string | undefined {
  const plain = firstOfType(message.payload, 'text/plain')?.trim()
  const html = firstOfType(message.payload, 'text/html')
  if (plain && (plain.length >= 200 || !html)) return plain.slice(0, limit)
  // Only so much HTML is worth turning into text; the rest is footers.
  const fromHtml = html ? htmlToText(html.slice(0, 60_000)) : undefined
  const text = fromHtml && fromHtml.length > (plain?.length ?? 0) ? fromHtml : plain || fromHtml
  return text?.slice(0, limit)
}

/** The start of the HTML part, where Classroom's emails keep the link to the post when the plain part has none. */
export function classroomHtml(message: GmailMessage): string | undefined {
  return firstOfType(message.payload, 'text/html')?.slice(0, 20_000)
}

export function header(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
}

// ---------------------------------------------------------------- Classroom

const CLASSROOM = 'https://classroom.googleapis.com/v1'

export async function courses(fetchFn: FetchFn, token: string): Promise<Course[]> {
  const { courses = [] } = await api<{ courses?: Course[] }>(
    'Classroom',
    fetchFn,
    token,
    `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=50&fields=courses(id,name,section,creationTime)`,
  )
  return courses
}

export interface CourseFeed {
  work: CourseWork[]
  /** Work handed in or returned, by id. */
  submitted: Set<string>
  /** Null when announcements are not granted. */
  announcements: Announcement[] | null
}

/** One course's recent work, what has been handed in, and its announcements: three requests at once. */
export async function courseFeed(fetchFn: FetchFn, token: string, course: Course, announcements: boolean): Promise<CourseFeed> {
  const base = `${CLASSROOM}/courses/${encodeURIComponent(course.id)}`
  const [work, submissions, posted] = await Promise.all([
    api<{ courseWork?: CourseWork[] }>(
      'Classroom',
      fetchFn,
      token,
      `${base}/courseWork?pageSize=20&orderBy=updateTime%20desc&fields=courseWork(id,courseId,title,description,dueDate,dueTime,creationTime,alternateLink)`,
    ),
    api<{ studentSubmissions?: { courseWorkId: string; state: string }[] }>(
      'Classroom',
      fetchFn,
      token,
      `${base}/courseWork/-/studentSubmissions?userId=me&pageSize=100&fields=studentSubmissions(courseWorkId,state)`,
    ),
    announcements
      ? api<{ announcements?: Announcement[] }>('Classroom', fetchFn, token, `${base}/announcements?pageSize=10&orderBy=updateTime%20desc&fields=announcements(id,courseId,text,creationTime,alternateLink)`)
      : Promise.resolve(null),
  ])
  return {
    work: (work.courseWork ?? []).map((w) => ({ ...w, courseId: w.courseId ?? course.id })),
    submitted: new Set((submissions.studentSubmissions ?? []).filter((s) => s.state === 'TURNED_IN' || s.state === 'RETURNED').map((s) => s.courseWorkId)),
    announcements: posted ? (posted.announcements ?? []) : null,
  }
}
