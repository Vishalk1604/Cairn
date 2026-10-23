import { updateNote, type Note } from '@cairn/core'
import type { NoteRepository } from '@cairn/sync'

/** The chip and row shown for every tag in use, plus the two computed buckets. */
export interface Folder {
  /** The tag itself; '' for All, and UNCATEGORISED for notes with no tag at all. */
  id: string
  name: string
  count: number
  pinned: boolean
}

export const ALL_FOLDER = ''
export const UNCATEGORISED = '\u0000uncategorised'

export const isRealFolder = (id: string) => id !== ALL_FOLDER && id !== UNCATEGORISED

/**
 * Folders are tags. A note filed under GYM is a note tagged #gym, which means
 * capture already files things ("push day #gym") and no second organiser has
 * to be kept in step. The cost is that a note with two tags shows in both.
 *
 * A pinned folder with nothing in it is still listed, so creating a folder
 * and then writing into it works the way it reads.
 */
export function foldersOf(notes: readonly Note[], pinned: readonly string[]): Folder[] {
  const counts = new Map<string, number>()
  let untagged = 0
  for (const note of notes) {
    if (note.tags.length === 0) untagged += 1
    for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  for (const tag of pinned) if (!counts.has(tag)) counts.set(tag, 0)

  const rank = new Map(pinned.map((tag, i) => [tag, i]))
  const tags = [...counts.entries()]
    .map(([id, count]): Folder => ({ id, name: id.toUpperCase(), count, pinned: rank.has(id) }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (a.pinned && b.pinned) return rank.get(a.id)! - rank.get(b.id)!
      return a.id < b.id ? -1 : 1
    })

  return [
    { id: ALL_FOLDER, name: 'All', count: notes.length, pinned: false },
    ...tags,
    ...(untagged ? [{ id: UNCATEGORISED, name: 'Uncategorised', count: untagged, pinned: false }] : []),
  ]
}

export function notesInFolder(notes: readonly Note[], folderId: string): Note[] {
  if (folderId === ALL_FOLDER) return [...notes]
  if (folderId === UNCATEGORISED) return notes.filter((n) => n.tags.length === 0)
  return notes.filter((n) => n.tags.includes(folderId))
}

export function folderTag(name: string): string {
  return name.trim().replace(/^#+/, '').replace(/\s+/g, '-').toLowerCase()
}

/** Retags every note in a folder. Renaming a folder is renaming its tag everywhere it is used. */
export async function renameFolder(notes: NoteRepository, all: readonly Note[], from: string, to: string): Promise<void> {
  const tag = folderTag(to)
  if (!tag || tag === from) return
  const now = Date.now()
  await notes.upsertMany(
    all
      .filter((n) => n.tags.includes(from))
      .map((n) => updateNote(n, { tags: [...new Set(n.tags.map((t) => (t === from ? tag : t)))] }, now)),
  )
}

/**
 * Deleting a folder unfiles its notes rather than deleting them: they fall
 * back to Uncategorised. Losing writing because a label was removed would be
 * a cruel surprise.
 */
export async function deleteFolder(notes: NoteRepository, all: readonly Note[], tag: string): Promise<void> {
  const now = Date.now()
  await notes.upsertMany(all.filter((n) => n.tags.includes(tag)).map((n) => updateNote(n, { tags: n.tags.filter((t) => t !== tag) }, now)))
}

export async function moveToFolder(notes: NoteRepository, chosen: readonly Note[], tag: string | null): Promise<void> {
  const now = Date.now()
  await notes.upsertMany(chosen.map((n) => updateNote(n, { tags: tag ? [tag] : [] }, now)))
}
