import { describe, expect, it } from 'vitest'
import { createNote, DAY, deleteNote, markerLine, newerOf, purgeableTombstones, purgeNote, revive, updateNote, type Attachment } from '../src'
import { ctx, NOW } from './helpers'

const photo = (id: string): Attachment => ({ id, kind: 'image', mime: 'image/jpeg', createdAt: NOW })

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

  it('is a note even when it is only a photo', () => {
    const note = createNote({ body: markerLine('a1'), attachments: [photo('a1')] }, ctx)
    expect(note.attachments).toEqual([photo('a1')])
  })

  it('forgets a photo once the writing stops pointing at it', () => {
    const note = createNote({ title: 'n', body: markerLine('a1'), attachments: [photo('a1')] }, ctx)
    // The editor removed the marker line; the file should go with it.
    expect(updateNote(note, { body: 'just words' }, NOW + 1).attachments).toBeUndefined()
  })

  it('refuses a note emptied of everything', () => {
    const note = createNote({ body: markerLine('a1'), attachments: [photo('a1')] }, ctx)
    expect(() => updateNote(note, { body: '' }, NOW + 1)).toThrow()
  })

  it('tombstones on delete', () => {
    expect(deleteNote(createNote({ title: 'n' }, ctx), NOW + 3).deletedAt).toBe(NOW + 3)
  })

  it('deletes forever by leaving only a marker with no content in it', () => {
    const note = createNote({ title: 'Diary', body: `secret\n${markerLine('p1')}`, attachments: [photo('p1')], tags: ['me'] }, ctx)
    const binned = deleteNote(updateNote(note, { body: 'secret 2' }, NOW + 1), NOW + 2)
    const marker = purgeNote(binned, NOW + 3)
    expect(marker).toEqual({
      id: note.id,
      userId: note.userId,
      createdAt: note.createdAt,
      updatedAt: NOW + 3,
      deletedAt: NOW + 2,
      purgedAt: NOW + 3,
      title: '',
      tags: [],
      pinned: false,
      source: 'manual',
    })
    expect(purgeNote(marker, NOW + 9)).toBe(marker)
    // Never back out of the bin once it is gone.
    expect(revive(marker, NOW + 10)).toBe(marker)
  })

  it('keeps a purged note gone against a later edit made offline', () => {
    const note = createNote({ title: 'n', body: 'v1' }, ctx)
    const marker = purgeNote(deleteNote(note, NOW + 5), NOW + 6)
    // A phone with its clock an hour ahead edited it while offline.
    const offlineEdit = updateNote(note, { body: 'v2' }, NOW + 3_600_000)
    expect(newerOf(marker, offlineEdit)).toBe(marker)
    expect(newerOf(offlineEdit, marker)).toBe(marker)
  })

  it('keeps the marker for the bin\'s thirty days from the purge, not from the deletion', () => {
    const note = createNote({ title: 'n' }, ctx)
    const marker = purgeNote(deleteNote(note, NOW), NOW + 25 * DAY)
    expect(purgeableTombstones([marker], NOW + 31 * DAY)).toEqual([])
    expect(purgeableTombstones([marker], NOW + 56 * DAY)).toEqual([marker])
  })
})
