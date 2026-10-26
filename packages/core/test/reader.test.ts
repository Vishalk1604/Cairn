import { describe, expect, it } from 'vitest'
import { chooseReader, LEASE_STALE_MS, type ReaderLease } from '../src'

const NOW = 1_800_000_000_000
const desktop = { deviceId: 'pc', kind: 'desktop' as const, canRead: true }
const phone = { deviceId: 'phone', kind: 'phone' as const, canRead: true }
const lease = (deviceId: string, kind: ReaderLease['kind'], ago: number): ReaderLease => ({ deviceId, kind, heartbeatAt: NOW - ago })

describe('chooseReader', () => {
  it('lets the first device read when nobody holds the claim', () => {
    expect(chooseReader(null, phone, NOW)).toEqual({ read: true, holds: true, reader: 'here' })
    expect(chooseReader(undefined, desktop, NOW)).toEqual({ read: true, holds: true, reader: 'here' })
  })

  it('keeps the phone waiting while the computer reads', () => {
    expect(chooseReader(lease('pc', 'desktop', 60_000), phone, NOW)).toEqual({ read: false, holds: false, reader: 'desktop' })
  })

  it('hands over to the phone once the computer goes quiet', () => {
    expect(chooseReader(lease('pc', 'desktop', LEASE_STALE_MS + 1), phone, NOW).holds).toBe(true)
  })

  it('puts the computer first, taking over from a phone that is reading', () => {
    expect(chooseReader(lease('phone', 'phone', 1000), desktop, NOW)).toEqual({ read: true, holds: true, reader: 'here' })
  })

  it('leaves a second computer to the one already reading', () => {
    expect(chooseReader(lease('other-pc', 'desktop', 1000), desktop, NOW)).toEqual({ read: false, holds: false, reader: 'desktop' })
  })

  it('keeps reading on the device that holds the claim', () => {
    expect(chooseReader(lease('phone', 'phone', 1000), phone, NOW).holds).toBe(true)
  })

  it('never claims on a device missing a permission the other has', () => {
    expect(chooseReader(null, { ...desktop, canRead: false }, NOW)).toEqual({ read: false, holds: false, reader: 'nobody' })
    expect(chooseReader(lease('phone', 'phone', 1000), { ...desktop, canRead: false }, NOW).reader).toBe('phone')
  })

  it('reads once on Sync now without taking the claim', () => {
    expect(chooseReader(lease('pc', 'desktop', 1000), phone, NOW, { force: true })).toEqual({ read: true, holds: false, reader: 'desktop' })
  })
})
