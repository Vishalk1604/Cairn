import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, updateDoc, type Firestore } from 'firebase/firestore'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// These run against the Firestore emulator, which `pnpm test:rules` starts.
// The point is to prove the isolation rather than to trust it: one user must
// never be able to touch another's data, however the request is shaped.

let env: RulesTestEnvironment

const ME = 'me'
const SOMEONE_ELSE = 'someone-else'

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-cairn',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => env?.cleanup())
beforeEach(async () => env.clearFirestore())

const mine = () => env.authenticatedContext(ME).firestore()
const theirs = () => env.authenticatedContext(SOMEONE_ELSE).firestore()
const strangers = () => env.unauthenticatedContext().firestore()

const note = (id: string, userId = ME, extra: Record<string, unknown> = {}) => ({
  id,
  userId,
  title: 'Lecture notes',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  tags: ['os'],
  pinned: false,
  source: 'manual',
  ...extra,
})

const reminder = (id: string, userId = ME, extra: Record<string, unknown> = {}) => ({
  id,
  userId,
  title: 'Submit assignment',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  dueAt: 1_700_100_000_000,
  allDay: false,
  status: 'pending',
  priority: 'normal',
  tags: [],
  source: 'manual',
  ...extra,
})

const noteAt = (db: Firestore, userId: string, id: string) => doc(db, 'users', userId, 'notes', id)
const reminderAt = (db: Firestore, userId: string, id: string) => doc(db, 'users', userId, 'reminders', id)

describe('the owner', () => {
  it('can write and read back their own notes and reminders', async () => {
    await assertSucceeds(setDoc(noteAt(mine(), ME, 'n1'), note('n1')))
    await assertSucceeds(setDoc(reminderAt(mine(), ME, 'r1'), reminder('r1')))
    await assertSucceeds(getDoc(noteAt(mine(), ME, 'n1')))
  })

  it('can tombstone and hard-delete their own', async () => {
    await assertSucceeds(setDoc(noteAt(mine(), ME, 'n1'), note('n1')))
    await assertSucceeds(setDoc(noteAt(mine(), ME, 'n1'), note('n1', ME, { deletedAt: 1_700_000_001_000 })))
    await assertSucceeds(deleteDoc(noteAt(mine(), ME, 'n1')))
  })

  it('can keep its device registration and widget summary', async () => {
    await assertSucceeds(setDoc(doc(mine(), 'users', ME, 'devices', 'laptop'), { token: 'abc', seenAt: 1 }))
    await assertSucceeds(setDoc(doc(mine(), 'users', ME, 'summary', 'today'), { items: [], generatedAt: 1 }))
  })

  it('can keep its own preferences', async () => {
    await assertSucceeds(setDoc(doc(mine(), 'users', ME, 'preferences', 'app'), { pinnedTags: ['gym'], theme: 'dark' }))
    await assertSucceeds(getDoc(doc(mine(), 'users', ME, 'preferences', 'app')))
  })
})

describe('everyone else', () => {
  it('cannot read or write another user’s preferences', async () => {
    await assertFails(setDoc(doc(theirs(), 'users', ME, 'preferences', 'app'), { theme: 'dark' }))
    await assertFails(getDoc(doc(theirs(), 'users', ME, 'preferences', 'app')))
  })

  it('cannot read or write another user’s documents', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(doc(admin.firestore(), 'users', ME, 'notes', 'n1'), note('n1'))
    })
    await assertFails(getDoc(noteAt(theirs(), ME, 'n1')))
    await assertFails(setDoc(noteAt(theirs(), ME, 'n1'), note('n1')))
    await assertFails(deleteDoc(noteAt(theirs(), ME, 'n1')))
  })

  it('cannot plant a document in someone else’s subtree by claiming to be them', async () => {
    // The path says one user, the payload says another: both must agree.
    await assertFails(setDoc(noteAt(theirs(), ME, 'n2'), note('n2', ME)))
    await assertFails(setDoc(noteAt(theirs(), SOMEONE_ELSE, 'n3'), note('n3', ME)))
  })

  it('shuts out anyone not signed in', async () => {
    await assertFails(getDoc(noteAt(strangers(), ME, 'n1')))
    await assertFails(setDoc(noteAt(strangers(), ME, 'n1'), note('n1')))
  })
})

