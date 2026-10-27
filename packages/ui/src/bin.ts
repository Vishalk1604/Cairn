import { DAY, TOMBSTONE_RETENTION_MS, type Note } from '@cairn/core'

export interface BinEntry {
  note: Note
  /** Whole days before it is deleted for good, from the phone, the cloud and Drive. */
  daysLeft: number
}

/**
 * The recycle bin: deleted notes, newest first. They are the same records,
 * kept as tombstones for thirty days, so the bin costs nothing extra to show.
 * A note deleted forever is only a marker by then, and is not in it.
 */
export function recycleBin(notes: readonly Note[], now: number): BinEntry[] {
  return notes
    .filter((n) => n.deletedAt !== undefined && n.purgedAt === undefined && now - n.deletedAt <= TOMBSTONE_RETENTION_MS)
    .sort((a, b) => b.deletedAt! - a.deletedAt!)
    .map((note) => ({ note, daysLeft: Math.max(1, Math.ceil((note.deletedAt! + TOMBSTONE_RETENTION_MS - now) / DAY)) }))
}

export function binCountdown(daysLeft: number): string {
  return daysLeft <= 1 ? 'Deleted for good within a day' : `Deleted for good in ${daysLeft} days`
}

/** What the confirmation for Delete forever or Empty bin says, before anything is gone. */
export function purgeWarning(count: number): { title: string; message: string; confirm: string } {
  return count === 1
    ? {
        title: 'Delete forever?',
        message: 'This note is deleted from every device straight away and cannot be restored. Its photos and recordings stay in Drive\'s trash until Drive empties it.',
        confirm: 'Delete forever',
      }
    : {
        title: `Empty the recycle bin?`,
        message: `All ${count} notes are deleted from every device straight away and cannot be restored. Their photos and recordings stay in Drive's trash until Drive empties it.`,
        confirm: 'Empty bin',
      }
}
