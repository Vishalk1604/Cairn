import {
  completeReminder,
  createNote,
  createReminder,
  deleteNote,
  deleteReminder,
  nextStamp,
  parseCapture,
  reopenReminder,
  rescheduleReminder,
  skipOccurrence,
  snoozeReminder,
  updateNote,
  updateReminder,
  type CaptureOptions,
  type CaptureResult,
  type Entity,
  type Note,
  type NoteChanges,
  type NoteInput,
  type Reminder,
  type ReminderChanges,
  type ReminderInput,
} from '@cairn/core'
import type { NoteRepository, ReminderRepository, Repository } from '@cairn/sync'
import { formatDue } from './format'

export interface Toast {
  message: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
}

export interface ActionDeps {
  reminders: ReminderRepository
  notes: NoteRepository
  userId: string
  /** Shows a transient message, optionally with an action button (Undo). */
  toast: (toast: Toast) => void
  now?: () => number
  capture?: CaptureOptions
  locale?: string
}

export type Actions = ReturnType<typeof createActions>

/**
 * Every user-initiated change, shared by both apps. Errors become error
 * toasts instead of exceptions, and destructive changes offer Undo, which
 * writes the earlier version back stamped with the current time so
 * last-write-wins accepts it.
 */
export function createActions({ reminders, notes, userId, toast, now = Date.now, capture, locale }: ActionDeps) {
  const ctx = () => ({ userId, now: now() })
  const when = (t: number, allDay: boolean) => formatDue(t, allDay, now(), { locale })

  const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn()
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
      return undefined
    }
  }

  /** Undo: put `before` back, stamped later than the version that replaced it. */
  const restore = <T extends Entity>(repo: Repository<T, unknown>, before: T, replacedBy: T) => () =>
    void repo.upsert({ ...before, updatedAt: nextStamp(replacedBy.updatedAt, now()) })

  const changeReminder = (r: Reminder, change: (r: Reminder, now: number) => Reminder, message?: (next: Reminder) => string) =>
    run(async () => {
      const next = change(r, now())
      await reminders.upsert(next)
      if (message) toast({ message: message(next), action: { label: 'Undo', run: restore(reminders, r, next) } })
      return next
    })

  return {
    /** Quick capture. With `literal`, the text is saved as a note without being interpreted. */
    capture: (text: string, literal = false) =>
      run(async (): Promise<CaptureResult | null> => {
        if (literal) {
          const n = createNote({ title: text }, ctx())
          await notes.upsert(n)
          toast({ message: `Saved note “${n.title}”`, action: { label: 'Undo', run: () => void notes.remove(n.id, now()) } })
          return null
        }
        const parsed = parseCapture(text, now(), capture)
        if (parsed.kind === 'reminder') {
          const r = createReminder(
            { title: parsed.title, dueAt: parsed.dueAt!, allDay: parsed.allDay, rrule: parsed.rrule, priority: parsed.priority, tags: parsed.tags },
            ctx(),
          )
          await reminders.upsert(r)
          toast({
            message: `Added “${r.title}” for ${when(r.dueAt, r.allDay)}`,
            action: { label: 'Undo', run: () => void reminders.remove(r.id, now()) },
          })
        } else {
          const n = createNote({ title: parsed.title, tags: parsed.tags }, ctx())
          await notes.upsert(n)
          toast({ message: `Saved note “${n.title}”`, action: { label: 'Undo', run: () => void notes.remove(n.id, now()) } })
        }
        return parsed
      }),

    addReminder: (input: ReminderInput) =>
      run(async () => {
        const r = createReminder(input, ctx())
        await reminders.upsert(r)
        return r
      }),
    saveReminder: (r: Reminder, changes: ReminderChanges) => changeReminder(r, (r, t) => updateReminder(r, changes, t)),
    complete: (r: Reminder) =>
      changeReminder(r, completeReminder, (next) =>
        next.status === 'done' ? `Completed “${r.title}”` : `Done for now. Next “${r.title}” ${when(next.dueAt, next.allDay)}`,
      ),
    reopen: (r: Reminder) => changeReminder(r, reopenReminder),
    skip: (r: Reminder) => changeReminder(r, skipOccurrence, (next) => `Skipped. Next one ${when(next.dueAt, next.allDay)}`),
    snooze: (r: Reminder, until: number) =>
      changeReminder(r, (r, t) => snoozeReminder(r, until, t), () => `Snoozed until ${when(until, false)}`),
    unsnooze: (r: Reminder) => changeReminder(r, (r, t) => rescheduleReminder(r, r.dueAt, t)),
    removeReminder: (r: Reminder) => changeReminder(r, deleteReminder, () => `Deleted “${r.title}”`),

    addNote: (input: NoteInput) =>
      run(async () => {
        const n = createNote(input, ctx())
        await notes.upsert(n)
        return n
      }),
    saveNote: (n: Note, changes: NoteChanges) =>
      run(async () => {
        const next = updateNote(n, changes, now())
        await notes.upsert(next)
        return next
      }),
    togglePin: (n: Note) => run(() => notes.upsert(updateNote(n, { pinned: !n.pinned }, now()))),
    removeNote: (n: Note) =>
      run(async () => {
        const deleted = deleteNote(n, now())
        await notes.upsert(deleted)
        toast({ message: `Deleted note “${n.title || 'Untitled'}”`, action: { label: 'Undo', run: restore(notes, n, deleted) } })
      }),
  }
}
