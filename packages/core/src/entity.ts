import type { Entity } from './model'
import { DAY } from './time'

export const TOMBSTONE_RETENTION_MS = 30 * DAY

/**
 * Drops keys whose value is undefined. Engine functions return clean objects
 * so that clearing a field (e.g. snoozedUntil) removes it rather than storing
 * an explicit undefined, which Firestore rejects.
 */
export function clean<T extends object>(obj: T): T {
  const out = {} as T
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key]
  }
  return out
}

export function isLive(entity: Entity): boolean {
  return entity.deletedAt === undefined
}

export function isPurged(entity: Entity): boolean {
  return entity.purgedAt !== undefined
}

/**
 * The updatedAt for an edit of a version stamped `previous`: normally now, but
 * always later than the version it replaces. Another device's clock may run
 * ahead, and an edit must never lose last-write-wins to the thing it edited.
 */
export function nextStamp(previous: number, now: number): number {
  return Math.max(now, previous + 1)
}

export function tombstone<T extends Entity>(entity: T, now: number): T {
  if (entity.deletedAt !== undefined) return entity
  return { ...entity, deletedAt: now, updatedAt: nextStamp(entity.updatedAt, now) }
}

/** Brings a tombstone back, stamped later than its deletion so last-write-wins keeps it. */
export function revive<T extends Entity>(entity: T, now: number): T {
  if (entity.deletedAt === undefined || entity.purgedAt !== undefined) return entity
  const { deletedAt: _deletedAt, ...alive } = entity
  return { ...alive, updatedAt: nextStamp(entity.updatedAt, now) } as T
}

/**
 * Turns an entity into its purge marker: still a tombstone, with only its id,
 * owner and stamps left, plus whatever `blank` must hold for the document to
 * keep its shape. The content is gone from this moment on every device that
 * receives the marker, and the marker itself goes with the ordinary purge,
 * thirty days on.
 */
export function purge<T extends Entity>(entity: T, now: number, blank: Omit<T, keyof Entity>): T {
  if (entity.purgedAt !== undefined) return entity
  const stamp = nextStamp(entity.updatedAt, now)
  return {
    ...blank,
    id: entity.id,
    userId: entity.userId,
    createdAt: entity.createdAt,
    updatedAt: stamp,
    deletedAt: entity.deletedAt ?? now,
    purgedAt: now,
  } as T
}

/**
 * Last-write-wins by updatedAt, except that a purge marker beats any version
 * that is not one: deleting forever is final, even against an edit stamped
 * later on a device whose clock runs ahead or that was offline at the time.
 * Ties break deterministically (deletion wins, then the lexically larger
 * serialization) so every device converges on the same winner without
 * talking to the others.
 */
export function newerOf<T extends Entity>(a: T, b: T): T {
  const aPurged = a.purgedAt !== undefined
  const bPurged = b.purgedAt !== undefined
  if (aPurged !== bPurged) return aPurged ? a : b
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  const aDeleted = a.deletedAt !== undefined
  const bDeleted = b.deletedAt !== undefined
  if (aDeleted !== bDeleted) return aDeleted ? a : b
  return stableStringify(a) >= stableStringify(b) ? a : b
}

/**
 * Tombstones old enough that every device has long since seen them. A purge
 * marker counts from when it was purged, not from the deletion before it, so
 * it outlives a phone that has been offline for as long as the bin lasts.
 */
export function purgeableTombstones<T extends Entity>(
  entities: readonly T[],
  now: number,
  retentionMs = TOMBSTONE_RETENTION_MS,
): T[] {
  return entities.filter((e) => e.deletedAt !== undefined && now - (e.purgedAt ?? e.deletedAt) > retentionMs)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
