import type { CreateContext } from '../src'

/** Local time in the test time zone (America/New_York). Month is 1-based. */
export const at = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime()

/** Monday 14 September 2026, 10:00. */
export const NOW = at(2026, 9, 14, 10)

export const ctx: CreateContext = { userId: 'u1', now: NOW }

/** Readable local time for assertion messages. */
export const show = (t: number | undefined): string => (t === undefined ? 'undefined' : new Date(t).toString().slice(0, 21))
