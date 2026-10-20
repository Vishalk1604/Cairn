import { describe, expect, it } from 'vitest'
import { noteCharacterCount, noteTimestamp } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('note metadata', () => {
  it('reads like a date and a time', () => {
    expect(noteTimestamp(at(2026, 10, 20, 22, 22), { locale: 'en-GB' }).replace(/ /g, ' ')).toBe('20 October 22:22')
    expect(noteTimestamp(at(2026, 10, 20, 22, 22), { locale: 'en-US' }).replace(/ /g, ' ')).toBe('October 20 10:22 PM')
  })

  it('counts the note, title included, and gets the plural right', () => {
    expect(noteCharacterCount('', '')).toBe('0 characters')
    expect(noteCharacterCount('a', '')).toBe('1 character')
    expect(noteCharacterCount('ab', 'cde')).toBe('5 characters')
  })

  it('counts an emoji as one character, not two', () => {
    expect(noteCharacterCount('', '👍')).toBe('1 character')
  })
})
