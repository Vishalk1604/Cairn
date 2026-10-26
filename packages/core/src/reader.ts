import { MINUTE } from './time'

/**
 * Which device reads Gmail and Classroom. Only one at a time, so mail is read,
 * sorted and paid for once rather than once per device; the others show what
 * it wrote.
 *
 * The computer goes first: Cairn lives in its tray, so it is usually on, and
 * it has the time to wait on a slow model. The phone reads only when the
 * computer has gone quiet — asleep, switched off, or signed out.
 */
export type DeviceKind = 'desktop' | 'phone'

/** The reading device's claim, renewed on every read. */
export interface ReaderLease {
  deviceId: string
  kind: DeviceKind
  /** When it last read, or last said it was still reading. */
  heartbeatAt: number
}

/** A claim older than this is given up: three missed looks in a row. */
export const LEASE_STALE_MS = 15 * MINUTE

export interface ReaderChoice {
  /** Whether this device should read now. */
  read: boolean
  /** Whether it is the reader: true means renew the claim with the read. */
  holds: boolean
  /** Who reads, for saying so on screen. */
  reader: 'here' | DeviceKind | 'nobody'
}

/**
 * Decides whether this device reads.
 *
 * - A device that cannot read everything the account is set up to read never
 *   claims, so a computer missing a permission leaves the phone in charge
 *   rather than quietly reading half the mail.
 * - A computer always takes over from a phone, and keeps a claim another
 *   computer let lapse.
 * - A phone reads only when no fresh claim is held by anyone else.
 * - `force` is Sync now: this device reads once, whoever holds the claim,
 *   without taking it from them.
 */
export function chooseReader(
  lease: ReaderLease | null | undefined,
  me: { deviceId: string; kind: DeviceKind; canRead: boolean },
  now: number,
  options: { force?: boolean; staleMs?: number } = {},
): ReaderChoice {
  const staleMs = options.staleMs ?? LEASE_STALE_MS
  const fresh = !!lease && now - lease.heartbeatAt < staleMs
  const mine = !!lease && lease.deviceId === me.deviceId
  const other = fresh && !mine ? lease!.kind : null
  if (!me.canRead) return { read: false, holds: false, reader: other ?? 'nobody' }
  const holds = !fresh || mine || (me.kind === 'desktop' && lease!.kind === 'phone')
  if (holds) return { read: true, holds: true, reader: 'here' }
  return { read: !!options.force, holds: false, reader: other ?? 'nobody' }
}
