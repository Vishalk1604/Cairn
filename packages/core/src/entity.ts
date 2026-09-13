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

/**
 * Last-write-wins by updatedAt. Ties break deterministically (deletion wins,
 * then the lexically larger serialization) so every device converges on the
 * same winner without talking to the others.
 */
export function newerOf<T extends Entity>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  const aDeleted = a.deletedAt !== undefined
  const bDeleted = b.deletedAt !== undefined
  if (aDeleted !== bDeleted) return aDeleted ? a : b
  return stableStringify(a) >= stableStringify(b) ? a : b
}

/** Tombstones old enough that every device has long since seen them. */
export function purgeableTombstones<T extends Entity>(
  entities: readonly T[],
  now: number,
  retentionMs = TOMBSTONE_RETENTION_MS,
): T[] {
  return entities.filter((e) => e.deletedAt !== undefined && now - e.deletedAt > retentionMs)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  )
}
