/** Fields every synced document carries. */
export interface Entity {
  /** UUIDv7: sortable and generated on the client, so creating never needs a round-trip. */
  id: string
  userId: string
  createdAt: number
  /** Client clock. Drives last-write-wins conflict resolution. */
  updatedAt: number
  /** Tombstone. Entities are never hard-deleted, or offline devices resurrect them. */
  deletedAt?: number
}

export type Source = 'manual' | 'email' | 'classroom'

export type Priority = 'low' | 'normal' | 'high'

/**
 * Only records what the user did. "Overdue" and "missed" are derived from the
 * clock (see urgency.ts and reminders.ts), so no device ever has to spend a
 * write just because time passed.
 */
export type ReminderStatus = 'pending' | 'snoozed' | 'done'

export interface Note extends Entity {
  title: string
  body?: string
  /** The body before the last edit, so a last-write-wins clobber is recoverable. */
  bodyPrev?: string
  tags: string[]
  courseId?: string
  pinned: boolean
  source: Source
  /** Gmail message id or Classroom courseWork id this came from. */
  sourceRef?: string
}

export interface Reminder extends Entity {
  title: string
  noteId?: string
  /** When it is due. For all-day reminders, the time of day to alert on the due day. */
  dueAt: number
  /** Due on a day rather than at a time: it only becomes overdue once that day ends. */
  allDay: boolean
  /** Floating-time DTSTART plus RRULE (RFC 5545). See recurrence.ts. */
  rrule?: string
  priority: Priority
  status: ReminderStatus
  snoozedUntil?: number
  /** When it was last completed. For recurring reminders, the last completed occurrence. */
  completedAt?: number
  /** Minutes before dueAt to alert. Absent means a single alert at dueAt. */
  alertOffsets?: number[]
  tags: string[]
  courseId?: string
  source: Source
  sourceRef?: string
  autoCompleteOn?: 'classroom-submission'
}

export interface CreateContext {
  userId: string
  now: number
  /** Supply an id to make creation idempotent (e.g. derived from a Classroom id). */
  id?: string
}
