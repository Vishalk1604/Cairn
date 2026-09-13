import { newerOf, purgeableTombstones, tombstone, type Entity, type Note, type Reminder } from '@cairn/core'
import {
  matchesNoteQuery,
  matchesReminderQuery,
  type NoteQuery,
  type ReminderQuery,
  type Repository,
  type RepositoryStats,
  type Unsubscribe,
} from './repository'

/** Minimal async key-value storage. localStorage, the Tauri store, MMKV and AsyncStorage all fit. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly data = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value)
  }
}

export interface Persistence {
  store: KeyValueStore
  key: string
  /** Saved data that couldn't be read. It is backed up under another key before anything overwrites it. */
  onError?: (error: unknown) => void
}

const FORMAT_VERSION = 1

interface Snapshot<T> {
  version: number
  items: T[]
}

interface Observer<T, Q> {
  query: Q
  listener: (items: T[]) => void
  last: T[]
}

/**
 * Keeps the whole collection in memory and, with persistence, writes it back
 * as one JSON snapshot after each change. Bursts of writes coalesce into a
 * single save.
 */
export class LocalRepository<T extends Entity, Q> implements Repository<T, Q> {
  private readonly items = new Map<string, T>()
  private readonly observers = new Set<Observer<T, Q>>()
  private readonly counters: RepositoryStats = { reads: 0, writes: 0 }
  private saving: Promise<void> | null = null
  private dirty = false

  constructor(
    private readonly matches: (item: T, query: Q) => boolean,
    private readonly persistence?: Persistence,
  ) {}

  async load(): Promise<void> {
    if (!this.persistence) return
    const { store, key, onError } = this.persistence
    const raw = await store.get(key)
    if (raw === null) return
    try {
      const snapshot = JSON.parse(raw) as Partial<Snapshot<T>> | null
      if (snapshot?.version !== FORMAT_VERSION || !Array.isArray(snapshot.items)) {
        throw new Error(`Unrecognized saved data in "${key}" (version ${String(snapshot?.version)})`)
      }
      for (const item of snapshot.items) {
        if (item && typeof item.id === 'string') this.items.set(item.id, item)
      }
    } catch (error) {
      await store.set(`${key}.unreadable-${Date.now()}`, raw)
      onError?.(error)
    }
    this.notify()
  }

  async get(id: string): Promise<T | undefined> {
    const item = this.items.get(id)
    if (item) this.counters.reads++
    return item
  }

  async list(query?: Q): Promise<T[]> {
    const result = this.select(query ?? ({} as Q))
    this.counters.reads += result.length
    return result
  }

  observe(query: Q, listener: (items: T[]) => void): Unsubscribe {
    const observer: Observer<T, Q> = { query, listener, last: this.select(query) }
    this.observers.add(observer)
    this.counters.reads += observer.last.length
    listener(observer.last)
    return () => {
      this.observers.delete(observer)
    }
  }

  async upsert(item: T): Promise<void> {
    await this.upsertMany([item])
  }

  async upsertMany(items: readonly T[]): Promise<void> {
    let changed = false
    for (const item of items) {
      const existing = this.items.get(item.id)
      if (existing && newerOf(existing, item) === existing) continue
      this.items.set(item.id, item)
      this.counters.writes++
      changed = true
    }
    if (!changed) return
    this.notify()
    await this.persist()
  }

  async remove(id: string, now: number): Promise<void> {
    const existing = this.items.get(id)
    if (!existing || existing.deletedAt !== undefined) return
    await this.upsert(tombstone(existing, now))
  }

  async purgeTombstones(now: number): Promise<number> {
    const dead = purgeableTombstones([...this.items.values()], now)
    if (dead.length === 0) return 0
    for (const item of dead) this.items.delete(item.id)
    this.counters.writes += dead.length
    this.notify()
    await this.persist()
    return dead.length
  }

  async pendingChanges(): Promise<string[]> {
    return []
  }

  stats(): RepositoryStats {
    return { ...this.counters }
  }

  /** Resolves once everything written so far is saved. */
  async flush(): Promise<void> {
    await this.saving
  }

  private select(query: Q): T[] {
    const out: T[] = []
    for (const item of this.items.values()) if (this.matches(item, query)) out.push(item)
    return out
  }

  private notify(): void {
    const errors: unknown[] = []
    for (const observer of this.observers) {
      const next = this.select(observer.query)
      if (sameItems(observer.last, next)) continue
      this.counters.reads += next.filter((item, i) => observer.last[i] !== item).length
      observer.last = next
      try {
        observer.listener(next)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw errors[0]
  }

  private persist(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    this.dirty = true
    if (!this.saving) {
      this.saving = this.drain().finally(() => {
        this.saving = null
      })
    }
    return this.saving
  }

  private async drain(): Promise<void> {
    const { store, key } = this.persistence!
    while (this.dirty) {
      this.dirty = false
      const snapshot: Snapshot<T> = { version: FORMAT_VERSION, items: [...this.items.values()] }
      await store.set(key, JSON.stringify(snapshot))
    }
  }
}

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i])
}

export interface LocalRepositories {
  reminders: LocalRepository<Reminder, ReminderQuery>
  notes: LocalRepository<Note, NoteQuery>
}

/** Opens the on-device collections, loading whatever was saved last time. */
export async function openLocalRepositories(
  store: KeyValueStore,
  options: { prefix?: string; onError?: (error: unknown) => void } = {},
): Promise<LocalRepositories> {
  const prefix = options.prefix ?? 'cairn'
  const reminders = new LocalRepository<Reminder, ReminderQuery>(matchesReminderQuery, {
    store,
    key: `${prefix}.reminders`,
    onError: options.onError,
  })
  const notes = new LocalRepository<Note, NoteQuery>(matchesNoteQuery, {
    store,
    key: `${prefix}.notes`,
    onError: options.onError,
  })
  await Promise.all([reminders.load(), notes.load()])
  return { reminders, notes }
}
