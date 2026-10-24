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

export interface DriveTrashPlan {
  /** Files of notes in the recycle bin, or taken out of a note, not yet in Drive's trash. */
  trash: string[]
  /** Files in Drive's trash whose note came back out of the recycle bin. */
  restore: string[]
  /** Files no note mentions any more, already trashed: nothing left to remember them for. */
  forget: string[]
}

/**
 * Which Drive files to move to Drive's trash, and back, so Drive follows the
 * recycle bin. Drive empties its trash after thirty days, the same time a
 * note spends in the bin, so a file goes for good when its note does.
 *
 * Only a note in the bin, or a file this phone sent that no note mentions
 * any more, is ever trashed: never one merely missing from the list, which
 * may just be a note not synced yet.
 */
export function planDriveTrash(
  notes: readonly Note[],
  /** Attachment id → Drive file id, for the files this phone sent. */
  uploaded: Readonly<Record<string, string>>,
  /** Drive file ids this phone has already put in Drive's trash. */
  trashed: ReadonlySet<string>,
): DriveTrashPlan {
  const live = new Set<string>()
  const binned = new Set<string>()
  const mentioned = new Set<string>()
  for (const note of notes) {
    for (const a of note.attachments ?? []) {
      const file = a.driveFileId ?? uploaded[a.id]
      if (!file) continue
      mentioned.add(file)
      if (note.deletedAt === undefined) live.add(file)
      else binned.add(file)
    }
  }
  const dropped = Object.values(uploaded).filter((file) => !mentioned.has(file))
  return {
    trash: [...new Set([...binned, ...dropped])].filter((file) => !live.has(file) && !trashed.has(file)),
    restore: [...trashed].filter((file) => live.has(file)),
    forget: [...trashed].filter((file) => !mentioned.has(file)),
  }
}
