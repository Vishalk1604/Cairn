import { describe, expect, it } from 'vitest'
import { classroomWork, decodeBase64Url, GoogleApiError, mailCursor, MailCursorExpired, mailSince, resetDriveFolder, startDriveUpload, type Fetch } from '../src'

type Route = (url: string, init?: Parameters<Fetch>[1]) => { status?: number; body?: unknown; headers?: Record<string, string> }

/** A fetch that answers from a table of URL fragments, recording what was asked. */
function fakeFetch(routes: [string, Route][]) {
  const calls: string[] = []
  const fetchFn: Fetch = async (url, init) => {
    calls.push(url)
    const match = routes.find(([fragment]) => url.includes(fragment))
    if (!match) throw new Error(`No route for ${url}`)
    const { status = 200, body = {}, headers = {} } = match[1](url, init)
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    }
  }
  return { fetchFn, calls }
}

/** Vitest runs on Node, whose Buffer the package's own types deliberately do not know about. */
declare const Buffer: { from(text: string, encoding: 'utf8'): { toString(encoding: 'base64url'): string } }

const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')

describe('decodeBase64Url', () => {
  it('decodes UTF-8 text, accents and emoji included', () => {
    expect(decodeBase64Url(b64('Due Friday — café ✓ 🎓'))).toBe('Due Friday — café ✓ 🎓')
  })
})

describe('incremental mail', () => {
  const message = {
    id: 'a',
    snippet: 'snip',
    internalDate: '1700000000000',
    payload: {
      headers: [
        { name: 'From', value: 'no-reply@classroom.google.com' },
        { name: 'Subject', value: 'New assignment: "Lab 4"' },
      ],
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/plain', body: { data: b64('Due Oct 22') } }],
    },
  }

  it('starts from where the mailbox is now, reading nothing already there', async () => {
    const { fetchFn, calls } = fakeFetch([['/profile', () => ({ body: { historyId: '900' } })]])
    expect(await mailCursor('token', fetchFn)).toBe('900')
    expect(calls).toHaveLength(1)
  })

  it('fetches only what arrived since the cursor, and moves the cursor on', async () => {
    const { fetchFn, calls } = fakeFetch([
      ['/history?', () => ({ body: { historyId: '950', history: [{ messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX'] } }] }] } })],
      ['/messages/a', () => ({ body: message })],
    ])
    const { messages, cursor } = await mailSince('token', 'me@uni.edu', '900', fetchFn)
    expect(cursor).toBe('950')
    expect(messages[0]).toMatchObject({ id: 'a', account: 'me@uni.edu', subject: 'New assignment: "Lab 4"', text: 'Due Oct 22' })
    expect(calls[0]).toContain('startHistoryId=900')
  })

  it('costs one request when nothing is new', async () => {
    const { fetchFn, calls } = fakeFetch([['/history?', () => ({ body: { historyId: '900' } })]])
    expect((await mailSince('token', 'me', '900', fetchFn)).messages).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('skips promotions and social mail unless every tab is asked for, and never reads spam', async () => {
    const history = [
      { messagesAdded: [{ message: { id: 'p', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'] } }] },
      { messagesAdded: [{ message: { id: 's', labelIds: ['INBOX', 'SPAM'] } }] },
    ]
    const routes: [string, Route][] = [
      ['/history?', () => ({ body: { historyId: '901', history } })],
      ['/messages/p', () => ({ body: { ...message, id: 'p' } })],
    ]
    const plain = fakeFetch(routes)
    await mailSince('token', 'me', '900', plain.fetchFn)
    expect(plain.calls.some((c) => c.includes('/messages/'))).toBe(false)

    const every = fakeFetch(routes)
    const { messages } = await mailSince('token', 'me', '900', every.fetchFn, { everyTab: true })
    expect(messages.map((m) => m.id)).toEqual(['p'])
  })

  it('reads an HTML-only email as text, and prefers the HTML when the plain part is a stub', async () => {
    const html = '<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;Vishal,</p><ul><li>Apply by <b>1 Dec</b></li></ul><p>Thanks &amp; regards</p></body></html>'
    const stub = { ...message, payload: { ...message.payload, parts: [{ mimeType: 'text/plain', body: { data: b64('View in browser') } }, { mimeType: 'text/html', body: { data: b64(html) } }] } }
    const { fetchFn } = fakeFetch([
      ['/history?', () => ({ body: { historyId: '950', history: [{ messagesAdded: [{ message: { id: 'a', labelIds: ['INBOX'] } }] }] } })],
      ['/messages/a', () => ({ body: stub })],
    ])
    const { messages } = await mailSince('token', 'me', '900', fetchFn)
    expect(messages[0]?.text).toBe(['Hi Vishal,', '• Apply by 1 Dec', 'Thanks & regards'].join('\n\n'))
  })

  it('says when the cursor is too old to continue from', async () => {
    const { fetchFn } = fakeFetch([['/history?', () => ({ status: 404, body: { error: { message: 'Requested entity was not found.' } } })]])
    await expect(mailSince('token', 'me', '1', fetchFn)).rejects.toBeInstanceOf(MailCursorExpired)
  })

  it('says plainly when the Gmail API is switched off for the project', async () => {
    const { fetchFn } = fakeFetch([
      ['/profile', () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'disabled', details: [{ reason: 'SERVICE_DISABLED' }] } } })],
    ])
    const error = await mailCursor('token', fetchFn).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect((error as GoogleApiError).apiDisabled).toBe(true)
    expect((error as Error).message).toMatch(/Gmail API is turned off/)
  })

  it('turns a quota refusal into a message about slowing down', async () => {
    const { fetchFn } = fakeFetch([
      ['/history?', () => ({ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED', message: "Quota exceeded for quota metric 'Total Query Cost'" } } })],
    ])
    const error = (await mailSince('token', 'me', '900', fetchFn).catch((e: unknown) => e)) as GoogleApiError
    expect(error.rateLimited).toBe(true)
    expect(error.message).toMatch(/slow down/)
  })
})

describe('classroomWork', () => {
  it('pairs each assignment with whether it has been handed in', async () => {
    const { fetchFn } = fakeFetch([
      ['/studentSubmissions', () => ({ body: { studentSubmissions: [{ courseWorkId: 'w1', state: 'TURNED_IN' }, { courseWorkId: 'w2', state: 'CREATED' }] } })],
      ['/courseWork?', () => ({ body: { courseWork: [{ id: 'w1', courseId: 'c1', title: 'Essay' }, { id: 'w2', courseId: 'c1', title: 'Quiz' }] } })],
      ['/courses?', () => ({ body: { courses: [{ id: 'c1', name: 'History' }] } })],
    ])
    const items = await classroomWork('token', fetchFn)
    expect(items.map((i) => [i.work.title, i.submitted])).toEqual([
      ['Essay', true],
      ['Quiz', false],
    ])
  })
})

describe('startDriveUpload', () => {
  it('files uploads in Cairn’s own folder, creating it once', async () => {
    resetDriveFolder()
    let created = 0
    const { fetchFn } = fakeFetch([
      ['uploadType=resumable', () => ({ headers: { location: 'https://upload.example/session' } })],
      ['/files?q=', () => ({ body: { files: [] } })],
      ['/files?fields=id', () => (created++, { body: { id: 'folder1' } })],
    ])
    expect(await startDriveUpload('token', { name: 'a.jpg', mime: 'image/jpeg' }, fetchFn)).toBe('https://upload.example/session')
    await startDriveUpload('token', { name: 'b.jpg', mime: 'image/jpeg' }, fetchFn)
    expect(created).toBe(1)
  })
})
