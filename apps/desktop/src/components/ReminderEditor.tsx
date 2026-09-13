import { buildRecurrence, describeRecurrence, type Priority, type Reminder } from '@cairn/core'
import {
  ALERT_CHOICES,
  applyWhen,
  changesFromDraft,
  draftFromReminder,
  emptyDraft,
  fromInputs,
  inputFromDraft,
  type ReminderDraft,
  type RepeatChoice,
} from '@cairn/ui'
import { useState } from 'react'
import { useActions } from '../app/actions'
import { useModal } from '../app/useModal'

interface Props {
  /** Absent for a new reminder. */
  reminder?: Reminder
  now: number
  onClose: () => void
}

export function ReminderEditor({ reminder, now, onClose }: Props) {
  const actions = useActions()
  const modal = useModal(onClose)
  const close = modal.close
  const [draft, setDraft] = useState<ReminderDraft>(() => (reminder ? draftFromReminder(reminder) : emptyDraft(now)))
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ReminderDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const applyWhenText = () => {
    if (!when.trim()) return
    const next = applyWhen(draft, when, Date.now())
    if (next) {
      setDraft(next)
      setWhen('')
      setError(null)
    } else {
      setError(`Couldn't find a date in “${when}”`)
    }
  }

  const save = async () => {
    if (reminder) {
      const result = changesFromDraft(reminder, draft)
      if (!result.ok) return setError(result.error)
      await actions.saveReminder(reminder, result.value)
    } else {
      const result = inputFromDraft(draft)
      if (!result.ok) return setError(result.error)
      await actions.addReminder(result.value)
    }
    close()
  }

  const dueAt = fromInputs(draft.date, draft.time, 9)
  const customLabel = draft.customRule && dueAt !== null ? describeRecurrence(buildRecurrence(draft.customRule, dueAt)) : 'Custom'

  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-labelledby="reminder-editor-title">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <h2 id="reminder-editor-title">{reminder ? 'Edit reminder' : 'New reminder'}</h2>

        <label>
          Title
          <input value={draft.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
        </label>

        <label>
          When
          <input
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyWhenText()
              }
            }}
            onBlur={applyWhenText}
            placeholder="Type it: fri 6pm, tomorrow, every weekday 9am"
          />
        </label>

        <div className="field-row">
          <label>
            Date
            <input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} required />
          </label>
          <label>
            Time
            <input type="time" value={draft.time} onChange={(e) => set({ time: e.target.value })} />
          </label>
          <label className="inline">
            <input type="checkbox" checked={draft.time === ''} onChange={(e) => set({ time: e.target.checked ? '' : '09:00' })} />
            All day
          </label>
        </div>

        <div className="field-row">
          <label>
            Repeat
            <select value={draft.repeat} onChange={(e) => set({ repeat: e.target.value as RepeatChoice })}>
              <option value="none">Doesn't repeat</option>
              <option value="daily">Every day</option>
              <option value="weekdays">Every weekday</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
              {draft.customRule && <option value="custom">{customLabel}</option>}
            </select>
          </label>
          <label>
            Priority
            <select value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>

        <fieldset>
          <legend>Alerts</legend>
          {ALERT_CHOICES.map((choice) => (
            <label key={choice.minutes} className="inline">
              <input
                type="checkbox"
                checked={draft.alerts.includes(choice.minutes)}
                onChange={(e) =>
                  set({
                    alerts: e.target.checked ? [...draft.alerts, choice.minutes] : draft.alerts.filter((m) => m !== choice.minutes),
                  })
                }
              />
              {choice.label}
            </label>
          ))}
          {draft.alerts.length === 0 && <p className="hint">No alerts. It still shows in your lists and widgets.</p>}
        </fieldset>

        <label>
          Tags
          <input value={draft.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="dbms uni" />
        </label>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}

        <div className="editor-actions">
          {reminder && (
            <>
              <button
                type="button"
                onClick={async () => {
                  await actions.complete(reminder)
                  close()
                }}
              >
                Complete
              </button>
              <button
                type="button"
                onClick={async () => {
                  await actions.removeReminder(reminder)
                  close()
                }}
              >
                Delete
              </button>
            </>
          )}
          <span className="spacer" />
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Save
          </button>
        </div>
      </form>
    </dialog>
  )
}
