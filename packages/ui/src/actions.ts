import {
  completeReminder,
  createNote,
  createReminder,
  deleteNote,
  deleteReminder,
  nextStamp,
  parseCapture,
  purgeNote,
  reopenReminder,
  rescheduleReminder,
  revive,
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
import { noteHeading } from './noteMeta'

export interface Toast {
  message: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
}

/** What the composer collected: a title line, and anything written under it. */
export interface CaptureInput {
  title: string
  body?: string
}

/** Something to call a note by in a message, when it has no title of its own. */
function noteName(title: string, body: string | undefined): string {
  return title || (body ?? '').trim().split('\n')[0] || 'Untitled'
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
    /**
     * The one way in. The title line is read for a date, a repeat, tags and
     * priority; the body is whatever else you wrote. A title with a date
     * becomes a reminder, anything else becomes a note, and a dated title
     * with a body becomes both, linked, so the detail is there when the
     * reminder goes off. With `literal`, nothing is interpreted.
     */
    capture: (input: CaptureInput, literal = false) =>
      run(async (): Promise<CaptureResult | null> => {
        const title = input.title.trim()
        const body = input.body?.trim() ? input.body : undefined
        if (!title && !body) return null

        if (literal || !title) {
          const n = createNote({ title, body }, ctx())
          await notes.upsert(n)
          toast({ message: `Saved note “${noteName(n.title, body)}”`, action: { label: 'Undo', run: () => void notes.remove(n.id, now()) } })
          return null
        }

        const parsed = parseCapture(title, now(), capture)
        if (parsed.kind === 'reminder') {
          // The body stays on the task itself. One dated thought is one item:
          // splitting it into a task plus a note made the writing go somewhere
          // the task did not take you.
          const r = createReminder(
            {
              title: parsed.title,
              body,
              dueAt: parsed.dueAt!,
              allDay: parsed.allDay,
              rrule: parsed.rrule,
              priority: parsed.priority,
              tags: parsed.tags,
            },
            ctx(),
          )
          await reminders.upsert(r)
          toast({
            message: `Added “${r.title}” for ${when(r.dueAt, r.allDay)}`,
            action: { label: 'Undo', run: () => void reminders.remove(r.id, now()) },
          })
        } else {
          const n = createNote({ title: parsed.title, body, tags: parsed.tags }, ctx())
          await notes.upsert(n)
          toast({ message: `Saved note “${noteName(n.title, body)}”`, action: { label: 'Undo', run: () => void notes.remove(n.id, now()) } })
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
        toast({ message: `Moved “${noteHeading(n)}” to the recycle bin`, action: { label: 'Undo', run: restore(notes, n, deleted) } })
      }),
    /** Takes a note back out of the recycle bin, photos and all. */
    restoreNote: (n: Note) =>
      run(async () => {
        const alive = revive(n, now())
        await notes.upsert(alive)
        toast({ message: `Restored “${noteHeading(n)}”` })
        return alive
      }),
    /**
     * Delete forever, from the recycle bin. There is no Undo: the marker that
     * replaces the note outranks every copy of it, so asking first is the
     * caller's job.
     */
    purgeNotes: (binned: readonly Note[]) =>
      run(async () => {
        const gone = binned.filter((n) => n.deletedAt !== undefined).map((n) => purgeNote(n, now()))
        if (gone.length === 0) return
        await notes.upsertMany(gone)
        toast({ message: gone.length === 1 ? `Deleted “${noteHeading(binned[0]!)}” forever` : `Deleted ${gone.length} notes forever` })
      }),
  }
}
