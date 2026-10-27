import { createNote, markerLine, splitBody, type Attachment } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { noteFromShare } from '../src'

const photo = (id: string): Attachment => ({ id, kind: 'image', mime: 'image/jpeg', width: 800, height: 600, bytes: 1000 + id.charCodeAt(0), createdAt: 1 })

describe('a share becoming a note', () => {
  it('names a link by the title the browser sent', () => {
    expect(noteFromShare({ text: 'https://example.com/hack', webUrl: 'https://example.com/hack', title: 'HackMIT 2026 — Register' })).toEqual({
      title: 'HackMIT 2026 — Register',
      body: 'https://example.com/hack',
    })
  })

  it('names a link by the words it came with when there is no title', () => {
    expect(noteFromShare({ text: 'Check out this internship: https://jobs.example.com/42', webUrl: 'https://jobs.example.com/42' })).toEqual({
      title: 'Check out this internship',
      body: 'https://jobs.example.com/42',
    })
    expect(noteFromShare({ text: 'https://example.com/a' })).toEqual({ title: 'https://example.com/a', body: 'https://example.com/a' })
  })

  it('keeps the words as well when a title was sent too', () => {
    expect(noteFromShare({ text: 'Due Friday! https://classroom.google.com/c/1', webUrl: 'https://classroom.google.com/c/1', title: 'Lab 4' })).toEqual({
      title: 'Lab 4',
      body: 'Due Friday!\nhttps://classroom.google.com/c/1',
    })
  })

  it('writes plain text in as the note\'s writing', () => {
    expect(noteFromShare({ text: 'Bring lab coats\nMonday 9am' })).toEqual({ title: '', body: 'Bring lab coats\nMonday 9am' })
  })

  it('puts shared photos in as attachments, each on its own line, after any text', () => {
    const images = [photo('a'), photo('b')]
    const input = noteFromShare({ text: 'Whiteboard' }, images)!
    expect(input.body).toBe(`Whiteboard\n${markerLine('a')}\n${markerLine('b')}`)
    const note = createNote(input, { userId: 'u', now: 1 })
    expect(note.attachments?.map((a) => a.id)).toEqual(['a', 'b'])
    expect(splitBody(note.body!, note.attachments).map((b) => b.kind)).toEqual(['text', 'media', 'text', 'media', 'text'])
    // A photo on its own is a note too.
    expect(createNote(noteFromShare({}, [photo('c')])!, { userId: 'u', now: 1 }).attachments).toHaveLength(1)
  })

  it('makes nothing of an empty share', () => {
    expect(noteFromShare({ text: '  ' })).toBeNull()
  })
})
