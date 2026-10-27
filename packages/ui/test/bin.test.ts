import { createNote, DAY, deleteNote, purgeNote } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { binCountdown, planDriveTrash, purgeWarning, recycleBin } from '../src'

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

  it('leaves out notes deleted forever', () => {
    const gone = purgeNote(deleteNote(note('Gone'), NOW - DAY), NOW)
    expect(recycleBin([gone, deleteNote(note('Kept'), NOW - DAY)], NOW).map((e) => e.note.title)).toEqual(['Kept'])
  })

  it('asks before deleting anything forever', () => {
    expect(purgeWarning(1).confirm).toBe('Delete forever')
    expect(purgeWarning(4).message).toMatch(/^All 4 notes/)
  })
})

describe('deleting forever while a phone was offline', () => {
  const photo = { id: 'p', kind: 'image' as const, mime: 'image/jpeg', createdAt: NOW, driveFileId: 'd-p' }
  const withPhoto = createNote({ body: '\uFFFCp', attachments: [photo] }, { userId: 'u', now: NOW - DAY })

  it('leaves the photos in Drive\'s trash and never brings them back', () => {
    // The phone had sent the photo and trashed it with the bin; then the laptop purged the note.
    const marker = purgeNote(deleteNote(withPhoto, NOW - 1000), NOW)
    expect(planDriveTrash([marker], { p: 'd-p' }, new Set(['d-p']))).toEqual({ trash: [], restore: [], forget: ['d-p'] })
  })

  it('trashes the photos of a note purged before this phone saw it binned', () => {
    // Offline the whole time: the phone still holds the note live when the marker arrives.
    const marker = purgeNote(deleteNote(withPhoto, NOW - 1000), NOW)
    expect(planDriveTrash([marker], { p: 'd-p' }, new Set()).trash).toEqual(['d-p'])
  })
})
