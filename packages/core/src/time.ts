// Calendar math in the device's local time zone. Adding days goes through the
// Date setters rather than adding 24h, so it stays correct across DST changes.

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function startOfLocalDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function addLocalDays(t: number, days: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Midnight at the end of t's day, i.e. the first instant of the next day. */
export function startOfNextLocalDay(t: number): number {
  return addLocalDays(startOfLocalDay(t), 1)
}

export function isSameLocalDay(a: number, b: number): boolean {
  return startOfLocalDay(a) === startOfLocalDay(b)
}

/** The same calendar day as t, at hour:minute local time. */
export function atLocalTime(t: number, hour: number, minute = 0): number {
  const d = new Date(t)
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}
