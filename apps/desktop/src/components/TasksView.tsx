import { compareByUrgency, URGENCY_LEVELS, urgencyOf, type Reminder, type UrgencyLevel } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatDue, formatReminderWhen, snoozeChoices, URGENCY } from '@cairn/ui'
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { CheckIcon, DoneIcon, PlusIcon, SnoozeIcon, TasksIcon, TrashIcon } from './icons'

interface Props {
  active: readonly Reminder[]
  now: number
  capture: ReactNode
  onEdit: (reminder: Reminder) => void
  onNew: () => void
}

/** What is due, most urgent first, in the same groups as the phone. */
export function TasksView({ active, now, capture, onEdit, onNew }: Props) {
  const groups = useMemo(() => {
    const byLevel = new Map<UrgencyLevel, Reminder[]>()
    for (const r of [...active].sort(compareByUrgency(now))) {
      const level = urgencyOf(r, now)
      byLevel.set(level, [...(byLevel.get(level) ?? []), r])
    }
    return URGENCY_LEVELS.flatMap((level) => {
      const items = byLevel.get(level)
      return items ? [{ level, items }] : []
    })
  }, [active, now])

  const overdue = groups.find((g) => g.level === 'overdue')?.items.length ?? 0
  const today = groups.find((g) => g.level === 'today' || g.level === 'soon')?.items.length ?? 0
  const summary = [overdue ? `${overdue} overdue` : null, today ? `${today} due today` : null].filter(Boolean).join(' · ')

  return (
    <section className="view" aria-label="Tasks">
      <header className="view-head">
        <h1 className="view-title">Tasks</h1>
        <span className="view-sub">{summary || (active.length ? `${active.length} coming up` : '')}</span>
        <span className="spacer" />
        <button type="button" className="accent-button" onClick={onNew}>
          <PlusIcon size={16} />
          <span>New task</span>
        </button>
      </header>

      {capture}

      {groups.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <TasksIcon size={30} />
          </span>
          <p>Nothing coming up. Type something with a date above — “submit lab report fri 5pm”.</p>
        </div>
      ) : (
        groups.map(({ level, items }) => (
          <section key={level} className="task-group" aria-label={URGENCY[level].label} style={{ '--urgency': URGENCY[level].color } as CSSProperties}>
            <h2 className="group-head">
              <span className="group-dot" aria-hidden="true" />
              {URGENCY[level].label}
              <span className="group-count">{items.length}</span>
            </h2>
            <ul className="task-list">
              {items.map((r) => (
                <TaskRow key={r.id} reminder={r} level={level} now={now} onEdit={onEdit} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  )
}

const TaskRow = memo(function TaskRow({ reminder: r, level, now, onEdit }: { reminder: Reminder; level: UrgencyLevel; now: number; onEdit: (r: Reminder) => void }) {
  const actions = useActions()
  const snoozed = r.status === 'snoozed' && (r.snoozedUntil ?? 0) > now
  return (
    <li className="task" data-urgency={level} style={{ '--urgency': URGENCY[level].color } as CSSProperties}>
      <button type="button" className="task-check" aria-label={`Complete ${r.title}`} title="Mark done" onClick={() => void actions.complete(r)}>
        <CheckIcon size={14} />
      </button>
      <button type="button" className="task-open" onClick={() => onEdit(r)}>
        <span className="task-title">{r.title}</span>
        <span className="task-when">
          {formatReminderWhen(r, now)}
          {snoozed && ' · snoozed'}
          {r.priority === 'high' && <span className="task-flag">High</span>}
        </span>
        {r.body && <span className="task-body">{r.body}</span>}
        {r.tags.length > 0 && (
          <span className="task-tags">
            {r.tags.map((tag) => (
              <span key={tag} className="tag">
                {tag.toUpperCase()}
              </span>
            ))}
          </span>
        )}
      </button>
      <div className="card-tools">
        {snoozed ? (
          <button type="button" className="tool text" onClick={() => void actions.unsnooze(r)}>
            Unsnooze
          </button>
        ) : (
          <SnoozeMenu reminder={r} now={now} />
        )}
        {r.rrule && (
          <button type="button" className="tool text" onClick={() => void actions.skip(r)} title="Skip this one">
            Skip
          </button>
        )}
        <button type="button" className="tool" aria-label={`Delete ${r.title}`} title="Delete" onClick={() => void actions.removeReminder(r)}>
          <TrashIcon size={15} />
        </button>
      </div>
    </li>
  )
})

function SnoozeMenu({ reminder, now }: { reminder: Reminder; now: number }) {
  const actions = useActions()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="tool" aria-label={`Snooze ${reminder.title}`} title="Snooze" aria-expanded={open} onClick={() => setOpen(!open)}>
        <SnoozeIcon size={15} />
      </button>
      {open && (
        <div className="menu" role="menu">
          {snoozeChoices(now).map((choice) => (
            <button
              key={choice.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void actions.snooze(reminder, choice.until)
              }}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const DONE: ReminderQuery = { status: ['done'] }
const SHOWN = 100

/** The last hundred things finished, newest first, any of which can be reopened. */
export function DoneView({ now }: { now: number }) {
  const { reminders } = useCairn()
  const actions = useActions()
  const done = useObserved(reminders, DONE)
  const sorted = useMemo(
    () => [...done].sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)).slice(0, SHOWN),
    [done],
  )

  return (
    <section className="view" aria-label="Completed">
      <header className="view-head">
        <h1 className="view-title">Completed</h1>
        <span className="view-sub">{sorted.length ? `${sorted.length} recent` : ''}</span>
      </header>
      {sorted.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <DoneIcon size={30} />
          </span>
          <p>Finished tasks show up here.</p>
        </div>
      ) : (
        <ul className="task-list">
          {sorted.map((r) => (
            <li key={r.id} className="task done" style={{ '--urgency': URGENCY.done.color } as CSSProperties}>
              <button type="button" className="task-check on" aria-label={`Reopen ${r.title}`} title="Reopen" onClick={() => void actions.reopen(r)}>
                <CheckIcon size={14} />
              </button>
              <div className="task-open static">
                <span className="task-title">{r.title}</span>
                <span className="task-when">Completed {formatDue(r.completedAt ?? r.updatedAt, false, now)}</span>
              </div>
              <div className="card-tools">
                <button type="button" className="tool text" onClick={() => void actions.reopen(r)}>
                  Reopen
                </button>
                <button type="button" className="tool" aria-label={`Delete ${r.title}`} title="Delete" onClick={() => void actions.removeReminder(r)}>
                  <TrashIcon size={15} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
