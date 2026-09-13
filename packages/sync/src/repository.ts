import type { Entity, Note, Reminder, ReminderStatus } from '@cairn/core'

// Nothing backend-specific crosses this boundary. Apps talk to these
// interfaces; the local store (Phase 1) and Firestore (Phase 2) implement them,
// and a D1 implementation can replace Firestore without touching any caller.

export type Unsubscribe = () => void

export interface ReminderQuery {
  status?: readonly ReminderStatus[]
  /** Only reminders with dueAt strictly before this instant. */
  dueBefore?: number
  includeDeleted?: boolean
}

export interface NoteQuery {
  pinned?: boolean
  /** Only notes updated strictly after this instant. */
  updatedAfter?: number
  includeDeleted?: boolean
}

/** Document reads and writes this session. Firestore bills per document, so this is the quota meter. */
export interface RepositoryStats {
  reads: number
  writes: number
}

export interface Repository<T extends Entity, Q> {
  get(id: string): Promise<T | undefined>
  list(query?: Q): Promise<T[]>
  /** Calls back right away with the current matches, then whenever they change. */
  observe(query: Q, listener: (items: T[]) => void): Unsubscribe
  /** Last-write-wins: an item older than the stored copy is ignored. */
  upsert(item: T): Promise<void>
  upsertMany(items: readonly T[]): Promise<void>
  /** Sets a tombstone. Nothing is ever hard-deleted except by purgeTombstones. */
  remove(id: string, now: number): Promise<void>
  /** Hard-deletes tombstones old enough that every device has seen them. Returns how many. */
  purgeTombstones(now: number): Promise<number>
  /** Ids written locally that the backend has not confirmed yet. */
  pendingChanges(): Promise<string[]>
  stats(): RepositoryStats
}

export type ReminderRepository = Repository<Reminder, ReminderQuery>
export type NoteRepository = Repository<Note, NoteQuery>

export function matchesReminderQuery(r: Reminder, q: ReminderQuery): boolean {
  if (!q.includeDeleted && r.deletedAt !== undefined) return false
  if (q.status && !q.status.includes(r.status)) return false
  if (q.dueBefore !== undefined && !(r.dueAt < q.dueBefore)) return false
  return true
}

export function matchesNoteQuery(n: Note, q: NoteQuery): boolean {
  if (!q.includeDeleted && n.deletedAt !== undefined) return false
  if (q.pinned !== undefined && n.pinned !== q.pinned) return false
  if (q.updatedAfter !== undefined && !(n.updatedAt > q.updatedAfter)) return false
  return true
}
