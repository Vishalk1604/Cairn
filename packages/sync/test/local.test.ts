import { createNote, createReminder, DAY, type Note, type Reminder } from '@cairn/core'
import { describe, expect, it, vi } from 'vitest'
import {
  LocalRepository,
  matchesNoteQuery,
  matchesReminderQuery,
  MemoryKeyValueStore,
  openLocalRepositories,
  type KeyValueStore,
  type NoteQuery,
  type ReminderQuery,
} from '../src'

const NOW = Date.UTC(2026, 8, 14, 14)
const ctx = { userId: 'u1', now: NOW }

const reminder = (title: string, dueAt = NOW + DAY, extra: Partial<Reminder> = {}): Reminder => ({
  ...createReminder({ title, dueAt }, ctx),
  ...extra,
})
const note = (title: string, extra: Partial<Note> = {}): Note => ({ ...createNote({ title }, ctx), ...extra })
const reminders = () => new LocalRepository<Reminder, ReminderQuery>(matchesReminderQuery)
const notes = () => new LocalRepository<Note, NoteQuery>(matchesNoteQuery)

describe('queries', () => {
  it('filters reminders by status and due date, hiding tombstones', async () => {
    const repo = reminders()
    const soon = reminder('soon', NOW + 1000)
    const later = reminder('later', NOW + 10 * DAY)
    const done = reminder('done', NOW + 1000, { status: 'done' })
    const gone = reminder('gone', NOW + 1000, { deletedAt: NOW })
    await repo.upsertMany([soon, later, done, gone])

    const titles = async (q: ReminderQuery) => (await repo.list(q)).map((r) => r.title)
    expect(await titles({})).toEqual(['soon', 'later', 'done'])
    expect(await titles({ status: ['pending'], dueBefore: NOW + 7 * DAY })).toEqual(['soon'])
    expect(await titles({ includeDeleted: true })).toEqual(['soon', 'later', 'done', 'gone'])
  })

  it('filters notes by pin and last update', async () => {
    const repo = notes()
    await repo.upsertMany([note('pinned', { pinned: true }), note('fresh', { updatedAt: NOW + 5 }), note('stale')])
    expect((await repo.list({ pinned: true })).map((n) => n.title)).toEqual(['pinned'])
    expect((await repo.list({ updatedAfter: NOW })).map((n) => n.title)).toEqual(['fresh'])
  })
})

describe('writes', () => {
  it('ignores a write older than what is stored', async () => {
    const repo = reminders()
    const r = reminder('v1')
    await repo.upsert({ ...r, title: 'v2', updatedAt: NOW + 10 })
    await repo.upsert({ ...r, title: 'stale', updatedAt: NOW + 5 })
    expect((await repo.get(r.id))?.title).toBe('v2')
  })

  it('treats an identical write as a no-op', async () => {
    const repo = reminders()
    const r = reminder('same')
    await repo.upsert(r)
    const before = repo.stats().writes
    await repo.upsert({ ...r })
    expect(repo.stats().writes).toBe(before)
  })

  it('removes by tombstoning, and purges old tombstones', async () => {
    const repo = reminders()
    const r = reminder('bye')
    await repo.upsert(r)
    await repo.remove(r.id, NOW + 1)
    expect(await repo.get(r.id)).toMatchObject({ deletedAt: NOW + 1, updatedAt: NOW + 1 })
    expect(await repo.list()).toEqual([])

    expect(await repo.purgeTombstones(NOW + 29 * DAY)).toBe(0)
    expect(await repo.purgeTombstones(NOW + 31 * DAY)).toBe(1)
    expect(await repo.get(r.id)).toBeUndefined()
  })
})

describe('observe', () => {
  it('emits right away, then on changes to the matching set only', async () => {
    const repo = notes()
    const seen: string[][] = []
    const stop = repo.observe({ pinned: true }, (items) => seen.push(items.map((n) => n.title)))
    expect(seen).toEqual([[]])

    await repo.upsert(note('unpinned'))
    expect(seen).toHaveLength(1)

    const pinned = note('pinned', { pinned: true })
    await repo.upsert(pinned)
    await repo.upsert({ ...pinned, title: 'renamed', updatedAt: NOW + 1 })
    expect(seen).toEqual([[], ['pinned'], ['renamed']])

    stop()
    await repo.upsert({ ...pinned, title: 'after stop', updatedAt: NOW + 2 })
    expect(seen).toHaveLength(3)
  })

  it('emits once for a batch', async () => {
    const repo = reminders()
    const listener = vi.fn()
    repo.observe({}, listener)
    await repo.upsertMany([reminder('a'), reminder('b'), reminder('c')])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('counts document reads and writes', async () => {
    const repo = reminders()
    await repo.upsertMany([reminder('a'), reminder('b')])
    repo.observe({}, () => {})
    await repo.list()
    expect(repo.stats()).toEqual({ reads: 4, writes: 2 })
  })
})

describe('persistence', () => {
  it('survives a restart', async () => {
    const store = new MemoryKeyValueStore()
    const first = await openLocalRepositories(store)
    const r = reminder('persisted')
    const n = note('kept')
    await first.reminders.upsert(r)
    await first.notes.upsert(n)

    const second = await openLocalRepositories(store)
    expect(await second.reminders.get(r.id)).toEqual(r)
    expect(await second.notes.get(n.id)).toEqual(n)
    expect(JSON.parse(store.data.get('cairn.reminders')!)).toMatchObject({ version: 1 })
  })

  it('coalesces a burst of writes into few saves', async () => {
    const store = new MemoryKeyValueStore()
    const set = vi.spyOn(store, 'set')
    const { reminders: repo } = await openLocalRepositories(store)
    await Promise.all(Array.from({ length: 20 }, (_, i) => repo.upsert(reminder(`r${i}`))))
    expect(set.mock.calls.length).toBeLessThanOrEqual(2)
    const saved = JSON.parse(store.data.get('cairn.reminders')!) as { items: unknown[] }
    expect(saved.items).toHaveLength(20)
  })

  it('backs up unreadable data instead of overwriting it', async () => {
    const store = new MemoryKeyValueStore()
    store.data.set('cairn.notes', '{not json')
    const onError = vi.fn()
    const { notes: repo } = await openLocalRepositories(store, { onError })

    expect(onError).toHaveBeenCalledOnce()
    const backup = [...store.data.keys()].find((k) => k.startsWith('cairn.notes.unreadable-'))
    expect(backup && store.data.get(backup)).toBe('{not json')
    await repo.upsert(note('fresh start'))
    expect(await repo.list()).toHaveLength(1)
  })

  it('reports a failed save to the writer', async () => {
    const broken: KeyValueStore = { get: async () => null, set: async () => Promise.reject(new Error('disk full')) }
    const { reminders: repo } = await openLocalRepositories(broken)
    await expect(repo.upsert(reminder('x'))).rejects.toThrow('disk full')
  })
})
