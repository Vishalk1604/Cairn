import * as chrono from 'chrono-node'
import type { Priority } from './model'
import { buildRecurrence, nextOccurrence, type RecurrenceSpec, type WeekdayCode } from './recurrence'
import { addLocalDays, atLocalTime } from './time'

export type CaptureTokenKind = 'date' | 'recurrence' | 'tag' | 'priority'

/** A piece of the input that was understood, for highlighting in the capture box. */
export interface CaptureToken {
  kind: CaptureTokenKind
  text: string
  start: number
  end: number
}

export interface CaptureResult {
  /** Anything with a date or a repeat becomes a reminder; everything else is a note. */
  kind: 'note' | 'reminder'
  title: string
  dueAt?: number
  allDay: boolean
  rrule?: string
  priority: Priority
  tags: string[]
  tokens: CaptureToken[]
}

export interface CaptureOptions {
  /** Alert time for reminders given a day but no time. Defaults to 9:00. */
  defaultHour?: number
  defaultMinute?: number
}

const WEEKDAY = '(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)'
const WEEKDAY_PLURAL = '(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)'
const LIST_SEPARATOR = '\\s*(?:,|and|&|/)\\s*'
const WORKWEEK: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR']
const WEEKEND: WeekdayCode[] = ['SA', 'SU']
const UNIT_TO_FREQ = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' } as const

const RECURRENCE_PATTERNS: { pattern: RegExp; spec: (m: RegExpExecArray) => RecurrenceSpec }[] = [
  {
    pattern: /\b(?:every|each)\s+(weekday|weekend)s?\b|\b(weekday|weekend)s\b/i,
    spec: (m) => ({ freq: 'weekly', byWeekday: /weekday/i.test(m[1] ?? m[2]!) ? WORKWEEK : WEEKEND }),
  },
  {
    pattern: /\b(?:every|each)\s+(other|\d+)\s+(day|week|month|year)s?\b/i,
    spec: (m) => ({
      freq: UNIT_TO_FREQ[m[2]!.toLowerCase() as keyof typeof UNIT_TO_FREQ],
      interval: m[1]!.toLowerCase() === 'other' ? 2 : Number(m[1]),
    }),
  },
  {
    pattern: new RegExp(`\\b(?:every|each)\\s+${WEEKDAY}(?:${LIST_SEPARATOR}${WEEKDAY})*\\b`, 'i'),
    spec: (m) => ({ freq: 'weekly', byWeekday: weekdaysIn(m[0]) }),
  },
  {
    pattern: new RegExp(`\\b${WEEKDAY_PLURAL}(?:${LIST_SEPARATOR}${WEEKDAY_PLURAL})*\\b`, 'i'),
    spec: (m) => ({ freq: 'weekly', byWeekday: weekdaysIn(m[0]) }),
  },
  {
    pattern: /\b(?:every|each)\s+(day|week|month|year)\b/i,
    spec: (m) => ({ freq: UNIT_TO_FREQ[m[1]!.toLowerCase() as keyof typeof UNIT_TO_FREQ] }),
  },
  {
    pattern: /\b(daily|everyday|weekly|monthly|yearly|annually)\b/i,
    spec: (m) => {
      const word = m[1]!.toLowerCase()
      if (word === 'daily' || word === 'everyday') return { freq: 'daily' }
      if (word === 'weekly') return { freq: 'weekly' }
      if (word === 'monthly') return { freq: 'monthly' }
      return { freq: 'yearly' }
    },
  },
]

