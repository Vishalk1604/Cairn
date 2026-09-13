import { createNote, updateNote, type Note, type NoteChanges, type NoteInput } from '@cairn/core'
import { describe, expect, it, vi } from 'vitest'
import { createNoteSaveQueue } from '../src'

const values = (title: string, body = '') => ({ title, body, tags: '', pinned: false })

function fakeActions() {
  let clock = 1_000
  const addNote = vi.fn(async (input: NoteInput) => createNote(input, { userId: 'u', now: clock++ }))
  const saveNote = vi.fn(async (n: Note, changes: NoteChanges) => updateNote(n, changes, clock++))
  return { addNote, saveNote }
}

describe('createNoteSaveQueue', () => {
  it('creates a new note once, even when saves overlap, with the latest values', async () => {
    const actions = fakeActions()
    const queue = createNoteSaveQueue(actions)
    queue.change(values('Draft'))
    const first = queue.save()
    queue.change(values('Draft 2', 'body'))
    await Promise.all([first, queue.save(), queue.save()])

    expect(actions.addNote).toHaveBeenCalledTimes(1)
    expect(actions.saveNote).not.toHaveBeenCalled()
    expect(queue.saved).toMatchObject({ title: 'Draft 2', body: 'body' })
    expect(queue.dirty).toBe(false)

    queue.change(values('Draft 3', 'body'))
    await queue.save()
    expect(actions.addNote).toHaveBeenCalledTimes(1)
    expect(actions.saveNote).toHaveBeenCalledTimes(1)
    expect(queue.saved).toMatchObject({ title: 'Draft 3' })
  })

  it('does nothing without changes, and never creates an empty note', async () => {
    const actions = fakeActions()
    const queue = createNoteSaveQueue(actions)
    await queue.save()
    queue.change(values('  ', ' '))
    await queue.save()
    expect(actions.addNote).not.toHaveBeenCalled()
  })

  it('keeps a failed save pending and retries it', async () => {
    const actions = fakeActions()
    actions.addNote.mockResolvedValueOnce(undefined as unknown as Note)
    const queue = createNoteSaveQueue(actions)
    queue.change(values('Retry me'))
    await queue.save()
    expect(queue.dirty).toBe(true)
    await queue.save()
    expect(queue.saved?.title).toBe('Retry me')
    expect(queue.dirty).toBe(false)
  })

  it('edits an existing note in place', async () => {
    const actions = fakeActions()
    const existing = createNote({ title: 'Old', body: 'v1' }, { userId: 'u', now: 1 })
    const queue = createNoteSaveQueue(actions, existing)
    queue.change({ title: 'Old', body: 'v2', tags: 'os, lecture', pinned: true })
    await queue.save()
    expect(queue.saved).toMatchObject({ id: existing.id, body: 'v2', bodyPrev: 'v1', tags: ['os', 'lecture'], pinned: true })
  })
})
