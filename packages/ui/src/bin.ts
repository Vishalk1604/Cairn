import { DAY, TOMBSTONE_RETENTION_MS, type Note } from '@cairn/core'

export interface BinEntry {
  note: Note
  /** Whole days before it is deleted for good, from the phone, the cloud and Drive. */
  daysLeft: number
}

/**
 * The recycle bin: deleted notes, newest first. They are the same records,
 * kept as tombstones for thirty days, so the bin costs nothing extra to show.
 */
export function recycleBin(notes: readonly Note[], now: number): BinEntry[] {
  return notes
    .filter((n) => n.deletedAt !== undefined && now - n.deletedAt <= TOMBSTONE_RETENTION_MS)
    .sort((a, b) => b.deletedAt! - a.deletedAt!)
    .map((note) => ({ note, daysLeft: Math.max(1, Math.ceil((note.deletedAt! + TOMBSTONE_RETENTION_MS - now) / DAY)) }))
}

export function binCountdown(daysLeft: number): string {
  return daysLeft <= 1 ? 'Deleted for good within a day' : `Deleted for good in ${daysLeft} days`
}
