import { createNote, updateNote, type Note } from '@cairn/core'
import { describe, expect, it } from 'vitest'
import { LocalRepository, matchesNoteQuery, replicate, type NoteQuery, type RemoteRepository } from '../src'

const NOW = Date.UTC(2026, 9, 21, 9)
const EVERYTHING: NoteQuery = { includeDeleted: true }

const note = (title: string, userId = 'local', now = NOW): Note => createNote({ title }, { userId, now })

/** A cloud stand-in whose server answers only when the test says so. */
function cloud() {
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  const repo = Object.assign(new LocalRepository<Note, NoteQuery>(matchesNoteQuery), {
    serverSynced: () => answered,
  }) as LocalRepository<Note, NoteQuery> & RemoteRepository<Note, NoteQuery>
  return { repo, answer }
}

declare function setTimeout(run: (value?: unknown) => void, ms: number): unknown

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('replicate', () => {
  it('pushes nothing until the server has answered', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    await local.upsert(note('written offline'))

    replicate(local, remote.repo, EVERYTHING, 'uid')
    await settle()
    // The cloud may hold a newer copy it has not sent yet; writing now could clobber it.
    expect(await remote.repo.list(EVERYTHING)).toHaveLength(0)

    remote.answer()
    await settle()
    expect(await remote.repo.list(EVERYTHING)).toHaveLength(1)
  })

  it('files work done before signing in under the account', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    await local.upsert(note('before sign-in'))
    replicate(local, remote.repo, EVERYTHING, 'uid')
    remote.answer()
    await settle()
    // The rules reject a document whose userId is not the signed-in user.
    expect((await remote.repo.list(EVERYTHING))[0]?.userId).toBe('uid')
  })

  it('brings the cloud copy down to the device', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    await remote.repo.upsert(note('from the laptop', 'uid'))
    replicate(local, remote.repo, EVERYTHING, 'uid')
    await settle()
    expect((await local.list(EVERYTHING)).map((n) => n.title)).toEqual(['from the laptop'])
  })

  it('lets the later edit win on both sides', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    const base = note('draft', 'uid')
    await local.upsert(base)
    await remote.repo.upsert(updateNote(base, { title: 'edited on the laptop' }, NOW + 10))

    replicate(local, remote.repo, EVERYTHING, 'uid')
    remote.answer()
    await settle()
    expect((await local.get(base.id))?.title).toBe('edited on the laptop')

    const phoneEdit = updateNote((await local.get(base.id))!, { title: 'edited on the phone' }, NOW + 20)
    await local.upsert(phoneEdit)
    await settle()
    expect((await remote.repo.get(base.id))?.title).toBe('edited on the phone')
  })

  it('carries deletions across', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    const n = note('to delete', 'uid')
    await remote.repo.upsert(n)
    replicate(local, remote.repo, EVERYTHING, 'uid')
    remote.answer()
    await settle()
    await local.remove(n.id, NOW + 5)
    await settle()
    expect((await remote.repo.get(n.id))?.deletedAt).toBe(NOW + 5)
  })

  it('stops when told to', async () => {
    const local = new LocalRepository<Note, NoteQuery>(matchesNoteQuery)
    const remote = cloud()
    const stop = replicate(local, remote.repo, EVERYTHING, 'uid')
    remote.answer()
    await settle()
    stop()
    await local.upsert(note('after sign-out', 'uid'))
    await settle()
    expect(await remote.repo.list(EVERYTHING)).toHaveLength(0)
  })
})
