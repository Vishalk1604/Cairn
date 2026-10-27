import { beforeEach, describe, expect, it } from 'vitest'
import { aiContext } from '../src/accounts'
import { checkUser } from '../src/check'
import { seal } from '../src/crypto'
import { forgetFcmToken } from '../src/fcm'
import { Net } from '../src/net'
import { sealRefresh, type Ctx } from '../src/session'
import { FakeCloud, MemoryStore, serviceAccountJson, testEnv, type AccountFixture } from './fakes'

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
]

const UID = 'uid-me'
const ME = 'me@gmail.com'
const COLLEGE = 'me@college.edu'
/** 09:30 in Kolkata. */
const T0 = Date.UTC(2026, 9, 27, 4, 0)
const MIN = 60_000

const env = testEnv({ FCM_SERVICE_ACCOUNT: await serviceAccountJson() })

function fixture(over: Partial<AccountFixture> = {}): AccountFixture {
  return { historyId: '100', added: [], messages: {}, courses: [], refresh: `refresh-${Math.random()}`, scopes: SCOPES, ...over }
}

let cloud: FakeCloud
let store: MemoryStore

async function connect(email: string, role: 'owner' | 'source', account: AccountFixture) {
  cloud.accounts.set(email, account)
  await store.putAccount({
    uid: UID,
    email,
    sub: `sub-${email}`,
    role,
    scopes: account.scopes,
    refresh: await sealRefresh(env, UID, email, account.refresh),
    watchMail: true,
    watchClassroom: true,
    problem: null,
    createdAt: role === 'owner' ? 1 : 2,
  })
}

function ctx(now: number): Ctx {
  return { env, store, net: new Net(cloud.fetch), now }
}

const check = (now: number, aiUntil = now + 60_000) => checkUser(ctx(now), UID, { aiUntil, clock: () => now })

/** What the model makes of each message, by what its prompt says. */
function model(prompt: string) {
  // The system prompt itself mentions HackMIT, so the sender is what tells them apart.
  if (prompt.includes('hackmit.org')) {
    return { important: true, folder: 'Hackathons', tags: ['hackathon', 'hackmit'], summary: 'Register for HackMIT by Friday.', why: 'A hackathon', task: { title: 'Register for HackMIT', due: '2026-10-30T23:59' } }
  }
  if (prompt.includes('Weekly digest')) return { important: false, folder: null, tags: ['newsletter'], summary: 'A newsletter.', why: null, task: null }
  return { important: true, folder: 'Classes', tags: ['assignment'], summary: 'Coursework.', why: 'Coursework', task: null }
}

const inbox = (id: string) => cloud.docs.get(`users/${UID}/inbox/${id}`) as Record<string, any> | undefined
const fetched = (part: string) => cloud.calls.filter((c) => c.url.includes(part)).length

beforeEach(async () => {
  cloud = new FakeCloud()
  store = new MemoryStore()
  forgetFcmToken()
  cloud.triage = async (prompt) => model(prompt)
  await store.putUser(UID, ME, 0)
  await store.setTimeZone(UID, 'Asia/Kolkata')
  await store.setAi(UID, await seal(env, JSON.stringify({ key: 'nvapi-0123456789abcdefghijKLMN' }), aiContext(UID)))
  await store.putPush('push-token-0123456789abcdef', UID, 'android', 0)
  cloud.docs.set(`users/${UID}/settings/inbox`, { autoTasks: true })
})

