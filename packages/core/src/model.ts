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
  /**
   * Deleted forever: a tombstone emptied of everything but its id and stamps.
   * It outranks any other version of the same id, however late, so a device
   * that was offline while it happened cannot bring the content back.
   */
  purgedAt?: number
}

export type Source = 'manual' | 'email' | 'classroom'

export type Priority = 'low' | 'normal' | 'high'

/**
 * Only records what the user did. "Overdue" and "missed" are derived from the
 * clock (see urgency.ts and reminders.ts), so no device ever has to spend a
 * write just because time passed.
 */
export type ReminderStatus = 'pending' | 'snoozed' | 'done'

export type AttachmentKind = 'image' | 'audio'

/**
 * An image or recording written into a note. Only the description lives in the
 * document; the file itself stays on the device that made it and in the owner's
 * Drive once uploaded, so notes remain small enough to sync for free.
 *
 * There is deliberately no file path here. A path is only true on the phone
 * that wrote it, and this record syncs everywhere — so each device keeps its
 * copy at a place derived from the id, and fetches it from Drive when missing.
 *
 * Where it sits in the writing is the body's business — see blocks.ts.
 */
export interface Attachment {
  id: string
  kind: AttachmentKind
  mime: string
  bytes?: number
  /** Images: known up front, so a placeholder can hold the right shape while the file loads. */
  width?: number
  height?: number
  /** Images: shown across the page unless made small, so a photo need not take over a note. */
  size?: 'small'
  /** Audio. */
  durationMs?: number
  /** Set once uploaded; how every other device gets it. */
  driveFileId?: string
  createdAt: number
}

export interface Note extends Entity {
  title: string
  body?: string
  /** The body before the last edit, so a last-write-wins clobber is recoverable. */
  bodyPrev?: string
  /** Only those the body still points at; see pruneAttachments. */
  attachments?: Attachment[]
  tags: string[]
  courseId?: string
  pinned: boolean
  source: Source
  /** Gmail message id or Classroom courseWork id this came from. */
  sourceRef?: string
}

export interface Reminder extends Entity {
  title: string
  /** Everything written under the title. A dated line typed in the editor keeps its body here. */
  body?: string
  /** The body before the last edit, so a last-write-wins clobber is recoverable. */
  bodyPrev?: string
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
  /** Minutes before dueAt to alert. Absent means a single alert at dueAt; empty means silent. */
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
