import { addLocalDays, buildRecurrence, describeRecurrence, type Priority, type Reminder } from '@cairn/core'
import {
  ALERT_CHOICES,
  applyWhen,
  changesFromDraft,
  draftFromReminder,
  draftFromText,
  emptyDraft,
  formatDue,
  fromInputs,
  inputFromDraft,
  parseTimeInput,
  toDateInput,
  type ReminderDraft,
  type RepeatChoice,
} from '@cairn/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useActions } from '../app/actions'
import { BackIcon, CheckIcon, TrashIcon } from './icons'

const REPEATS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
]
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]
const TIMES = ['09:00', '12:00', '18:00', '21:00']
const ALERT_SHORT: Record<number, string> = { 0: 'On time', 10: '10 min before', 60: '1 hour before', [24 * 60]: '1 day before' }

interface Props {
  /** Absent for a new task. */
  reminder?: Reminder
  /** What quick add had typed, for a new task opened from there. */
  text?: string
  now: number
  onClose: () => void
}

/**
 * A task, laid out as on the phone: the title large, when it is due — typed
 * in words or picked from likely choices — then everything else, and the
 * details underneath. A panel beside the list in the full app; the whole
 * widget when it is small.
 *
 * Leaving saves, the way leaving a note does. A new task with nothing typed
 * leaves nothing behind; one that cannot be saved says why and stays open.
 */
