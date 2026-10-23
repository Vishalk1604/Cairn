import { newerOf, purgeableTombstones, tombstone, type Entity, type Note, type Reminder } from '@cairn/core'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  type CollectionReference,
  type Firestore,
} from 'firebase/firestore'
import { cairnFirestore } from './firebaseApp'
import {
  matchesNoteQuery,
  matchesReminderQuery,
  type NoteQuery,
  type ReminderQuery,
  type Repository,
  type RepositoryStats,
  type Unsubscribe,
} from './repository'

export interface FirestoreRepositoryOptions<T extends Entity, Q> {
  db: Firestore
  /** Everything is filed under `users/{userId}`, which is what the rules key on. */
  userId: string
  /** `notes` or `reminders`. */
  name: string
  matches: (item: T, query: Q) => boolean
  /** Called when the backend reports a problem, e.g. permission denied. */
  onError?: (error: unknown) => void
}

/**
 * A Firestore-backed repository.
 *
 * One listener per collection keeps a local mirror; queries are then answered
 * from memory. Firestore bills per document delivered, so after the first
 * load a listener only costs what actually changed, and with offline
 * persistence a reopen usually costs nothing at all. Narrower server-side
 * queries would save reads for a large collection, but at one user's worth of
 * notes they would cost indexes and complexity for no measurable gain.
 *
 * Writes are unconditional rather than transactional. A transaction would
 * enforce last-write-wins by `updatedAt` exactly, but transactions need the
 * network, which would mean no offline editing — the wrong trade for an app
 * whose whole point is working on a phone with no signal.
 */
export class FirestoreRepository<T extends Entity, Q> implements Repository<T, Q> {
  private readonly items = new Map<string, T>()
  private readonly observers = new Set<{ query: Q; listener: (items: T[]) => void; last: T[] }>()
  private readonly counters: RepositoryStats = { reads: 0, writes: 0 }
  private readonly pending = new Set<string>()
  private readonly ref: CollectionReference
  private readonly matches: (item: T, query: Q) => boolean
  private readonly onError?: (error: unknown) => void
  private stop?: () => void
  private firstLoad?: Promise<void>
  private markServerSynced!: () => void
  private readonly serverReady = new Promise<void>((resolve) => (this.markServerSynced = resolve))

  constructor(options: FirestoreRepositoryOptions<T, Q>) {
    this.ref = collection(options.db, 'users', options.userId, options.name)
    this.matches = options.matches
    this.onError = options.onError
  }

  /**
   * Resolves once a snapshot has come from the server rather than the cache.
   * Until then, "not here" may only mean "not fetched yet", so nothing that
   * writes on the strength of what is missing should run before this.
   */
  serverSynced(): Promise<void> {
    void this.start()
    return this.serverReady
  }

  /** Opens the listener and resolves once the first snapshot has arrived. */
  start(): Promise<void> {
    this.firstLoad ??= new Promise<void>((resolve) => {
      let settled = false
      this.stop = onSnapshot(
        this.ref,
        { includeMetadataChanges: true },
        (snapshot) => {
          for (const change of snapshot.docChanges()) {
            const item = change.doc.data() as T
            if (change.type === 'removed') this.items.delete(change.doc.id)
            else {
              const existing = this.items.get(change.doc.id)
              this.items.set(change.doc.id, existing ? newerOf(existing, item) : item)
            }
            // Documents served from the local cache were already paid for.
            if (!change.doc.metadata.fromCache) this.counters.reads++
          }
          this.pending.clear()
          for (const d of snapshot.docs) if (d.metadata.hasPendingWrites) this.pending.add(d.id)
          this.notify()
          if (!snapshot.metadata.fromCache) this.markServerSynced()
          if (!settled) {
            settled = true
            resolve()
          }
        },
        (error) => {
          this.onError?.(error)
          if (!settled) {
            settled = true
            resolve()
          }
        },
      )
    })
    return this.firstLoad
  }

