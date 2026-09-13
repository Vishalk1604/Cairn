import { RRule, rrulestr, type ByWeekday, type Options, type Weekday } from 'rrule'

export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

/** Monday-first, matching rrule's weekday numbering. */
export const WEEKDAY_CODES: readonly WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export interface RecurrenceSpec {
  freq: Frequency
  /** Every N periods. Absent means 1. */
  interval?: number
  /** Weekly only: which days. Absent means the start date's weekday. */
  byWeekday?: WeekdayCode[]
  /** Stop after this many occurrences. */
  count?: number
  /** Stop after this instant. */
  until?: number
}

const FREQ_TO_RRULE: Record<Frequency, number> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
  yearly: RRule.YEARLY,
}

const RRULE_TO_FREQ = new Map<number, Frequency>(
  (Object.entries(FREQ_TO_RRULE) as [Frequency, number][]).map(([name, value]) => [value, name]),
)

const WEEKDAY_TO_RRULE: Record<WeekdayCode, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
}

// rrule.js computes in UTC. Local wall-clock times are encoded as if they were
// UTC ("floating" time in RFC 5545 terms), so "every Monday at 9:00" stays at
// 9:00 local across DST changes; results are decoded back into real instants.

function toFloating(t: number): Date {
  const d = new Date(t)
  return new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()),
  )
}

function fromFloating(f: Date): number {
  return new Date(
    f.getUTCFullYear(),
    f.getUTCMonth(),
    f.getUTCDate(),
    f.getUTCHours(),
    f.getUTCMinutes(),
    f.getUTCSeconds(),
    f.getUTCMilliseconds(),
  ).getTime()
}

const cache = new Map<string, RRule>()

function parse(rule: string): RRule {
  let parsed = cache.get(rule)
  if (!parsed) {
    const result = rrulestr(rule)
    if (!(result instanceof RRule)) throw new Error(`Unsupported recurrence: ${rule}`)
    if (!RRULE_TO_FREQ.has(result.origOptions.freq ?? -1)) throw new Error(`Unsupported frequency: ${rule}`)
    if (cache.size >= 256) cache.clear()
    cache.set(rule, result)
    parsed = result
  }
  return parsed
}

/** Serializes a rule whose first occurrence is at `start` (local time). */
export function buildRecurrence(spec: RecurrenceSpec, start: number): string {
  const options: Partial<Options> = { freq: FREQ_TO_RRULE[spec.freq], dtstart: toFloating(start) }
  if (spec.interval !== undefined && spec.interval > 1) options.interval = Math.floor(spec.interval)
  if (spec.freq === 'weekly' && spec.byWeekday?.length) {
    options.byweekday = WEEKDAY_CODES.filter((c) => spec.byWeekday!.includes(c)).map((c) => WEEKDAY_TO_RRULE[c])
  }
  if (spec.count !== undefined) options.count = Math.max(1, Math.floor(spec.count))
  if (spec.until !== undefined) options.until = toFloating(spec.until)

  // rrule.js marks everything as UTC; these are floating local times.
  return new RRule(options)
    .toString()
    .replace(/(DTSTART:\d{8}T\d{6})Z/, '$1')
    .replace(/(UNTIL=\d{8}T\d{6})Z/, '$1')
}

export function isValidRecurrence(rule: string): boolean {
  try {
    parse(rule)
    return true
  } catch {
    return false
  }
}

/** First occurrence after `after` (or at it, when inclusive), or null once the rule is exhausted. */
export function nextOccurrence(rule: string, after: number, inclusive = false): number | null {
  const next = parse(rule).after(toFloating(after), inclusive)
  return next ? fromFloating(next) : null
}

/** Occurrences in [start, end], capped at `limit`. */
export function occurrencesBetween(rule: string, start: number, end: number, limit = 100): number[] {
  const out: number[] = []
  parse(rule).between(toFloating(start), toFloating(end), true, (date) => {
    out.push(fromFloating(date))
    return out.length < limit
  })
  return out
}

/** The rule's DTSTART as a local instant. */
export function recurrenceStart(rule: string): number {
  const dtstart = parse(rule).options.dtstart
  return fromFloating(dtstart)
}

/** Human-readable form, e.g. "every week on Monday, Wednesday". */
export function describeRecurrence(rule: string): string {
  return parse(rule).toText()
}

/** Reads a stored rule back into the editable spec. */
export function recurrenceSpec(rule: string): RecurrenceSpec {
  const o = parse(rule).origOptions
  const spec: RecurrenceSpec = { freq: RRULE_TO_FREQ.get(o.freq!)! }
  if (o.interval !== undefined && o.interval > 1) spec.interval = o.interval
  if (o.byweekday !== undefined && o.byweekday !== null) {
    const days = (Array.isArray(o.byweekday) ? o.byweekday : [o.byweekday]) as ByWeekday[]
    spec.byWeekday = days.map(weekdayCode)
  }
  if (o.count !== undefined && o.count !== null) spec.count = o.count
  if (o.until) spec.until = fromFloating(o.until)
  return spec
}

/** Same pattern, new first occurrence. */
export function rebaseRecurrence(rule: string, start: number): string {
  return buildRecurrence(recurrenceSpec(rule), start)
}

function weekdayCode(day: ByWeekday): WeekdayCode {
  if (typeof day === 'string') return day
  const index = typeof day === 'number' ? day : day.weekday
  return WEEKDAY_CODES[index]!
}
