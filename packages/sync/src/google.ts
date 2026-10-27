import { classroomDueAt, type ClassroomDue, type MailMessage } from '@cairn/core'

/**
 * Only what these calls need, typed structurally so the global fetch of
 * React Native, a web view or Node satisfies it without this package taking
 * on any one of their type libraries.
 */
export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers: { get(name: string): string | null } }>

function globalFetch(): Fetch {
  const found = (globalThis as { fetch?: Fetch }).fetch
  if (!found) throw new Error('This runtime has no fetch; pass one of your own')
  return found
}

/**
 * A Google API refusal, with the reason Google gave. The reasons that mean
 * "someone has to change a setting" are named, because they are the ones a
 * person can act on and the generic message would hide.
 */
export class GoogleApiError extends Error {
  constructor(
    readonly api: string,
    readonly status: number,
    /** Google's own reason, e.g. SERVICE_DISABLED or insufficientPermissions. */
    readonly reason: string,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }

  /** The API is switched off for the Cloud project, which only its owner can fix. */
  get apiDisabled(): boolean {
    return this.reason === 'SERVICE_DISABLED' || this.reason === 'accessNotConfigured'
  }

  /** The account never granted the scope this call needs. */
  get missingScope(): boolean {
    return this.status === 403 && /insufficient|scope/i.test(this.reason + this.message)
  }

  /** Google wants fewer requests for a while. Retrying straight away only makes it worse. */
  get rateLimited(): boolean {
    return this.status === 429 || /rate ?limit|quota|RESOURCE_EXHAUSTED/i.test(this.reason + ' ' + this.message)
  }
}

async function call<T>(api: string, fetchFn: Fetch, token: string, url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<T> {
  const response = await fetchFn(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (response.ok) return (await response.json()) as T
  let reason = String(response.status)
  let message = `${api} refused the request (${response.status})`
  try {
    const body = (await response.json()) as { error?: { status?: string; message?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] } }
    reason = body.error?.details?.find((d) => d.reason)?.reason ?? body.error?.errors?.[0]?.reason ?? body.error?.status ?? reason
    message = body.error?.message ?? message
  } catch {
    // Not JSON; the status is all there is.
  }
  const error = new GoogleApiError(api, response.status, reason, message)
  if (error.apiDisabled) {
    error.message = `The ${api} API is turned off for Cairn's Google Cloud project. Enable it in the Cloud console, then try again.`
  } else if (error.rateLimited) {
    error.message = `${api} asked Cairn to slow down. It will check again in a few minutes.`
  }
  throw error
}

/** Runs at most `limit` of the tasks at a time; Google rate-limits bursts per user. */
async function inBatches<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await run(items[i]!)
      }
    }),
  )
  return out
}

// ---------------------------------------------------------------- Gmail

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', zwnj: '' }

/**
 * The words of an HTML email, laid out roughly as it reads: styles and
 * scripts gone, block ends as line breaks, list items as bullets, entities
 * decoded. Good enough for a reader — person or model — not a renderer.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(head|style|script|title)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table|ul|ol|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
      if (name[0] === '#') {
        const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' '
      }
      return ENTITIES[name.toLowerCase()] ?? whole
    })
    .replace(/[ \t ‌]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** The conversation in Gmail. Gmail opens a conversation by its thread id; mail found before Cairn kept one falls back to the message's. */
export function gmailLink(message: Pick<MailMessage, 'id' | 'account' | 'threadId'>): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(message.account)}/#all/${message.threadId ?? message.id}`
}

// ---------------------------------------------------------------- Classroom

export interface Course {
  id: string
  name: string
  section?: string
  /** RFC 3339. A new semester's classes are the newest. */
  creationTime?: string
  updateTime?: string
}

export interface CourseWork extends ClassroomDue {
  id: string
  courseId: string
  title: string
  /** RFC 3339. Work set before Classroom was switched on in Cairn is left alone. */
  creationTime?: string
  description?: string
  alternateLink?: string
}

export interface ClassroomItem {
  course: Course
  work: CourseWork
  /** Handed in or already returned: nothing left to do. */
  submitted: boolean
}

export interface Announcement {
  id: string
  courseId: string
  text?: string
  /** RFC 3339. */
  creationTime?: string
  alternateLink?: string
}

/** What a post can carry. Only Drive files are downloadable; links, videos and forms are not files. */
interface Material {
  driveFile?: { driveFile?: { id?: string; title?: string } }
}

