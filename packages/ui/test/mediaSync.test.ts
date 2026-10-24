import { createNote, markerLine, type Attachment } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { planDriveTrash, planMediaSync } from '../src'

const ctx = { userId: 'u', now: 1 }
const photo = (id: string, extra: Partial<Attachment> = {}): Attachment => ({ id, kind: 'image', mime: 'image/jpeg', bytes: 100, createdAt: 1, driveFileId: `d-${id}`, ...extra })
const noteWith = (...attachments: Attachment[]) =>
  createNote({ title: 'n', body: attachments.map((a) => markerLine(a.id)).join('\n'), attachments }, ctx)

describe('planMediaSync', () => {
  it('fetches what is missing and leaves what is already whole', () => {
    const plan = planMediaSync([noteWith(photo('a'), photo('b'))], [{ name: 'a.jpg', bytes: 100 }])
    expect(plan.download.map((a) => a.id)).toEqual(['b'])
    expect(plan.remove).toEqual([])
  })

  it('fetches again a file cut short', () => {
    expect(planMediaSync([noteWith(photo('a'))], [{ name: 'a.jpg', bytes: 40 }]).download.map((a) => a.id)).toEqual(['a'])
  })

  it('waits for the phone to upload before fetching', () => {
    expect(planMediaSync([noteWith(photo('a', { driveFileId: undefined }))], []).download).toEqual([])
  })

  it('clears files no note uses, including a note in the trash', () => {
    const trashed = { ...noteWith(photo('t')), deletedAt: 5 }
    const plan = planMediaSync([noteWith(photo('a')), trashed], [
      { name: 'a.jpg', bytes: 100 },
      { name: 't.jpg', bytes: 100 },
      { name: 'old.m4a', bytes: 9 },
    ])
    expect(plan.remove).toEqual(['t.jpg', 'old.m4a'])
  })

  it('keeps a file whose note has not uploaded it, rather than throwing away the only copy', () => {
    const plan = planMediaSync([noteWith(photo('a', { driveFileId: undefined }))], [{ name: 'a.jpg', bytes: 100 }])
    expect(plan.remove).toEqual([])
  })
})

describe('planDriveTrash', () => {
  it('trashes the files of a note in the recycle bin, once', () => {
    const binned = { ...noteWith(photo('t')), deletedAt: 5 }
    const plan = planDriveTrash([noteWith(photo('a')), binned], {}, new Set())
    expect(plan).toEqual({ trash: ['d-t'], restore: [], forget: [] })
    expect(planDriveTrash([binned], {}, new Set(['d-t'])).trash).toEqual([])
  })

  it('brings a file back when its note leaves the bin', () => {
    expect(planDriveTrash([noteWith(photo('t'))], {}, new Set(['d-t']))).toEqual({ trash: [], restore: ['d-t'], forget: [] })
  })

  it('trashes a file this phone sent once no note mentions it, then forgets it', () => {
    const uploaded = { a: 'd-a', gone: 'd-gone' }
    expect(planDriveTrash([noteWith(photo('a'))], uploaded, new Set()).trash).toEqual(['d-gone'])
    expect(planDriveTrash([noteWith(photo('a'))], uploaded, new Set(['d-gone'])).forget).toEqual(['d-gone'])
  })

  it('never trashes a file a live note still uses, even when a copy of it is in the bin', () => {
    const shared = photo('s')
    const binned = { ...noteWith(shared), id: 'other', deletedAt: 5 }
    expect(planDriveTrash([noteWith(shared), binned], {}, new Set()).trash).toEqual([])
  })

  it('uses the Drive id this phone remembers when the note has not caught up', () => {
    const binned = { ...noteWith(photo('t', { driveFileId: undefined })), deletedAt: 5 }
    expect(planDriveTrash([binned], { t: 'd-t' }, new Set()).trash).toEqual(['d-t'])
  })
})
