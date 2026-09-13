import {
  buildRecurrence,
  parseCapture,
  recurrenceSpec,
  WEEKDAY_CODES,
  type Priority,
  type RecurrenceSpec,
  type Reminder,
  type ReminderChanges,
  type ReminderInput,
  type WeekdayCode,
} from '@cairn/core'

/** Presets in the Repeat dropdown. "custom" keeps a rule the presets can't express (intervals, several days). */
export type RepeatChoice = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'custom'

/** The reminder editor's form state. Dates and times use the formats of <input type="date|time">. */
export interface ReminderDraft {
  title: string
  /** yyyy-mm-dd, local. */
  date: string
  /** HH:mm local; empty means all day. */
  time: string
  repeat: RepeatChoice
  customRule?: RecurrenceSpec
  priority: Priority
  tags: string
  /** Minutes before due. Empty means no alert. */
  alerts: number[]
}

export const ALERT_CHOICES = [
  { minutes: 0, label: 'At the due time' },
  { minutes: 10, label: '10 minutes before' },
  { minutes: 60, label: '1 hour before' },
  { minutes: 24 * 60, label: '1 day before' },
] as const

const WORKWEEK: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR']
const pad = (n: number) => String(n).padStart(2, '0')

export function toDateInput(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toTimeInput(t: number): string {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Local instant from the date and time inputs; all-day reminders alert at `defaultHour`. */
export function fromInputs(date: string, time: string, defaultHour: number): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!d) return null
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (time && !t) return null
  const [hour, minute] = t ? [Number(t[1]), Number(t[2])] : [defaultHour, 0]
  return new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), hour, minute).getTime()
}

function weekdayOf(t: number): WeekdayCode {
  return WEEKDAY_CODES[(new Date(t).getDay() + 6) % 7]!
}

export function repeatChoiceOf(spec: RecurrenceSpec, dueAt: number): RepeatChoice {
  if (spec.interval !== undefined || spec.count !== undefined || spec.until !== undefined) return 'custom'
  if (spec.freq !== 'weekly') return spec.freq
  const days = spec.byWeekday ?? []
  if (days.length === 5 && WORKWEEK.every((d) => days.includes(d))) return 'weekdays'
  if (days.length === 0 || (days.length === 1 && days[0] === weekdayOf(dueAt))) return 'weekly'
  return 'custom'
}

export function specForChoice(choice: RepeatChoice, customRule?: RecurrenceSpec): RecurrenceSpec | null {
  switch (choice) {
    case 'none':
      return null
    case 'weekdays':
      return { freq: 'weekly', byWeekday: WORKWEEK }
    case 'custom':
      return customRule ?? null
    default:
      return { freq: choice }
  }
}

export function emptyDraft(now: number): ReminderDraft {
  return { title: '', date: toDateInput(now), time: '', repeat: 'none', priority: 'normal', tags: '', alerts: [0] }
}

export function draftFromReminder(r: Reminder): ReminderDraft {
  const spec = r.rrule ? recurrenceSpec(r.rrule) : undefined
  const repeat = spec ? repeatChoiceOf(spec, r.dueAt) : 'none'
  return {
    title: r.title,
    date: toDateInput(r.dueAt),
    time: r.allDay ? '' : toTimeInput(r.dueAt),
    repeat,
    ...(repeat === 'custom' && spec && { customRule: spec }),
    priority: r.priority,
    tags: r.tags.join(' '),
    alerts: r.alertOffsets ?? [0],
  }
}

/**
 * Fills date, time and repeat from natural language ("fri 6pm", "every
 * weekday 9am"). Returns null when nothing in the text was understood.
 */
export function applyWhen(draft: ReminderDraft, text: string, now: number): ReminderDraft | null {
  const parsed = parseCapture(text, now)
  if (parsed.dueAt === undefined) return null
  const next: ReminderDraft = { ...draft, date: toDateInput(parsed.dueAt), time: parsed.allDay ? '' : toTimeInput(parsed.dueAt) }
  delete next.customRule
  if (parsed.rrule) {
    const spec = recurrenceSpec(parsed.rrule)
    next.repeat = repeatChoiceOf(spec, parsed.dueAt)
    if (next.repeat === 'custom') next.customRule = spec
  } else {
    next.repeat = 'none'
  }
  return next
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string }

interface DraftValues {
  title: string
  dueAt: number
  allDay: boolean
  recurrence: RecurrenceSpec | null
  priority: Priority
  tags: string[]
  alertOffsets: number[]
}

function readDraft(draft: ReminderDraft, defaultHour: number): Checked<DraftValues> {
  const title = draft.title.trim()
  if (!title) return { ok: false, error: 'Give it a title' }
  const dueAt = fromInputs(draft.date, draft.time, defaultHour)
  if (dueAt === null) return { ok: false, error: 'Pick a date' }
  return {
    ok: true,
    value: {
      title,
      dueAt,
      allDay: draft.time === '',
      recurrence: specForChoice(draft.repeat, draft.customRule),
      priority: draft.priority,
      tags: draft.tags.split(/[\s,]+/).filter(Boolean),
      alertOffsets: draft.alerts,
    },
  }
}

export function inputFromDraft(draft: ReminderDraft, defaultHour = 9): Checked<ReminderInput> {
  const read = readDraft(draft, defaultHour)
  if (!read.ok) return read
  const { recurrence, ...rest } = read.value
  return { ok: true, value: { ...rest, ...(recurrence && { rrule: buildRecurrence(recurrence, rest.dueAt) }) } }
}

/**
 * Only re-anchors the repeat rule when the schedule actually changed, so
 * editing a title doesn't restart a series (and its occurrence count).
 */
export function changesFromDraft(r: Reminder, draft: ReminderDraft, defaultHour = 9): Checked<ReminderChanges> {
  const read = readDraft(draft, defaultHour)
  if (!read.ok) return read
  const { recurrence, ...rest } = read.value
  const before = draftFromReminder(r)
  const scheduleChanged =
    draft.date !== before.date ||
    draft.time !== before.time ||
    draft.repeat !== before.repeat ||
    JSON.stringify(draft.customRule) !== JSON.stringify(before.customRule)
  return { ok: true, value: scheduleChanged ? { ...rest, recurrence } : { ...rest, dueAt: r.dueAt, allDay: r.allDay } }
}