/** One file a teacher attached, and the post it came with. */
export interface ClassroomFile {
  course: Course
  post: {
    id: string
    kind: 'work' | 'announcement' | 'material'
    title: string
    /** When it was posted or last changed, whichever is later. */
    postedAt: number
  }
  file: { id: string; title: string }
}

const CLASSROOM = 'https://classroom.googleapis.com/v1'

/** The courses the account is a student in, still running. */
async function activeCourses(token: string, fetchFn: Fetch = globalFetch()): Promise<Course[]> {
  const { courses = [] } = await call<{ courses?: Course[] }>('Classroom', fetchFn, token, `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`)
  return courses
}

export { activeCourses as classroomCourses }

/**
 * Every Drive file attached to the recent posts of the given courses:
 * assignments, announcements and plain materials. A course or a kind of post
 * Classroom will not open is skipped, as with the feed.
 */
export async function classroomFiles(
  token: string,
  courses: readonly Course[],
  fetchFn: Fetch = globalFetch(),
): Promise<{ files: ClassroomFile[]; skipped: string[] }> {
  type Post = { id: string; title?: string; text?: string; creationTime?: string; updateTime?: string; materials?: Material[] }
  const skipped: string[] = []
  const missing = new Set<string>()
  const list = async (course: Course, path: string, key: string): Promise<Post[]> => {
    if (missing.has(path)) return []
    try {
      const body = await call<Record<string, Post[] | undefined>>('Classroom', fetchFn, token, `${CLASSROOM}/courses/${course.id}/${path}?pageSize=40&orderBy=updateTime%20desc`)
      return body[key] ?? []
    } catch (error) {
      // A kind of post this grant does not cover: leave it out everywhere, quietly.
      if (error instanceof GoogleApiError && error.missingScope) {
        missing.add(path)
        return []
      }
      throw error
    }
  }
  const perCourse = await inBatches(courses, 3, async (course) => {
    try {
      const [work, announcements, materials] = await Promise.all([
        list(course, 'courseWork', 'courseWork'),
        list(course, 'announcements', 'announcements'),
        list(course, 'courseWorkMaterials', 'courseWorkMaterial'),
      ])
      const found: ClassroomFile[] = []
      for (const [kind, posts] of [
        ['work', work],
        ['announcement', announcements],
        ['material', materials],
      ] as const) {
        for (const post of posts) {
          const postedAt = Math.max(Date.parse(post.creationTime ?? '') || 0, Date.parse(post.updateTime ?? '') || 0)
          const title = post.title ?? post.text?.split('\n').find((line) => line.trim())?.trim().slice(0, 80) ?? 'Announcement'
          for (const material of post.materials ?? []) {
            const file = material.driveFile?.driveFile
            if (file?.id) found.push({ course, post: { id: post.id, kind, title, postedAt }, file: { id: file.id, title: file.title ?? 'Untitled' } })
          }
        }
      }
      return found
    } catch (error) {
      if (!(error instanceof GoogleApiError) || error.rateLimited || error.status === 401) throw error
      skipped.push(course.name)
      return []
    }
  })
  return { files: perCourse.flat(), skipped }
}

/** What Drive says about a file, enough to decide whether and how to download it. */
export interface DriveFileInfo {
  id: string
  name: string
  mimeType: string
  /** Bytes. Absent for Google Docs, Sheets and Slides, which have no file until exported. */
  size?: number
  /** False when the owner turned off downloading for viewers. */
  canDownload: boolean
}

export async function driveFileInfo(token: string, fileId: string, fetchFn: Fetch = globalFetch()): Promise<DriveFileInfo> {
  const info = await call<{ id: string; name?: string; mimeType?: string; size?: string; capabilities?: { canDownload?: boolean } }>(
    'Drive',
    fetchFn,
    token,
    `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,capabilities(canDownload)&supportsAllDrives=true`,
  )
  return {
    id: info.id,
    name: info.name ?? 'Untitled',
    mimeType: info.mimeType ?? 'application/octet-stream',
    size: info.size === undefined ? undefined : Number(info.size),
    canDownload: info.capabilities?.canDownload !== false,
  }
}

/**
 * A file's bytes, exported to `exportAs` when it is a Google Doc, Sheet or
 * Slides, which have no file of their own to download.
 */
