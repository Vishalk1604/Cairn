import { describe, expect, it } from 'vitest'
import {
  addLocalDays,
  clean,
  HOUR,
  isSameLocalDay,
  newerOf,
  purgeableTombstones,
  startOfNextLocalDay,
  tombstone,
  uuidv7,
  DAY,
} from '../src'
import { at } from './helpers'

describe('uuidv7', () => {
  const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  it('produces a version 7, variant 10 UUID', () => {
    expect(uuidv7()).toMatch(V7)
  })

  it('encodes the timestamp in the first 48 bits', () => {
    const now = at(2026, 9, 14, 10)
    const hex = uuidv7(now).replace(/-/g, '').slice(0, 12)
    expect(parseInt(hex, 16)).toBe(now)
  })

  it('sorts by creation time', () => {
    const ids = [3, 1, 2].map((offset) => uuidv7(1_700_000_000_000 + offset))
    expect([...ids].sort()).toEqual([ids[1], ids[2], ids[0]])
  })

  it('works without Web Crypto', () => {
    const zeros = (bytes: Uint8Array) => bytes.fill(0)
    expect(uuidv7(0, zeros)).toBe('00000000-0000-7000-8000-000000000000')
  })

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => uuidv7(1_700_000_000_000)))
    expect(ids.size).toBe(10_000)
  })
})

describe('local time', () => {
  it('adds calendar days across the spring-forward gap', () => {
    const before = at(2026, 3, 7, 9)
    const after = addLocalDays(before, 1)
    expect(after).toBe(at(2026, 3, 8, 9))
    expect(after - before).toBe(23 * HOUR)
  })

  it('knows the fall-back day is 25 hours long', () => {
    const start = at(2026, 11, 1)
    expect(startOfNextLocalDay(start) - start).toBe(25 * HOUR)
  })

  it('compares calendar days, not 24h windows', () => {
    expect(isSameLocalDay(at(2026, 9, 14, 0, 1), at(2026, 9, 14, 23, 59))).toBe(true)
    expect(isSameLocalDay(at(2026, 9, 14, 23, 59), at(2026, 9, 15, 0, 1))).toBe(false)
  })
})

describe('entities', () => {
  const base = { id: 'a', userId: 'u', createdAt: 0, updatedAt: 10, title: 'x' }

  it('clean drops undefined keys only', () => {
    expect(clean({ a: 1, b: undefined, c: null, d: 0 })).toEqual({ a: 1, c: null, d: 0 })
    expect(Object.keys(clean({ a: undefined }))).toEqual([])
  })

  it('tombstone sets deletedAt and bumps updatedAt, once', () => {
    const dead = tombstone(base, 20)
    expect(dead).toMatchObject({ deletedAt: 20, updatedAt: 20 })
    expect(tombstone(dead, 30)).toBe(dead)
  })

  it('last write wins', () => {
    const newer = { ...base, updatedAt: 11, title: 'y' }
    expect(newerOf(base, newer)).toBe(newer)
    expect(newerOf(newer, base)).toBe(newer)
  })

  it('breaks ties the same way on every device', () => {
    const a = { ...base, title: 'a' }
    const b = { ...base, title: 'b' }
    expect(newerOf(a, b)).toBe(newerOf(b, a))
    const deleted = { ...base, deletedAt: 10 }
    expect(newerOf(a, deleted)).toBe(deleted)
    expect(newerOf(deleted, a)).toBe(deleted)
  })

  it('purges tombstones only after the retention period', () => {
    const now = 100 * DAY
    const recent = { ...base, id: 'r', deletedAt: now - 29 * DAY }
    const old = { ...base, id: 'o', deletedAt: now - 31 * DAY }
    const live = { ...base, id: 'l' }
    expect(purgeableTombstones([recent, old, live], now)).toEqual([old])
  })
})
