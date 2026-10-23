import { markerLine, type Attachment } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { noteCharacterCount, noteHeading, noteLines, noteTimestamp } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

const media = (id: string, kind: Attachment['kind']): Attachment => ({ id, kind, mime: kind === 'image' ? 'image/jpeg' : 'audio/mp4', createdAt: 0 })

describe('note metadata', () => {
  it('reads like a date and a time', () => {
    expect(noteTimestamp(at(2026, 10, 20, 22, 22), { locale: 'en-GB' }).replace(/ /g, ' ')).toBe('20 October 22:22')
    expect(noteTimestamp(at(2026, 10, 20, 22, 22), { locale: 'en-US' }).replace(/ /g, ' ')).toBe('October 20 10:22 PM')
  })

  it('counts the note, title included, and gets the plural right', () => {
    expect(noteCharacterCount('', '')).toBe('0 characters')
    expect(noteCharacterCount('a', '')).toBe('1 character')
    expect(noteCharacterCount('ab', 'cde')).toBe('5 characters')
  })

  it('counts an emoji as one character, not two', () => {
    expect(noteCharacterCount('', '👍')).toBe('1 character')
  })

  it('does not count a photo as writing', () => {
    expect(noteCharacterCount('', `ab\n${markerLine('a1')}\ncd`)).toBe('5 characters')
  })
})

describe('note previews', () => {
  const body = `${markerLine('p1')}\nfirst line\n\n${markerLine('r1')}\nlast`
  const attachments = [media('p1', 'image'), media('r1', 'audio')]

  it('shows media as labels, never as the marker in the body', () => {
    expect(noteLines({ body, attachments })).toEqual(['[Photo]', 'first line', '[Recording]', 'last'])
  })

  it('labels a file this device has not fetched yet as a photo', () => {
    expect(noteLines({ body: markerLine('x'), attachments: [] })).toEqual(['[Photo]'])
  })

  it('heads a note with its first written line, skipping media', () => {
    expect(noteHeading({ title: '', body })).toBe('first line')
    expect(noteHeading({ title: 'Trip', body })).toBe('Trip')
    expect(noteHeading({ title: '', body: markerLine('p1') })).toBe('Untitled')
  })
})