export async function driveFetch(
  token: string,
  fileId: string,
  exportAs?: string,
  fetchFn: (url: string, init: { headers: Record<string, string> }) => Promise<Awaited<ReturnType<Fetch>> & { arrayBuffer(): Promise<ArrayBuffer> }> = globalFetch() as never,
): Promise<ArrayBuffer> {
  const id = encodeURIComponent(fileId)
  const url = exportAs ? `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exportAs)}` : `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`
  const response = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) await call('Drive', async () => response, token, '')
  return response.arrayBuffer()
}

/** New coursework, as the inbox reads it. */
export function courseWorkMessage(item: ClassroomItem, account: string): MailMessage {
  const { course, work } = item
  return {
    id: `classroom-work-${work.id}`,
    account,
    from: course.name,
    subject: work.title,
    snippet: (work.description ?? '').slice(0, 200),
    text: work.description,
    receivedAt: Date.parse(work.creationTime ?? '') || Date.now(),
    classroom: {
      kind: 'work',
      courseId: course.id,
      course: course.name,
      workId: work.id,
      due: classroomDueAt(work) ?? undefined,
      link: work.alternateLink,
    },
  }
}

/** A new announcement, as the inbox reads it. */
export function announcementMessage(course: Course, announcement: Announcement, account: string): MailMessage {
  const text = announcement.text ?? ''
  const firstLine = text.split('\n').find((line) => line.trim())?.trim() ?? 'Announcement'
  return {
    id: `classroom-announcement-${announcement.id}`,
    account,
    from: course.name,
    subject: firstLine.length > 90 ? `${firstLine.slice(0, 87)}…` : firstLine,
    snippet: text.slice(0, 200),
    text,
    receivedAt: Date.parse(announcement.creationTime ?? '') || Date.now(),
    classroom: { kind: 'announcement', courseId: course.id, course: course.name, link: announcement.alternateLink },
  }
}

// ---------------------------------------------------------------- Drive

const DRIVE = 'https://www.googleapis.com/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
let folderId: string | null = null

/**
 * The "Cairn" folder in the owner's Drive. With the drive.file scope Cairn
 * can only see files it created itself, so this finds its own folder and
 * never anything else of the person's.
 */
export async function driveFolder(token: string, fetchFn: Fetch = globalFetch()): Promise<string> {
  if (folderId) return folderId
  const q = encodeURIComponent(`name = 'Cairn' and mimeType = '${FOLDER}' and trashed = false`)
  const found = await call<{ files?: { id: string }[] }>('Drive', fetchFn, token, `${DRIVE}/files?q=${q}&fields=files(id)&spaces=drive`)
  if (found.files?.[0]) return (folderId = found.files[0].id)
  const made = await call<{ id: string }>('Drive', fetchFn, token, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Cairn', mimeType: FOLDER }),
  })
  return (folderId = made.id)
}

/**
 * Opens a resumable upload and returns the address to send the bytes to. The
 * bytes themselves go up through the platform's own uploader, which can send
 * a file from disk without holding it in memory.
 */
export async function startDriveUpload(
  token: string,
  file: { name: string; mime: string; bytes?: number },
  fetchFn: Fetch = globalFetch(),
): Promise<string> {
  const parent = await driveFolder(token, fetchFn)
  const response = await fetchFn('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.mime,
      ...(file.bytes ? { 'X-Upload-Content-Length': String(file.bytes) } : {}),
    },
    body: JSON.stringify({ name: file.name, parents: [parent] }),
  })
  const location = response.headers.get('location') ?? response.headers.get('Location')
  if (!response.ok || !location) await call('Drive', async () => response, token, '')
  return location!
}

export function driveDownloadUrl(fileId: string): string {
  return `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`
}

/** A file's bytes, or the GoogleApiError saying why Drive would not hand them over. */
export async function driveDownload(
  token: string,
  fileId: string,
  fetchFn: (url: string, init: { headers: Record<string, string> }) => Promise<Awaited<ReturnType<Fetch>> & { arrayBuffer(): Promise<ArrayBuffer> }> = globalFetch() as never,
): Promise<ArrayBuffer> {
  const response = await fetchFn(driveDownloadUrl(fileId), { headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) await call('Drive', async () => response, token, '')
  return response.arrayBuffer()
}

/**
 * Moves a file to Drive's trash, or back out of it. Drive empties its trash
 * after thirty days on its own, the same time a note spends in Cairn's bin.
 */
export async function setDriveTrashed(token: string, fileId: string, trashed: boolean, fetchFn: Fetch = globalFetch()): Promise<void> {
  await call('Drive', fetchFn, token, `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed }),
  })
}

/** For tests: forgets the cached folder id. */
export function resetDriveFolder(): void {
  folderId = null
}