export function TaskPanel({ reminder, text, now, onClose }: Props) {
  const actions = useActions()
  const [draft, setDraft] = useState<ReminderDraft>(() =>
    reminder ? draftFromReminder(reminder) : text?.trim() ? draftFromText(text, now) : emptyDraft(now),
  )
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const leaving = useRef(false)
  const set = (patch: Partial<ReminderDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }

  const applyWhenText = () => {
    if (!when.trim()) return
    const next = applyWhen(draft, when, Date.now())
    if (next) {
      setDraft({ ...next, title: draft.title, body: draft.body })
      setWhen('')
      setError(null)
    } else {
      setError(`Couldn't find a date in “${when}”`)
    }
  }

  const close = async () => {
    if (leaving.current) return
    // Words typed but not yet applied count as the schedule.
    const current = when.trim() ? (applyWhen(draft, when, Date.now()) ?? draft) : draft
    if (!reminder && !current.title.trim() && !current.body.trim()) return onClose()
    const save = reminder
      ? (() => {
          const result = changesFromDraft(reminder, current)
          return result.ok ? () => actions.saveReminder(reminder, result.value) : result.error
        })()
      : (() => {
          const result = inputFromDraft(current)
          return result.ok ? () => actions.addReminder(result.value) : result.error
        })()
    if (typeof save === 'string') return setError(save)
    leaving.current = true
    try {
      await save()
    } finally {
      onClose()
    }
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void closeRef.current()
      } else if ((event.ctrlKey || event.metaKey) && (event.key === 'Enter' || event.key.toLowerCase() === 's')) {
        event.preventDefault()
        void closeRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const dueAt = fromInputs(draft.date, draft.time, 9)
  const customLabel = draft.customRule && dueAt !== null ? describeRecurrence(buildRecurrence(draft.customRule, dueAt)) : 'Custom'
  const repeatLabel = draft.repeat === 'custom' ? customLabel : (REPEATS.find((r) => r.value === draft.repeat)?.label ?? 'Never')
  const schedule = dueAt === null ? 'Pick a day' : formatDue(dueAt, draft.time.trim() === '', Date.now())
  const days: [string, number][] = [
    ['Today', 0],
    ['Tomorrow', 1],
    ['Next week', 7],
  ]
  const badTime = draft.time.trim() !== '' && !parseTimeInput(draft.time)

  return (
    <>
      <div className="panel-scrim" onMouseDown={() => void close()} aria-hidden="true" />
      <aside className="task-panel" aria-label={reminder ? 'Edit task' : 'New task'}>
        <header className="panel-bar">
          <button type="button" className="icon" onClick={() => void close()} aria-label="Back" title="Back (Esc)">
            <BackIcon />
          </button>
          <span className="spacer" />
          {reminder && (
            <button
              type="button"
              className="icon"
              aria-label="Delete task"
              title="Delete"
              onClick={async () => {
                leaving.current = true
                await actions.removeReminder(reminder)
                onClose()
              }}
            >
              <TrashIcon />
            </button>
          )}
          <button type="button" className="icon" onClick={() => void close()} aria-label="Save" title="Save (Ctrl+Enter)">
            <CheckIcon />
          </button>
        </header>

        <div className="panel-page">
          <textarea
            className="panel-title"
            value={draft.title}
            onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })}
            placeholder="Task"
            aria-label="Title"
            rows={1}
            autoFocus={!reminder}
          />
          <p className={`panel-schedule ${dueAt === null ? 'bad' : ''}`} aria-live="polite">
            {schedule}
            {draft.repeat !== 'none' && <span className="panel-repeat"> · {repeatLabel}</span>}
          </p>

          <input
            className="field"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyWhenText()
              }
            }}
            onBlur={applyWhenText}
            placeholder="Type when: fri 6pm, in 3 days, every weekday 9am"
            aria-label="When, in words"
          />

          <Group title="Day">
            {days.map(([label, n]) => {
              const date = toDateInput(addLocalDays(Date.now(), n))
              return <Choice key={label} label={label} on={draft.date === date} onClick={() => set({ date })} />
            })}
            <input type="date" className="field small" value={draft.date} onChange={(e) => set({ date: e.target.value })} aria-label="Date" />
          </Group>

          <Group title="Time">
            <Choice label="All day" on={draft.time.trim() === ''} onClick={() => set({ time: '' })} />
            {TIMES.map((t) => (
              <Choice key={t} label={t} on={draft.time === t} onClick={() => set({ time: t })} />
            ))}
            <input
              type="time"
              className={`field small ${badTime ? 'bad' : ''}`}
              value={parseTimeInput(draft.time) ? draft.time.padStart(5, '0') : ''}
              onChange={(e) => set({ time: e.target.value })}
              aria-label="Exact time"
            />
          </Group>

          <Group title="Repeat">
            <select className="field" value={draft.repeat} onChange={(e) => set({ repeat: e.target.value as RepeatChoice })} aria-label="Repeat">
              {REPEATS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
              {draft.customRule && <option value="custom">{customLabel}</option>}
            </select>
          </Group>

          <Group title="Priority">
            {PRIORITIES.map((p) => (
              <Choice key={p.value} label={p.label} on={draft.priority === p.value} danger={p.value === 'high'} onClick={() => set({ priority: p.value })} />
            ))}
          </Group>

          <Group title="Alerts">
            {ALERT_CHOICES.map((a) => {
              const on = draft.alerts.includes(a.minutes)
              return (
                <Choice
                  key={a.minutes}
                  label={ALERT_SHORT[a.minutes] ?? a.label}
                  on={on}
                  onClick={() => set({ alerts: on ? draft.alerts.filter((m) => m !== a.minutes) : [...draft.alerts, a.minutes] })}
                />
              )
            })}
          </Group>
          {draft.alerts.length === 0 && <p className="hint">No alerts. It still shows in Tasks.</p>}

          <Group title="Folder">
            <input className="field" value={draft.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="None yet. Type one, like study" aria-label="Folder" />
          </Group>

          <Group title="Details">
            <textarea className="field details" value={draft.body} onChange={(e) => set({ body: e.target.value })} placeholder="Notes, links, what it's for" aria-label="Details" rows={4} />
          </Group>

          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}

          {reminder && (
            <button
              type="button"
              className="wide-button"
              onClick={async () => {
                leaving.current = true
                await actions.complete(reminder)
                onClose()
              }}
            >
              Mark done
            </button>
          )}
        </div>
      </aside>
    </>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="group">
      <span className="group-title">{title}</span>
      <div className="group-choices">{children}</div>
    </div>
  )
}

function Choice({ label, on, danger, onClick }: { label: string; on: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`choice ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} aria-pressed={on} onClick={onClick}>
      {label}
    </button>
  )
}