  /** Closes the listener. Call when signing out. */
  close(): void {
    this.stop?.()
    this.stop = undefined
    this.firstLoad = undefined
    this.items.clear()
    this.observers.clear()
  }

  async get(id: string): Promise<T | undefined> {
    await this.start()
    return this.items.get(id)
  }

  async list(query?: Q): Promise<T[]> {
    await this.start()
    return this.select(query ?? ({} as Q))
  }

  observe(query: Q, listener: (items: T[]) => void): Unsubscribe {
    const observer = { query, listener, last: this.select(query) }
    this.observers.add(observer)
    listener(observer.last)
    // Deliver again once the first snapshot lands, in case this was called
    // before the listener was open.
    void this.start().then(() => this.notify())
    return () => {
      this.observers.delete(observer)
    }
  }

  async upsert(item: T): Promise<void> {
    this.apply(item)
    this.counters.writes++
    // Deliberately not awaited past the local write: Firestore resolves this
    // only once the server acknowledges, which never happens offline.
    void setDoc(doc(this.ref, item.id), item).catch((error: unknown) => this.onError?.(error))
  }

  async upsertMany(items: readonly T[]): Promise<void> {
    if (items.length === 0) return
    for (const item of items) {
      this.apply(item)
      this.counters.writes++
    }
    const batch = writeBatch(this.ref.firestore)
    for (const item of items) batch.set(doc(this.ref, item.id), item)
    void batch.commit().catch((error: unknown) => this.onError?.(error))
  }

  async remove(id: string, now: number): Promise<void> {
    const existing = this.items.get(id)
    if (!existing || existing.deletedAt !== undefined) return
    await this.upsert(tombstone(existing, now))
  }

  async purgeTombstones(now: number): Promise<number> {
    await this.start()
    const dead = purgeableTombstones([...this.items.values()], now)
    if (dead.length === 0) return 0
    const batch = writeBatch(this.ref.firestore)
    for (const item of dead) {
      this.items.delete(item.id)
      batch.delete(doc(this.ref, item.id))
      this.counters.writes++
    }
    this.notify()
    void batch.commit().catch((error: unknown) => this.onError?.(error))
    return dead.length
  }

  /** Ids written here that the backend has not acknowledged yet. */
  async pendingChanges(): Promise<string[]> {
    return [...this.pending]
  }

  stats(): RepositoryStats {
    return { ...this.counters }
  }

  private apply(item: T): void {
    const existing = this.items.get(item.id)
    this.items.set(item.id, existing ? newerOf(existing, item) : item)
    this.pending.add(item.id)
    this.notify()
  }

  private select(query: Q): T[] {
    const out: T[] = []
    for (const item of this.items.values()) if (this.matches(item, query)) out.push(item)
    return out
  }

  private notify(): void {
    for (const observer of this.observers) {
      const next = this.select(observer.query)
      if (sameItems(observer.last, next)) continue
      observer.last = next
      try {
        observer.listener(next)
      } catch (error) {
        this.onError?.(error)
      }
    }
  }
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export interface SyncedRepositories {
  reminders: FirestoreRepository<Reminder, ReminderQuery>
  notes: FirestoreRepository<Note, NoteQuery>
  /** Stops both listeners. Call on sign-out. */
  close(): void
}

/** Opens both synced collections for a signed-in user. */
export async function openSyncedRepositories(
  userId: string,
  onError?: (error: unknown) => void,
  db: Firestore = cairnFirestore(),
): Promise<SyncedRepositories> {
  const reminders = new FirestoreRepository<Reminder, ReminderQuery>({
    db,
    userId,
    name: 'reminders',
    matches: matchesReminderQuery,
    onError,
  })
  const notes = new FirestoreRepository<Note, NoteQuery>({
    db,
    userId,
    name: 'notes',
    matches: matchesNoteQuery,
    onError,
  })
  await Promise.all([reminders.start(), notes.start()])
  return {
    reminders,
    notes,
    close() {
      reminders.close()
      notes.close()
    },
  }
}
