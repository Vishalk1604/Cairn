import type { Reminder } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatDue } from '@cairn/ui'
import { useMemo } from 'react'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'

const DONE: ReminderQuery = { status: ['done'] }
const SHOWN = 100

export function DoneList({ now }: { now: number }) {
  const { reminders } = useCairn()
  const actions = useActions()
  const done = useObserved(reminders, DONE)
  const sorted = useMemo(
    () => [...done].sort((a: Reminder, b: Reminder) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)).slice(0, SHOWN),
    [done],
  )

  if (sorted.length === 0) return <p className="empty">Completed reminders show up here.</p>

  return (
    <ul className="rows">
      {sorted.map((r) => (
        <li key={r.id} className="row" data-urgency="done">
          <button type="button" className="check" aria-label={`Reopen ${r.title}`} onClick={() => void actions.reopen(r)}>
            ✓
          </button>
          <div className="row-main">
            <span className="row-title done">{r.title}</span>
            <div className="row-meta">Completed {formatDue(r.completedAt ?? r.updatedAt, false, now)}</div>
          </div>
          <div className="row-actions">
            <button type="button" onClick={() => void actions.reopen(r)}>
              Reopen
            </button>
            <button type="button" aria-label={`Delete ${r.title}`} onClick={() => void actions.removeReminder(r)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}