describe('a person’s check', () => {
  it('starts from now, then reads, sorts, files tasks and tells the phone', async () => {
    await connect(ME, 'owner', fixture())
    await connect(
      COLLEGE,
      'source',
      fixture({
        courses: [
          {
            id: 'c1',
            name: 'DBMS',
            work: [{ id: 'old', title: 'Lab 1', creationTime: new Date(T0 - 86_400_000).toISOString() }],
            submitted: [],
            announcements: [],
          },
        ],
      }),
    )

    // The first look notes where everything is and announces nothing.
    const first = await check(T0)
    expect(first).toMatchObject({ found: 0, errors: [] })
    expect(cloud.pushes).toHaveLength(0)
    expect(cloud.docs.get(`users/${UID}/settings/reader`)).toMatchObject({ checkedAt: T0 })

    const me = cloud.accounts.get(ME)!
    me.historyId = '120'
    me.added = [{ id: 'm1' }, { id: 'm2', labelIds: ['INBOX', 'SPAM'] }, { id: 'm3' }]
    me.messages = {
      m1: { id: 'm1', from: 'HackMIT <team@hackmit.org>', subject: 'HackMIT registration closes Friday', body: 'Register by Friday.', internalDate: T0 + 2 * MIN },
      m2: { id: 'm2', from: 'spam@spam.com', subject: 'You won', internalDate: T0 + 3 * MIN },
      m3: { id: 'm3', from: 'news@paper.com', subject: 'Weekly digest', body: 'Weekly digest', internalDate: T0 + 4 * MIN },
    }
    const course = cloud.accounts.get(COLLEGE)!.courses[0]!
    course.work.push({ id: 'w2', title: 'Lab 2', creationTime: new Date(T0 + 5 * MIN).toISOString(), dueDate: { year: 2026, month: 10, day: 30 } })
    course.announcements.push({ id: 'a1', text: 'Quiz moved to Monday\nBring a pencil.', creationTime: new Date(T0 + 6 * MIN).toISOString() })

    const second = await check(T0 + 10 * MIN)
    expect(second).toMatchObject({ found: 4, errors: [] })

    // Spam is never fetched, let alone stored.
    expect(fetched('/messages/m2')).toBe(0)
    expect(inbox('m2')).toBeUndefined()
    // The old coursework was taken in quietly on the first look.
    expect(inbox('classroom-work-old')).toBeUndefined()

    const m1 = inbox('m1')!
    expect(m1).toMatchObject({ account: ME, subject: 'HackMIT registration closes Friday', triage: { important: true, folder: 'Hackathons' } })
    expect(m1.sorting).toBeUndefined()
    expect(m1.text).toBeUndefined()
    // "Friday 23:59" is read on the person's clock: 18:29 UTC.
    expect(m1.triage.task.dueAt).toBe(Date.UTC(2026, 9, 30, 18, 29))
    expect(inbox('m3')).toMatchObject({ triage: { important: false } })

    // Coursework became a task at Classroom's date, nine in the morning in Kolkata.
    expect(inbox('classroom-work-w2')).toMatchObject({ tasked: true, classroom: { kind: 'work', course: 'DBMS', due: { dueAt: Date.UTC(2026, 9, 30, 3, 30), allDay: true } } })
    const task = cloud.docs.get(`users/${UID}/reminders/classroom-w2`)!
    expect(task).toMatchObject({ id: 'classroom-w2', userId: UID, title: 'Lab 2', dueAt: Date.UTC(2026, 9, 30, 3, 30), allDay: true, status: 'pending', autoCompleteOn: 'classroom-submission' })
    // The announcement became one too, once sorted.
    expect(inbox('classroom-announcement-a1')).toMatchObject({ tasked: true })

    // The phone hears about the hackathon, the coursework and the announcement — not the newsletter.
    expect(cloud.pushes.map((p) => (p.notification as { title: string }).title).sort()).toEqual(['DBMS', 'DBMS', 'Hackathons'])
    expect(cloud.pushes.map((p) => (p.data as { kind: string }).kind).sort()).toEqual(['classroom', 'classroom', 'inbox'])

    // Nothing new: one cheap look, no writes to the inbox, no push.
    const writes = cloud.calls.filter((c) => c.url.endsWith(':commit')).length
    me.added = []
    await check(T0 + 20 * MIN)
    expect(cloud.calls.filter((c) => c.url.endsWith(':commit')).length).toBe(writes)
    expect(cloud.pushes).toHaveLength(3)

    // Handing the work in ticks its task off.
    course.submitted.push('w2')
    await check(T0 + 30 * MIN)
    expect(inbox('classroom-work-w2')!.classroom.submitted).toBe(true)
    expect(cloud.docs.get(`users/${UID}/reminders/classroom-w2`)).toMatchObject({ status: 'done' })
  })

  it('leaves what the model could not get to for the next run', async () => {
    await connect(ME, 'owner', fixture())
    await check(T0)
    const me = cloud.accounts.get(ME)!
    me.historyId = '101'
    me.added = [{ id: 'm1' }]
    me.messages = { m1: { id: 'm1', from: 'team@hackmit.org', subject: 'HackMIT registration closes Friday', internalDate: T0 + MIN } }

    // No time left for the model: the record shows at once, waiting to be sorted.
    await check(T0 + 10 * MIN, T0 + 10 * MIN)
    expect(inbox('m1')).toMatchObject({ sorting: true })
    expect(cloud.pushes).toHaveLength(0)

    me.added = []
    await check(T0 + 20 * MIN)
    expect(inbox('m1')).toMatchObject({ triage: { folder: 'Hackathons' } })
    expect(inbox('m1')!.sorting).toBeUndefined()
    expect(cloud.pushes).toHaveLength(1)
  })

  it('shows mail on the rules’ reading when the model is down, and tries again', async () => {
    await connect(ME, 'owner', fixture())
    await check(T0)
    const me = cloud.accounts.get(ME)!
    me.added = [{ id: 'm1' }]
    me.messages = { m1: { id: 'm1', from: 'prof@college.edu', subject: 'Assignment 3 due tomorrow', body: 'Submit assignment 3, due tomorrow.', internalDate: T0 + MIN } }
    let answering = false
    cloud.triage = async (prompt) => (answering ? model(prompt) : null)

    await check(T0 + 10 * MIN)
    expect(inbox('m1')!.sorting).toBeUndefined()
    expect(inbox('m1')!.triage).toBeUndefined()
    expect(inbox('m1')!.reading.kind).toBe('deadline')

    answering = true
    me.added = []
    await check(T0 + 20 * MIN)
    expect(inbox('m1')!.triage).toBeDefined()
  })

  it('never reads a mailbox switched off, and starts afresh when it is switched back on', async () => {
    await connect(ME, 'owner', fixture())
    await check(T0)
    const row = (await store.account(UID, ME))!
    await store.putAccount({ ...row, watchMail: false })
    const me = cloud.accounts.get(ME)!
    me.added = [{ id: 'm1' }]
    me.messages = { m1: { id: 'm1', from: 'a@b.com', subject: 'Hello', internalDate: T0 + MIN } }
    await check(T0 + 10 * MIN)
    expect(fetched('gmail.googleapis.com')).toBe(1)

    await store.putAccount({ ...row, watchMail: true })
    await check(T0 + 20 * MIN)
    // Back on: a new starting point, and what arrived while it was off is not replayed.
    expect(fetched('/profile')).toBe(2)
    expect(inbox('m1')).toBeUndefined()
  })

  it('carries on with the other accounts when Google has signed one out', async () => {
    await connect(ME, 'owner', fixture())
    await connect(COLLEGE, 'source', fixture({ refresh: 'revoked' }))
    cloud.accounts.get(COLLEGE)!.refresh = 'something-else'
    const result = await check(T0)
    expect(result.errors.join()).toMatch(/signed Cairn out of me@college.edu/)
    expect((await store.account(UID, COLLEGE))!.problem).toMatch(/Connect it again on your phone/)
    expect(cloud.docs.get(`users/${UID}/settings/accounts`)).toMatchObject({ accounts: [{ email: ME }, { email: COLLEGE, problem: expect.stringMatching(/signed Cairn out/) }] })
    expect(fetched('/profile')).toBe(1)
  })

  it('does nothing at all for someone with nothing to read and no phone to tell', async () => {
    await connect(ME, 'owner', fixture())
    const row = (await store.account(UID, ME))!
    await store.putAccount({ ...row, watchMail: false, watchClassroom: false })
    await store.deletePush('push-token-0123456789abcdef')
    expect(await check(T0)).toMatchObject({ found: 0, errors: [] })
    expect(cloud.calls).toHaveLength(0)
  })

  it('does not run twice at once', async () => {
    await connect(ME, 'owner', fixture())
    await store.claim(UID, T0 + 5 * MIN, T0)
    expect(await check(T0)).toMatchObject({ busy: true })
  })
})

