import { describe, expect, it } from 'vitest'
import { createNote, deleteNote, updateNote } from '../src'
import { ctx, NOW } from './helpers'

describe('notes', () => {
  it('creates with defaults', () => {
    const note = createNote({ title: '  Lecture   notes ', tags: ['#OS'] }, ctx)
    expect(note).toMatchObject({ title: 'Lecture notes', tags: ['os'], pinned: false, source: 'manual' })
    expect(Object.values(note)).not.toContain(undefined)
  })

  it('allows a body without a title, but not nothing at all', () => {
    expect(createNote({ body: 'just text' }, ctx).title).toBe('')
    expect(() => createNote({ title: ' ', body: '  ' }, ctx)).toThrow()
  })

  it('keeps the previous body so a clobbered edit is recoverable', () => {
    const note = createNote({ title: 'n', body: 'v1' }, ctx)
    const v2 = updateNote(note, { body: 'v2' }, NOW + 1)
    expect(v2).toMatchObject({ body: 'v2', bodyPrev: 'v1', updatedAt: NOW + 1 })
    expect(updateNote(v2, { pinned: true }, NOW + 2)).toMatchObject({ body: 'v2', bodyPrev: 'v1', pinned: true })
  })

  it('tombstones on delete', () => {
    expect(deleteNote(createNote({ title: 'n' }, ctx), NOW + 3).deletedAt).toBe(NOW + 3)
  })
})
