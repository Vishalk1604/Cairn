import { createNote, markerLine, type Attachment } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { planMediaSync } from '../src'

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
