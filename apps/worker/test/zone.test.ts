import { describe, expect, it } from 'vitest'
import { Zone, zoneName } from '../src/zone'

describe('Zone', () => {
  it('moves an instant onto the person’s clock and back', () => {
    const kolkata = new Zone('Asia/Kolkata')
    const t = Date.UTC(2026, 9, 27, 12, 0)
    expect(kolkata.offset(t)).toBe(5.5 * 3600_000)
    expect(new Date(kolkata.toWall(t)).toISOString()).toBe('2026-10-27T17:30:00.000Z')
    expect(kolkata.fromWall(kolkata.toWall(t))).toBe(t)
  })

  it('follows daylight saving', () => {
    const ny = new Zone('America/New_York')
    expect(ny.offset(Date.UTC(2026, 6, 1, 12))).toBe(-4 * 3600_000)
    expect(ny.offset(Date.UTC(2026, 11, 1, 12))).toBe(-5 * 3600_000)
    // Nine in the morning on the day the clocks go back.
    const wall = Date.UTC(2026, 10, 1, 9)
    expect(new Date(ny.fromWall(wall)).toISOString()).toBe('2026-11-01T14:00:00.000Z')
  })

  it('treats an unknown zone as UTC', () => {
    expect(zoneName('Mars/Olympus')).toBe('UTC')
    expect(zoneName('Asia/Kolkata')).toBe('Asia/Kolkata')
    expect(new Zone('UTC').toWall(5)).toBe(5)
  })
})
