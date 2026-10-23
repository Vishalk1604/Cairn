import { attachmentFileName, type Attachment, type Note } from '@cairn/core'

/** A file already in the media folder. */
export interface LocalMediaFile {
  name: string
  bytes: number
}

export interface MediaPlan {
  /** Used by a note and on Drive, but missing here or cut short. */
  download: Attachment[]
  /** Here, but no note uses it any more. */
  remove: string[]
}

/**
 * What to fetch and what to clear so a folder holds exactly the media that
 * notes point at. A note in the trash counts as gone, so its files are
 * cleared too; restoring the note brings them back from Drive.
 *
 * Only safe to act on with the whole list of notes from the server: with a
 * partial list, every file of a note not yet fetched would look unused.
 */
export function planMediaSync(notes: readonly Note[], present: readonly LocalMediaFile[]): MediaPlan {
  const wanted = new Map<string, Attachment>()
  for (const note of notes) {
    if (note.deletedAt !== undefined) continue
    for (const a of note.attachments ?? []) wanted.set(attachmentFileName(a), a)
  }
  const here = new Map(present.map((f) => [f.name, f.bytes]))
  return {
    download: [...wanted].filter(([name, a]) => a.driveFileId && !isWhole(here.get(name), a)).map(([, a]) => a),
    remove: present.filter((f) => !wanted.has(f.name)).map((f) => f.name),
  }
}

/** A file is trusted when its size matches the record, or when the record never said. */
function isWhole(bytes: number | undefined, a: Attachment): boolean {
  if (!bytes) return false
  return a.bytes === undefined || a.bytes === bytes
}
