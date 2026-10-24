import { createNote, deleteNote, updateNote, type Note, type NoteChanges, type NoteInput } from '@cairn/core'
import { MemoryKeyValueStore } from '@cairn/sync'
import { describe, expect, it, vi } from 'vitest'
import { keepNoteDraft, NOTE_DRAFT_KEY, readNoteDraft, recoverNoteDraft } from '../src'

const values = (title: string, body = '') => ({ title, body, tags: '', pinned: false })

function setUp(existing: Note[] = []) {
  let clock = 10_000
  const notes = new Map(existing.map((n) => [n.id, n]))
  const addNote = vi.fn(async (input: NoteInput) => createNote(input, { userId: 'u', now: clock++ }))
  const saveNote = vi.fn(async (n: Note, changes: NoteChanges) => updateNote(n, changes, clock++))
  return { store: new MemoryKeyValueStore(), notes: { get: async (id: string) => notes.get(id) }, actions: { addNote, saveNote } }
}

describe('note drafts', () => {
  it('saves a draft for a note never saved, then forgets it', async () => {
    const { store, notes, actions } = setUp()
    await keepNoteDraft(store, { values: values('Half a thought', 'more'), at: 5_000 })
    const saved = await recoverNoteDraft(store, notes, actions)
    expect(saved).toMatchObject({ title: 'Half a thought', body: 'more' })
    expect(actions.addNote).toHaveBeenCalledTimes(1)
    expect(readNoteDraft(await store.get(NOTE_DRAFT_KEY))).toBeNull()
    expect(await recoverNoteDraft(store, notes, actions)).toBeUndefined()
    expect(actions.addNote).toHaveBeenCalledTimes(1)
  })

  it('applies a draft to the note it was for', async () => {
    const note = createNote({ title: 'Lab', body: 'old' }, { userId: 'u', now: 1_000 })
    const { store, notes, actions } = setUp([note])
    await keepNoteDraft(store, { noteId: note.id, values: values('Lab', 'new words'), at: 2_000 })
    const saved = await recoverNoteDraft(store, notes, actions)
    expect(saved).toMatchObject({ id: note.id, body: 'new words' })
    expect(actions.addNote).not.toHaveBeenCalled()
  })

  it('drops a draft overtaken by a later edit, or for a deleted note', async () => {
    const edited = createNote({ title: 'Edited', body: 'elsewhere' }, { userId: 'u', now: 3_000 })
    const deleted = deleteNote(createNote({ title: 'Gone' }, { userId: 'u', now: 1_000 }), 1_500)
    for (const [note, at] of [[edited, 2_000], [deleted, 2_000]] as const) {
      const { store, notes, actions } = setUp([note])
      await keepNoteDraft(store, { noteId: note.id, values: values('Draft', 'stale'), at })
      expect(await recoverNoteDraft(store, notes, actions)).toBeUndefined()
      expect(actions.saveNote).not.toHaveBeenCalled()
      expect(readNoteDraft(await store.get(NOTE_DRAFT_KEY))).toBeNull()
    }
  })

  it('skips a draft that would change nothing, such as one written just after the note was saved', async () => {
    const note = createNote({ title: 'Lab', body: 'words', tags: ['dbms'] }, { userId: 'u', now: 1_000 })
    const { store, notes, actions } = setUp([note])
    await keepNoteDraft(store, { noteId: note.id, values: { title: ' Lab ', body: 'words', tags: 'dbms', pinned: false }, at: 2_000 })
    expect(await recoverNoteDraft(store, notes, actions)).toBeUndefined()
    expect(actions.saveNote).not.toHaveBeenCalled()
  })

  it('reads damaged or empty drafts as none', () => {
    expect(readNoteDraft('')).toBeNull()
    expect(readNoteDraft('{not json')).toBeNull()
    expect(readNoteDraft('{"values":{}}')).toBeNull()
  })
})
