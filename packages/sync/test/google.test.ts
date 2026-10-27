import { describe, expect, it } from 'vitest'
import { classroomFiles, courseWorkMessage, driveFileInfo, gmailLink, GoogleApiError, htmlToText, resetDriveFolder, setDriveTrashed, startDriveUpload, type Fetch } from '../src'

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

describe('mail helpers', () => {
  it('reads an HTML email as text', () => {
    expect(htmlToText('<style>p{}</style><p>Register&nbsp;by <b>Friday</b></p><ul><li>Teams of four</li></ul>')).toBe('Register by Friday\n\n• Teams of four')
  })

  it('links to the conversation in Gmail, in the right account', () => {
    expect(gmailLink({ id: 'm1', threadId: 't1', account: 'me@college.edu' })).toBe('https://mail.google.com/mail/u/me%40college.edu/#all/t1')
  })
})

describe('Google refusals', () => {
  it('say plainly when an API is switched off for the project', async () => {
    const { fetchFn } = fakeFetch([
      ['/files/', () => ({ status: 403, body: { error: { status: 'PERMISSION_DENIED', message: 'disabled', details: [{ reason: 'SERVICE_DISABLED' }] } } })],
    ])
    const error = await driveFileInfo('token', 'f1', fetchFn).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GoogleApiError)
    expect((error as GoogleApiError).apiDisabled).toBe(true)
    expect((error as Error).message).toMatch(/Drive API is turned off/)
  })
})

describe('Classroom posts', () => {
  it('turns coursework into an inbox message with its exact due date', () => {
    const message = courseWorkMessage(
      {
        course: { id: 'c1', name: 'DBMS' },
        work: { id: 'w9', courseId: 'c1', title: 'Lab 4', dueDate: { year: 2026, month: 10, day: 25 }, dueTime: { hours: 18, minutes: 29 }, creationTime: '2026-10-22T10:00:00Z' },
        submitted: false,
      },
      'me',
    )
    expect(message).toMatchObject({
      id: 'classroom-work-w9',
      from: 'DBMS',
      subject: 'Lab 4',
      receivedAt: Date.parse('2026-10-22T10:00:00Z'),
      classroom: { kind: 'work', workId: 'w9', due: { dueAt: Date.UTC(2026, 9, 25, 18, 29), allDay: false } },
    })
  })
})

describe('classroomFiles', () => {
  it('collects the Drive files of assignments, announcements and materials, and skips the rest', async () => {
    const drive = (id: string, title: string) => ({ driveFile: { driveFile: { id, title } } })
    const { fetchFn } = fakeFetch([
      ['/courseWork?', () => ({ body: { courseWork: [{ id: 'w1', title: 'Lab 5', creationTime: '2026-10-20T10:00:00Z', materials: [drive('f1', 'Lab 5.pdf'), { link: { url: 'https://x' } }] }] } })],
      ['/announcements?', () => ({ status: 403, body: { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Request had insufficient authentication scopes.' } } })],
      [
        '/courseWorkMaterials?',
        () => ({ body: { courseWorkMaterial: [{ id: 'm1', title: 'Unit 3 slides', creationTime: '2026-10-21T10:00:00Z', updateTime: '2026-10-22T10:00:00Z', materials: [drive('f2', 'Unit 3.pptx')] }] } }),
      ],
    ])
    const { files, skipped } = await classroomFiles('token', [{ id: 'c1', name: 'DBMS' }], fetchFn)
    expect(skipped).toEqual([])
    expect(files).toEqual([
      { course: { id: 'c1', name: 'DBMS' }, post: { id: 'w1', kind: 'work', title: 'Lab 5', postedAt: Date.parse('2026-10-20T10:00:00Z') }, file: { id: 'f1', title: 'Lab 5.pdf' } },
      { course: { id: 'c1', name: 'DBMS' }, post: { id: 'm1', kind: 'material', title: 'Unit 3 slides', postedAt: Date.parse('2026-10-22T10:00:00Z') }, file: { id: 'f2', title: 'Unit 3.pptx' } },
    ])
  })
})

describe('setDriveTrashed', () => {
  it('moves a file to the trash and back', async () => {
    const bodies: string[] = []
    const { fetchFn, calls } = fakeFetch([['/files/f1', (_url, init) => (bodies.push(`${init?.method} ${init?.body}`), { body: { id: 'f1' } })]])
    await setDriveTrashed('token', 'f1', true, fetchFn)
    await setDriveTrashed('token', 'f1', false, fetchFn)
    expect(calls[0]).toContain('/drive/v3/files/f1')
    expect(bodies).toEqual(['PATCH {"trashed":true}', 'PATCH {"trashed":false}'])
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