describe('document shape', () => {
  it('rejects a document whose id does not match its path', async () => {
    await assertFails(setDoc(noteAt(mine(), ME, 'n1'), note('a-different-id')))
  })

  it('rejects missing or mistyped fields', async () => {
    const { title: _dropped, ...titleless } = note('n1')
    await assertFails(setDoc(noteAt(mine(), ME, 'n1'), titleless))
    await assertFails(setDoc(noteAt(mine(), ME, 'n1'), note('n1', ME, { title: 42 })))
    await assertFails(setDoc(noteAt(mine(), ME, 'n1'), note('n1', ME, { pinned: 'yes' })))
    await assertFails(setDoc(noteAt(mine(), ME, 'n1'), note('n1', ME, { updatedAt: 'now' })))
  })

  it('rejects a reminder with a status or priority it does not understand', async () => {
    await assertFails(setDoc(reminderAt(mine(), ME, 'r1'), reminder('r1', ME, { status: 'whatever' })))
    await assertFails(setDoc(reminderAt(mine(), ME, 'r1'), reminder('r1', ME, { priority: 'urgent' })))
    await assertFails(setDoc(reminderAt(mine(), ME, 'r1'), reminder('r1', ME, { dueAt: 'friday' })))
  })

  it('accepts every status and priority the app actually uses', async () => {
    for (const status of ['pending', 'snoozed', 'done']) {
      await assertSucceeds(setDoc(reminderAt(mine(), ME, `r-${status}`), reminder(`r-${status}`, ME, { status })))
    }
    for (const priority of ['low', 'normal', 'high']) {
      await assertSucceeds(setDoc(reminderAt(mine(), ME, `p-${priority}`), reminder(`p-${priority}`, ME, { priority })))
    }
  })
})

// A made-up key of the right shape. Never a real one.
const FAKE_KEY = `nvapi-${'0'.repeat(32)}`

const record = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  account: 'me@gmail.com',
  from: 'Devfolio <hello@devfolio.co>',
  subject: 'HackMIT registrations close Friday',
  snippet: 'Register before Friday',
  receivedAt: 1_700_000_000_000,
  foundAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  reading: { kind: 'deadline', title: 'HackMIT', allDay: false },
  ...extra,
})

const inboxAt = (db: Firestore, userId: string, id: string) => doc(db, 'users', userId, 'inbox', id)
const settingAt = (db: Firestore, userId: string, name: string) => doc(db, 'users', userId, 'settings', name)

describe('the shared inbox', () => {
  it('lets the owner keep and change their own records', async () => {
    await assertSucceeds(setDoc(inboxAt(mine(), ME, 'm1'), record('m1')))
    await assertSucceeds(updateDoc(inboxAt(mine(), ME, 'm1'), { read: true, updatedAt: 1_700_000_000_001 }))
    await assertSucceeds(getDoc(inboxAt(mine(), ME, 'm1')))
    await assertSucceeds(deleteDoc(inboxAt(mine(), ME, 'm1')))
  })

  it('refuses a body, or a preview long enough to be one', async () => {
    await assertFails(setDoc(inboxAt(mine(), ME, 'm1'), record('m1', { text: 'The whole email' })))
    await assertFails(setDoc(inboxAt(mine(), ME, 'm1'), record('m1', { body: 'The whole email' })))
    await assertFails(setDoc(inboxAt(mine(), ME, 'm1'), record('m1', { snippet: 'x'.repeat(401) })))
  })

  it('refuses a record filed under the wrong id or missing its times', async () => {
    await assertFails(setDoc(inboxAt(mine(), ME, 'm1'), record('m2')))
    await assertFails(setDoc(inboxAt(mine(), ME, 'm1'), record('m1', { receivedAt: 'yesterday' })))
  })

  it('is closed to everyone else', async () => {
    await env.withSecurityRulesDisabled(async (admin) => {
      await setDoc(inboxAt(admin.firestore(), ME, 'm1'), record('m1'))
    })
    await assertFails(getDoc(inboxAt(theirs(), ME, 'm1')))
    await assertFails(setDoc(inboxAt(theirs(), ME, 'm1'), record('m1')))
    await assertFails(getDoc(inboxAt(strangers(), ME, 'm1')))
  })
})

