import {
  compareByUrgency,
  isImportant,
  nextUrgencyChangeAt,
  urgencyOf,
  type InboxRecord,
  type Reminder,
  type SenderRule,
  type UrgencyLevel,
} from '@cairn/core'
import { courseColor, type CourseColorOverrides, type Scheme } from './courseColors'
import { formatReminderWhen } from './format'
import { URGENCY } from './tokens'

/**
 * What the home-screen widget shows, worked out from the phone's own store
 * and nothing else, so drawing it never waits on the network.
 *
 * Today's tasks and anything overdue or due soon, most urgent first, the
 * same order the Tasks tab uses. Each row has the urgency's colour and its
 * symbol, so it reads without colour too.
 */

export interface WidgetRow {
  id: string
  title: string
  /** "Overdue · 4:35 PM", "Today 6:00 PM". */
  when: string
  urgency: UrgencyLevel
  /** The urgency's colour, for the strip and the circle. */
  color: string
  /** Its symbol and label, so overdue and due soon never rely on colour alone. */
  symbol: string
  label: string
  /** The class's colour, for tasks made from coursework. */
  course?: string
}

export interface WidgetData {
  rows: WidgetRow[]
  /** Due today or late, beyond what fits. */
  more: number
  /** Said when there is nothing due today. */
  empty?: string
  /** New Classroom posts and important mail since each tab was last opened. */
  classroom: number
  mail: number
  /** When a colour next changes, for the next redraw. */
  nextChangeAt: number | null
}

export interface WidgetInbox {
  records: readonly InboxRecord[]
  seenAt: number
  seenClassroomAt: number
  senders?: Readonly<Record<string, SenderRule>>
}

const SHOWN: readonly UrgencyLevel[] = ['overdue', 'soon', 'today']

/** Rows that fit a widget this many dp tall: a header, then about 44dp a row. Three on the smallest. */
export function widgetRowsFor(heightDp: number): number {
  return Math.max(3, Math.min(8, Math.floor((heightDp - 52) / 44)))
}

/** Important mail and Classroom posts found since each tab was last opened, the same count the tabs' badges show. */
export function unseenCounts(inbox: WidgetInbox): { mail: number; classroom: number } {
  let mail = 0
  let classroom = 0
  for (const r of inbox.records) {
    if (r.dismissed || r.read) continue
    if (r.classroom) {
      if (r.foundAt > inbox.seenClassroomAt && !r.classroom.submitted) classroom++
    } else if (r.foundAt > inbox.seenAt && isImportant(r, inbox.senders)) mail++
  }
  return { mail, classroom }
}

export function widgetData(
  reminders: readonly Reminder[],
  now: number,
  options: { limit: number; inbox?: WidgetInbox; courseColors?: CourseColorOverrides; scheme?: Scheme; locale?: string },
): WidgetData {
  const live = reminders.filter((r) => r.deletedAt === undefined && r.status !== 'done')
  const due = live.filter((r) => SHOWN.includes(urgencyOf(r, now))).sort(compareByUrgency(now))
  const rows = due.slice(0, options.limit).map((r): WidgetRow => {
    const urgency = urgencyOf(r, now)
    const token = URGENCY[urgency]
    const course = courseColor(r.courseId, options.courseColors, options.scheme)
    return {
      id: r.id,
      title: r.title,
      when: formatReminderWhen(r, now, { locale: options.locale }),
      urgency,
      color: token.color,
      symbol: token.symbol,
      label: token.label,
      ...(course ? { course } : {}),
    }
  })
  let nextChangeAt: number | null = null
  for (const r of live) {
    const change = nextUrgencyChangeAt(r, now)
    if (change !== null && (nextChangeAt === null || change < nextChangeAt)) nextChangeAt = change
  }
  let empty: string | undefined
  if (rows.length === 0) {
    const next = [...live].sort(compareByUrgency(now))[0]
    empty = next ? `Nothing due today. Next: ${next.title}, ${formatReminderWhen(next, now, { locale: options.locale })}` : 'Nothing due today.'
  }
  const counts = options.inbox ? unseenCounts(options.inbox) : { mail: 0, classroom: 0 }
  return { rows, more: Math.max(0, due.length - rows.length), ...(empty ? { empty } : {}), ...counts, nextChangeAt }
}

/** Links the widget opens in the app. */
export const WIDGET_LINKS = {
  task: (id: string) => `cairn://task/${encodeURIComponent(id)}`,
  capture: 'cairn://capture',
  tasks: 'cairn://tasks',
  classroom: 'cairn://classroom',
  inbox: 'cairn://inbox',
} as const

export type WidgetLink = { kind: 'task'; id: string } | { kind: 'capture' } | { kind: 'section'; section: 'tasks' | 'classroom' | 'inbox' }

/** What a link from the widget asks for; null for any other link, such as a sign-in coming back. */
export function readWidgetLink(url: string | null | undefined): WidgetLink | null {
  const match = /^cairn:\/\/([a-z]+)(?:\/([^?#]+))?\/?(?:[?#].*)?$/.exec(url ?? '')
  if (!match) return null
  const [, what, rest] = match
  if (what === 'task' && rest) {
    try {
      return { kind: 'task', id: decodeURIComponent(rest) }
    } catch {
      return null
    }
  }
  if (what === 'capture' && !rest) return { kind: 'capture' }
  if ((what === 'tasks' || what === 'classroom' || what === 'inbox') && !rest) return { kind: 'section', section: what }
  return null
}
