import type { ClassroomDue, MailMessage } from '@cairn/core'

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

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  snippet?: string
  internalDate?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Gmail bodies are base64url UTF-8. Decoded by hand because neither atob nor
 * TextDecoder can be relied on in every JavaScript runtime Cairn runs in.
 */
export function decodeBase64Url(data: string): string {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of data.replace(/[=\s]/g, '').replace(/\+/g, '-').replace(/\//g, '_')) {
    const value = B64.indexOf(ch)
    if (value < 0) continue
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4
    let code = size === 1 ? b : b & (0xff >> (size + 1))
    for (let k = 1; k < size; k++) code = (code << 6) | ((bytes[i + k] ?? 0) & 0x3f)
    out += String.fromCodePoint(code)
    i += size
  }
  return out
}

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

function firstOfType(part: GmailPart | undefined, mime: string): string | undefined {
  if (!part) return undefined
  if (part.mimeType === mime && part.body?.data) return decodeBase64Url(part.body.data)
  for (const child of part.parts ?? []) {
    const found = firstOfType(child, mime)
    if (found) return found
  }
  return undefined
}

/**
 * The body as text. The plain-text version is preferred, unless it is a stub
 * ("view this email in your browser") and the HTML has the actual message.
 */
function plainText(part: GmailPart | undefined): string | undefined {
  const plain = firstOfType(part, 'text/plain')?.trim()
  const html = firstOfType(part, 'text/html')
  if (plain && (plain.length >= 200 || !html)) return plain
  const fromHtml = html ? htmlToText(html) : undefined
  return fromHtml && fromHtml.length > (plain?.length ?? 0) ? fromHtml : plain || fromHtml
}

/** Mail Cairn never reads, whatever is asked. */
const NEVER = ['SPAM', 'TRASH']
/** Tabs skipped unless asked for: without something to sort them, they are noise. */
const NOISY = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

/** Gmail's history has moved on past the stored point (about a week), so it must be taken afresh. */
export class MailCursorExpired extends Error {
  constructor() {
    super('Gmail no longer has history that far back')
    this.name = 'MailCursorExpired'
  }
}

/**
 * Where the mailbox is now. Taken when reading is switched on, so Cairn
 * starts from that moment instead of working through everything already in
 * the inbox — which is slow, costly against Google's quota, and not what
 * anyone asked for.
 */
export async function mailCursor(token: string, fetchFn: Fetch = globalFetch()): Promise<string> {
  const profile = await call<{ historyId: string }>('Gmail', fetchFn, token, `${GMAIL}/profile`)
  return profile.historyId
}

/**
 * Mail that has reached the inbox since `cursor`, and the cursor to use next
 * time. With nothing new this is one cheap request, so it can run every few
 * minutes without coming near the quota.
 *
 * Promotions and Social are skipped unless `everyTab` is set — which is right
 * when something will sort them, since hackathons and job posts often land
 * in Promotions.
 */
export async function mailSince(
  token: string,
  account: string,
  cursor: string,
  fetchFn: Fetch = globalFetch(),
  options: { everyTab?: boolean } = {},
): Promise<{ messages: MailMessage[]; cursor: string }> {
  const skip = options.everyTab ? NEVER : [...NEVER, ...NOISY]
  const ids: string[] = []
  let next = cursor
  let page: string | undefined
  // A handful of pages is days of mail; anything beyond is a mailbox import, not news.
  for (let i = 0; i < 5; i++) {
    const query = `startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX&maxResults=100${page ? `&pageToken=${page}` : ''}`
    let result: { history?: { messagesAdded?: { message: { id: string; labelIds?: string[] } }[] }[]; historyId: string; nextPageToken?: string }
    try {
      result = await call('Gmail', fetchFn, token, `${GMAIL}/history?${query}`)
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 404) throw new MailCursorExpired()
      throw error
    }
    for (const entry of result.history ?? []) {
      for (const added of entry.messagesAdded ?? []) {
        const labels = added.message.labelIds ?? []
        // Skipped before fetching, so unwanted mail costs nothing.
        if (labels.some((label) => skip.includes(label))) continue
        if (!ids.includes(added.message.id)) ids.push(added.message.id)
      }
    }
    next = result.historyId
    page = result.nextPageToken
    if (!page) break
  }

  const messages = await inBatches(ids.slice(-40), 3, (id) => call<GmailMessage>('Gmail', fetchFn, token, `${GMAIL}/messages/${id}?format=full`))
  return {
    cursor: next,
    messages: messages.map((m) => {
      const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? ''
      return {
        id: m.id,
        account,
        from: header('from'),
        subject: header('subject'),
        snippet: m.snippet ?? '',
        text: plainText(m.payload)?.slice(0, 8000),
        receivedAt: Number(m.internalDate ?? Date.now()),
      }
    }),
  }
}

/** Opens a message in Gmail itself. */
export function gmailLink(message: Pick<MailMessage, 'id' | 'account'>): string {
  return `https://mail.google.com/mail/u/${encodeURIComponent(message.account)}/#all/${message.id}`
}

// ---------------------------------------------------------------- Classroom

export interface Course {
  id: string
  name: string
  section?: string
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

const CLASSROOM = 'https://classroom.googleapis.com/v1'

/**
 * Every piece of work in the account's active courses, with whether it has
 * been handed in. Submission state comes from one call per course rather than
 * one per assignment, which is the difference between a handful of requests
 * and hundreds.
 */
export async function classroomWork(token: string, fetchFn: Fetch = globalFetch()): Promise<ClassroomItem[]> {
  const { courses = [] } = await call<{ courses?: Course[] }>('Classroom', fetchFn, token, `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=50`)
  const perCourse = await inBatches(courses, 4, async (course) => {
    const [{ courseWork = [] }, { studentSubmissions = [] }] = await Promise.all([
      call<{ courseWork?: CourseWork[] }>('Classroom', fetchFn, token, `${CLASSROOM}/courses/${course.id}/courseWork?pageSize=40&orderBy=dueDate%20desc`),
      call<{ studentSubmissions?: { courseWorkId: string; state: string }[] }>(
        'Classroom',
        fetchFn,
        token,
        `${CLASSROOM}/courses/${course.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
      ),
    ])
    const handedIn = new Set(studentSubmissions.filter((s) => s.state === 'TURNED_IN' || s.state === 'RETURNED').map((s) => s.courseWorkId))
    return courseWork.map((work) => ({ course, work, submitted: handedIn.has(work.id) }))
  })
  return perCourse.flat()
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

/** For tests: forgets the cached folder id. */
export function resetDriveFolder(): void {
  folderId = null
}
