import { createNote, DAY, deleteNote } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { binCountdown, recycleBin } from '../src'

const NOW = Date.UTC(2026, 9, 23, 12)
const note = (title: string) => createNote({ title }, { userId: 'u', now: NOW - 60 * DAY })

describe('recycleBin', () => {
  it('lists deleted notes newest first, with the days they have left', () => {
    const live = note('Live')
    const older = deleteNote(note('Older'), NOW - 20 * DAY)
    const newer = deleteNote(note('Newer'), NOW - 2 * DAY)
    const expired = deleteNote(note('Expired'), NOW - 31 * DAY)
    const bin = recycleBin([live, older, newer, expired], NOW)
    expect(bin.map((e) => [e.note.title, e.daysLeft])).toEqual([
      ['Newer', 28],
      ['Older', 10],
    ])
  })

  it('says how long is left', () => {
    expect(binCountdown(10)).toBe('Deleted for good in 10 days')
    expect(binCountdown(1)).toBe('Deleted for good within a day')
  })
})
