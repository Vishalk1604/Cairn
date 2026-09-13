import {
  completeReminder,
  createNote,
  createReminder,
  deleteNote,
  deleteReminder,
  parseCapture,
  reopenReminder,
  rescheduleReminder,
  skipOccurrence,
  snoozeReminder,
  updateNote,
  updateReminder,
  type CaptureResult,
  type Entity,
  type Note,
  type NoteChanges,
  type NoteInput,
  type Reminder,
  type ReminderChanges,
  type ReminderInput,
} from '@cairn/core'
import type { Repository } from '@cairn/sync'
import { formatDue } from '@cairn/ui'
import { useMemo } from 'react'
import { useCairn } from './context'
import { useToast } from './toast'

export type Actions = ReturnType<typeof useActions>

/** Every user-initiated change goes through here: errors become toasts, destructive changes get an Undo. */
export function useActions() {
  const { reminders, notes, userId } = useCairn()
  const toast = useToast()

  return useMemo(() => {
    const ctx = () => ({ userId, now: Date.now() })

    const run = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (error) {
        toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
        return undefined
      }
    }

    // Undo writes the earlier version back, stamped now so last-write-wins accepts it.
    const offerUndo = <T extends Entity>(repo: Repository<T, unknown>, before: T, message: string) =>
      toast({ message, action: { label: 'Undo', run: () => void repo.upsert({ ...before, updatedAt: Date.now() }) } })

    const changeReminder = (r: Reminder, next: Reminder, message?: string) =>
      run(async () => {
        await reminders.upsert(next)
        if (message) offerUndo(reminders, r, message)
      })

    return {
      /** Quick capture. With `literal`, the text is saved as a note without interpreting it. */
      capture: (text: string, literal = false) =>
        run(async (): Promise<CaptureResult | null> => {
          const now = Date.now()
          if (literal) {
            await notes.upsert(createNote({ title: text }, ctx()))
            return null
          }
          const parsed = parseCapture(text, now)
          if (parsed.kind === 'reminder') {
            const r = createReminder(
              { title: parsed.title, dueAt: parsed.dueAt!, allDay: parsed.allDay, rrule: parsed.rrule, priority: parsed.priority, tags: parsed.tags },
              ctx(),
            )
            await reminders.upsert(r)
            toast({
              message: `Added “${r.title}” for ${formatDue(r.dueAt, r.allDay, now)}`,
              action: { label: 'Undo', run: () => void reminders.remove(r.id, Date.now()) },
            })
          } else {
            const n = createNote({ title: parsed.title, tags: parsed.tags }, ctx())
            await notes.upsert(n)
            toast({ message: `Saved note “${n.title}”`, action: { label: 'Undo', run: () => void notes.remove(n.id, Date.now()) } })
          }
          return parsed
        }),

      addReminder: (input: ReminderInput) => run(() => reminders.upsert(createReminder(input, ctx()))),
      saveReminder: (r: Reminder, changes: ReminderChanges) => run(() => reminders.upsert(updateReminder(r, changes, Date.now()))),
      complete: (r: Reminder) => {
        const next = completeReminder(r, Date.now())
        const message = next.status === 'done' ? `Completed “${r.title}”` : `Done for now — next “${r.title}” ${formatDue(next.dueAt, next.allDay, Date.now())}`
        return changeReminder(r, next, message)
      },
      reopen: (r: Reminder) => changeReminder(r, reopenReminder(r, Date.now())),
      skip: (r: Reminder) => {
        const next = skipOccurrence(r, Date.now())
        return changeReminder(r, next, `Skipped — next ${formatDue(next.dueAt, next.allDay, Date.now())}`)
      },
      snooze: (r: Reminder, until: number) =>
        run(async () => {
          const next = snoozeReminder(r, until, Date.now())
          await reminders.upsert(next)
          offerUndo(reminders, r, `Snoozed until ${formatDue(until, false, Date.now())}`)
        }),
      unsnooze: (r: Reminder) => changeReminder(r, rescheduleReminder(r, r.dueAt, Date.now())),
      removeReminder: (r: Reminder) => changeReminder(r, deleteReminder(r, Date.now()), `Deleted “${r.title}”`),

      addNote: (input: NoteInput) =>
        run(async () => {
          const n = createNote(input, ctx())
          await notes.upsert(n)
          return n
        }),
      saveNote: (n: Note, changes: NoteChanges) =>
        run(async () => {
          const next = updateNote(n, changes, Date.now())
          await notes.upsert(next)
          return next
        }),
      togglePin: (n: Note) => run(() => notes.upsert(updateNote(n, { pinned: !n.pinned }, Date.now()))),
      removeNote: (n: Note) =>
        run(async () => {
          await notes.upsert(deleteNote(n, Date.now()))
          offerUndo(notes, n, `Deleted note “${n.title || 'Untitled'}”`)
        }),
    }
  }, [reminders, notes, userId, toast])
}