/** Words that attach a date to the sentence and should leave the title with it. */
const DATE_LEAD_IN = /(?:^|\s)((?:by|due|on|at|before|until|till|starting)\s+)$/i
const MONTH_LEAD_IN = /(?:^|\s)(in\s+)$/i
const MONTH_NAME = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i
const TRAILING_CONNECTOR = /\s+(?:by|due|on|at|before|until|till|for|every|starting)$/i
const PREAMBLE = /^\s*(?:remind me to|remember to|don'?t forget to|reminder:?)\s+/i
/** Short date words that are also ordinary words ("Sun Tzu", "SAT prep", "may"). */
const AMBIGUOUS_DATE_WORD = /^(?:mon|tue|wed|thu|fri|sat|sun|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|march)$/i
const AMBIGUOUS_OK_AFTER = /\b(?:on|by|due|until|till|before|this|next|in|from)\s*$/i
const TIME_OF_DAY_WORD = /\b(?:tonight|morning|afternoon|evening|night|noon|midday|midnight)\b/i

/** "the 1st", "on the 15th": chrono has no parser for a bare day of the month. */
const dayOfMonthParser: chrono.Parser = {
  pattern: () => /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b(?!\s+(?:of\s+)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/i,
  extract: (context, match) => {
    const day = Number(match[1])
    if (day < 1 || day > 31) return null
    const ref = context.reference.instant
    let month = ref.getMonth() + (day < ref.getDate() ? 1 : 0)
    for (let i = 0; i < 12; i++, month++) {
      const year = ref.getFullYear() + Math.floor(month / 12)
      const m = month % 12
      if (day <= new Date(year, m + 1, 0).getDate()) return { year, month: m + 1, day }
    }
    return null
  },
}

let parser: chrono.Chrono | undefined
function dateParser(): chrono.Chrono {
  if (!parser) {
    parser = chrono.casual.clone()
    parser.parsers.push(dayOfMonthParser)
  }
  return parser
}

/**
 * Turns quick-capture text like "submit DBMS assignment friday 6pm #dbms !high"
 * into a reminder (or a note, when there's no date). Text in quotes is never
 * interpreted.
 */
export function parseCapture(input: string, now: number, options: CaptureOptions = {}): CaptureResult {
  const defaultHour = options.defaultHour ?? 9
  const defaultMinute = options.defaultMinute ?? 0
  const tokens: CaptureToken[] = []
  const removed = new Array<boolean>(input.length).fill(false)
  // The input with already-claimed text blanked out. Same length as the input,
  // so every index found in it is an index into the original.
  let mask = input

  const blank = (start: number, end: number, fill = ' ') => {
    mask = mask.slice(0, start) + fill.repeat(end - start) + mask.slice(end)
  }
  const claim = (kind: CaptureTokenKind | null, start: number, end: number) => {
    if (kind) tokens.push({ kind, text: input.slice(start, end), start, end })
    for (let i = start; i < end; i++) removed[i] = true
    blank(start, end)
  }

  for (const m of input.matchAll(/"([^"]*)"|“([^”]*)”/g)) {
    const start = m.index
    const end = start + m[0].length
    removed[start] = true
    removed[end - 1] = true
    blank(start, end, '_')
  }

  const preamble = PREAMBLE.exec(mask)
  if (preamble) claim(null, preamble.index, preamble.index + preamble[0].length)

  const tags: string[] = []
  for (const m of mask.matchAll(/(^|\s)#([^\s#!"“”]+)/g)) {
    const tag = m[2]!.replace(/[.,;:?)]+$/, '')
    if (!tag) continue
    const start = m.index + m[1]!.length
    tags.push(tag.toLowerCase())
    claim('tag', start, start + 1 + tag.length)
  }

  let priority: Priority = 'normal'
  for (const m of mask.matchAll(/(^|\s)(!{1,3}|!(?:high|h|urgent|low|l|normal|n))(?=\s|$)/gi)) {
    const marker = m[2]!.toLowerCase()
    priority = /^!(?:low|l)$/.test(marker) ? 'low' : /^!(?:normal|n)$/.test(marker) ? 'normal' : 'high'
    const start = m.index + m[1]!.length
    claim('priority', start, start + m[2]!.length)
  }

  let recurrence: RecurrenceSpec | undefined
  for (const { pattern, spec } of RECURRENCE_PATTERNS) {
    const m = pattern.exec(mask)
    if (!m) continue
    recurrence = spec(m)
    const lead = DATE_LEAD_IN.exec(mask.slice(0, m.index))
    claim('recurrence', m.index - (lead?.[1]!.length ?? 0), m.index + m[0].length)
    break
  }

  const result = dateParser()
    .parse(mask, new Date(now), { forwardDate: true })
    .find((r) => !isAmbiguousWord(r, mask))

  let dueAt: number | undefined
  let allDay = false
  if (result) {
    ;({ dueAt, allDay } = resolveDate(result, now, defaultHour, defaultMinute))
    const before = mask.slice(0, result.index)
    const lead = DATE_LEAD_IN.exec(before) ?? (MONTH_NAME.test(result.text) ? MONTH_LEAD_IN.exec(before) : null)
    claim('date', result.index - (lead?.[1]!.length ?? 0), result.index + result.text.length)
  }

  let rrule: string | undefined
  if (recurrence) {
    if (dueAt === undefined) {
      dueAt = atLocalTime(now, defaultHour, defaultMinute)
      allDay = true
    }
    // Snap onto the first real occurrence (e.g. "every monday" typed on a Wednesday).
    const first = nextOccurrence(buildRecurrence(recurrence, dueAt), dueAt, true)
    if (first !== null) {
      dueAt = first
      rrule = buildRecurrence(recurrence, first)
    }
  }

  tokens.sort((a, b) => a.start - b.start)
  return {
    kind: dueAt === undefined ? 'note' : 'reminder',
    title: buildTitle(input, removed, tokens.some((t) => t.kind === 'date' || t.kind === 'recurrence')),
    ...(dueAt !== undefined && { dueAt }),
    allDay,
    ...(rrule !== undefined && { rrule }),
    priority,
    tags: [...new Set(tags)],
    tokens,
  }
}

function resolveDate(
  result: chrono.ParsedResult,
  now: number,
  defaultHour: number,
  defaultMinute: number,
): { dueAt: number; allDay: boolean } {
  const start = result.start
  const date = start.date().getTime()

  if (!start.isCertain('hour')) {
    // "tonight", "friday morning": chrono's implied hour is meaningful.
    if (TIME_OF_DAY_WORD.test(result.text)) return { dueAt: date, allDay: false }
    return { dueAt: atLocalTime(date, defaultHour, defaultMinute), allDay: true }
  }

  const hour = start.get('hour') ?? 0
  if (!start.isCertain('meridiem') && hour >= 1 && hour <= 7) {
    // "call mom at 5" means 5pm, not 5am.
    const minute = start.get('minute') ?? 0
    if (start.isCertain('day') || start.isCertain('weekday')) {
      return { dueAt: atLocalTime(date, hour + 12, minute), allDay: false }
    }
    let t = atLocalTime(now, hour + 12, minute)
    if (t <= now) t = addLocalDays(t, 1)
    return { dueAt: t, allDay: false }
  }
  return { dueAt: date, allDay: false }
}

/**
 * Rejects a bare "sun"/"sat"/"may" in the middle of a sentence ("Sun Tzu",
 * "SAT prep"), while still accepting it at the end ("lab report sat") or
 * after a date word ("by sat").
 */
function isAmbiguousWord(result: chrono.ParsedResult, mask: string): boolean {
  if (!AMBIGUOUS_DATE_WORD.test(result.text.trim())) return false
  const atEnd = mask.slice(result.index + result.text.length).trim() === ''
  return !atEnd && !AMBIGUOUS_OK_AFTER.test(mask.slice(0, result.index))
}

function buildTitle(input: string, removed: readonly boolean[], claimedTime: boolean): string {
  let title = ''
  for (let i = 0; i < input.length; i++) title += removed[i] ? ' ' : input[i]
  title = title.replace(/\s+/g, ' ').trim()
  if (claimedTime) {
    let prev
    do {
      prev = title
      title = title.replace(TRAILING_CONNECTOR, '').replace(/^(?:on|by|at)\s+/i, '')
    } while (title !== prev)
  }
  title = title.replace(/^[\s,;:\-–—@]+|[\s,;:\-–—@]+$/g, '')
  return title || input.replace(/["“”]/g, '').trim()
}

function weekdaysIn(text: string): WeekdayCode[] {
  const found = new Set<WeekdayCode>()
  for (const m of text.matchAll(new RegExp(WEEKDAY, 'gi'))) {
    found.add(m[0].slice(0, 2).toUpperCase() as WeekdayCode)
  }
  return [...found]
}