describe('shared settings', () => {
  it('lets the owner keep the accounts list, the reader claim and the inbox rules', async () => {
    await assertSucceeds(
      setDoc(settingAt(mine(), ME, 'accounts'), { phone: { accounts: [{ sub: 's', email: 'me@gmail.com', role: 'owner', services: ['mail'] }], updatedAt: 1 } }),
    )
    await assertSucceeds(setDoc(settingAt(mine(), ME, 'reader'), { lease: { deviceId: 'pc', kind: 'desktop', heartbeatAt: 1 }, cursors: {} }))
    await assertSucceeds(setDoc(settingAt(mine(), ME, 'inbox'), { senders: { 'a@b.com': 'important' }, autoTasks: true, updatedAt: 1 }))
    await assertSucceeds(getDoc(settingAt(mine(), ME, 'reader')))
  })

  it('keeps the AI key for its owner alone, and only a key', async () => {
    await assertSucceeds(setDoc(settingAt(mine(), ME, 'ai'), { key: FAKE_KEY, updatedAt: 1 }))
    await assertSucceeds(getDoc(settingAt(mine(), ME, 'ai')))
    await assertFails(getDoc(settingAt(theirs(), ME, 'ai')))
    await assertFails(setDoc(settingAt(theirs(), ME, 'ai'), { key: FAKE_KEY, updatedAt: 1 }))
    await assertFails(setDoc(settingAt(mine(), ME, 'ai'), { key: 'not a key', updatedAt: 1 }))
    await assertFails(setDoc(settingAt(mine(), ME, 'ai'), { updatedAt: 1 }))
    await assertSucceeds(deleteDoc(settingAt(mine(), ME, 'ai')))
  })

  it('never takes a Google token', async () => {
    await assertFails(setDoc(settingAt(mine(), ME, 'accounts'), { refreshToken: 'abc' }))
  })

  it('takes no settings document it does not know', async () => {
    await assertFails(setDoc(settingAt(mine(), ME, 'anything'), { a: 1 }))
    await assertFails(getDoc(settingAt(mine(), ME, 'anything')))
  })

  it('is closed to everyone else', async () => {
    await assertFails(setDoc(settingAt(theirs(), ME, 'inbox'), { autoTasks: true }))
    await assertFails(getDoc(settingAt(strangers(), ME, 'reader')))
  })
})

describe('anything else in the database', () => {
  it('is denied, even to a signed-in user', async () => {
    await assertFails(setDoc(doc(mine(), 'notes', 'loose'), note('loose')))
    await assertFails(setDoc(doc(mine(), 'users', ME), { title: 'profile' }))
    await assertFails(setDoc(doc(mine(), 'users', ME, 'secrets', 'token'), { value: 'x' }))
    await assertFails(getDoc(doc(mine(), 'config', 'app')))
  })
})

describe('the emulator itself', () => {
  it('is actually enforcing rules, not waving everything through', async () => {
    // Guards against a misconfigured harness making every assertion vacuous.
    await expect(assertFails(setDoc(noteAt(mine(), ME, 'ok'), note('ok')))).rejects.toThrow()
  })
})