describe('the day’s notifications', () => {
  it('says what is due tomorrow at eight in the evening, on the person’s clock, once', async () => {
    await connect(ME, 'owner', fixture())
    cloud.docs.set(`users/${UID}/reminders/r1`, {
      id: 'r1',
      userId: UID,
      title: 'Lab 4',
      // 23:59 tomorrow in Kolkata.
      dueAt: Date.UTC(2026, 9, 28, 18, 29),
      allDay: false,
      status: 'pending',
      priority: 'normal',
      tags: [],
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    })
    // 19:55 in Kolkata: not yet.
    await check(Date.UTC(2026, 9, 27, 14, 25))
    expect(cloud.pushes).toHaveLength(0)
    // 20:05.
    await check(Date.UTC(2026, 9, 27, 14, 35))
    expect(cloud.pushes).toHaveLength(1)
    expect(cloud.pushes[0]).toMatchObject({ notification: { title: 'Due tomorrow', body: 'Lab 4 at 11:59 pm' }, data: { kind: 'task', id: 'r1' } })
    await check(Date.UTC(2026, 9, 27, 14, 45))
    expect(cloud.pushes).toHaveLength(1)
  })

  it('sums the day up at eight in the morning', async () => {
    await connect(ME, 'owner', fixture())
    cloud.docs.set(`users/${UID}/reminders/r1`, {
      id: 'r1',
      userId: UID,
      title: 'Lab 4',
      dueAt: Date.UTC(2026, 9, 28, 18, 29),
      allDay: false,
      status: 'pending',
      priority: 'normal',
      tags: [],
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
    })
    // 08:05 on the 28th in Kolkata; the 07:00 "due today" is still within its window too.
    await check(Date.UTC(2026, 9, 28, 2, 35))
    const titles = cloud.pushes.map((p) => (p.notification as { title: string }).title)
    expect(titles).toEqual(['Due today', 'Today'])
    expect(cloud.pushes[1]).toMatchObject({ notification: { body: '1 due today\nLab 4 at 11:59 pm' }, data: { kind: 'today' } })
  })
})
