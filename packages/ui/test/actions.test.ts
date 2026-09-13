import { buildRecurrence, HOUR } from '@cairn/core'
import { MemoryKeyValueStore, openLocalRepositories } from '@cairn/sync'
import { describe, expect, it } from 'vitest'
import { createActions, type Toast } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const NOW = at(2026, 9, 14, 10)

async function setup() {
  const { reminders, notes } = await openLocalRepositories(new MemoryKeyValueStore())
  const toasts: Toast[] = []
  let clock = NOW
  const actions = createActions({ reminders, notes, userId: 'u1', toast: (t) => toasts.push(t), now: () => clock, locale: 'en-US' })
  const lastToast = () => toasts.at(-1)!
  const undo = async () => {
    lastToast().action!.run()
    await Promise.resolve()
  }
  return { reminders, notes, actions, toasts, lastToast, undo, advance: (ms: number) => (clock += ms) }
}

const clean = (s: string) => s.replace(/ /g, ' ')

describe('capture', () => {
  it('creates a reminder from natural language, with undo', async () => {
    const { reminders, actions, lastToast, undo } = await setup()
    const parsed = await actions.capture('submit DBMS assignment friday 6pm #dbms')
    expect(parsed?.kind).toBe('reminder')

    const [r] = await reminders.list()
    expect(r).toMatchObject({ title: 'submit DBMS assignment', dueAt: at(2026, 9, 18, 18), tags: ['dbms'], userId: 'u1' })
    expect(clean(lastToast().message)).toBe('Added “submit DBMS assignment” for Fri 6:00 PM')

    await undo()
    expect(await reminders.list()).toEqual([])
  })

  it('saves a note when there is no date, or when asked to keep the text as-is', async () => {
    const { reminders, notes, actions } = await setup()
    await actions.capture('buy graph paper #stationery')
    await actions.capture('call mom at 5', true)
    expect(await reminders.list()).toEqual([])
    expect((await notes.list()).map((n) => [n.title, n.tags])).toEqual([
      ['buy graph paper', ['stationery']],
      ['call mom at 5', []],
    ])
  })
})

describe('reminder actions', () => {
  it('completes a recurring reminder, and undo restores the occurrence', async () => {
    const { reminders, actions, lastToast, undo, advance } = await setup()
    const dueAt = at(2026, 9, 14, 9)
    const r = (await actions.addReminder({ title: 'Standup', dueAt, rrule: buildRecurrence({ freq: 'daily' }, dueAt) }))!

    await actions.complete(r)
    expect((await reminders.get(r.id))?.dueAt).toBe(at(2026, 9, 15, 9))
    expect(clean(lastToast().message)).toBe('Done for now. Next “Standup” Tomorrow 9:00 AM')

    await undo()
    const restored = (await reminders.get(r.id))!
    expect(restored).toMatchObject({ dueAt, status: 'pending' })
    expect(restored.updatedAt).toBeGreaterThan(r.updatedAt)

    advance(1000)
    await actions.complete(restored)
    expect((await reminders.get(r.id))?.updatedAt).toBe(NOW + 1000)
  })

  it('turns an invalid snooze into an error toast instead of throwing', async () => {
    const { actions, lastToast } = await setup()
    const r = (await actions.addReminder({ title: 'x', dueAt: NOW + HOUR }))!
    await expect(actions.snooze(r, NOW - 1)).resolves.toBeUndefined()
    expect(lastToast()).toMatchObject({ tone: 'error', message: 'Snooze has to end in the future' })
  })

  it('deletes with undo', async () => {
    const { reminders, actions, undo } = await setup()
    const r = (await actions.addReminder({ title: 'Delete me', dueAt: NOW + HOUR }))!
    await actions.removeReminder(r)
    expect(await reminders.list()).toEqual([])
    await undo()
    expect((await reminders.list()).map((x) => x.title)).toEqual(['Delete me'])
  })
})

describe('note actions', () => {
  it('pins, edits and deletes with undo', async () => {
    const { notes, actions, undo } = await setup()
    const n = (await actions.addNote({ title: 'OS lecture', body: 'v1' }))!
    await actions.togglePin(n)
    const edited = (await actions.saveNote((await notes.get(n.id))!, { body: 'v2' }))!
    expect(edited).toMatchObject({ pinned: true, body: 'v2', bodyPrev: 'v1' })

    await actions.removeNote(edited)
    expect(await notes.list()).toEqual([])
    await undo()
    expect(await notes.list()).toHaveLength(1)
  })
})
