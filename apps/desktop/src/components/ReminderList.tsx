import { compareByUrgency, URGENCY_LEVELS, urgencyOf, type Reminder, type UrgencyLevel } from '@cairn/core'
import { formatReminderWhen, snoozeChoices, URGENCY } from '@cairn/ui'
import { useMemo, type CSSProperties } from 'react'
import { useActions } from '../app/actions'

interface Props {
  reminders: readonly Reminder[]
  now: number
  onEdit: (id: string) => void
}

export function ReminderList({ reminders, now, onEdit }: Props) {
  const groups = useMemo(() => {
    const sorted = [...reminders].sort(compareByUrgency(now))
    const byLevel = new Map<UrgencyLevel, Reminder[]>()
    for (const r of sorted) {
      const level = urgencyOf(r, now)
      byLevel.set(level, [...(byLevel.get(level) ?? []), r])
    }
    return URGENCY_LEVELS.flatMap((level) => {
      const items = byLevel.get(level)
      return items ? [{ level, items }] : []
    })
  }, [reminders, now])

  if (groups.length === 0) return <p className="empty">Nothing coming up. Add something above.</p>

  return (
    <>
      {groups.map(({ level, items }) => (
        <section key={level} className="group" aria-label={URGENCY[level].label}>
          <h2>
            <span aria-hidden="true">{URGENCY[level].symbol}</span> {URGENCY[level].label} <span className="count">{items.length}</span>
          </h2>
          <ul className="rows">
            {items.map((r) => (
              <ReminderRow key={r.id} reminder={r} level={level} now={now} onEdit={onEdit} />
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}

function ReminderRow({ reminder: r, level, now, onEdit }: { reminder: Reminder; level: UrgencyLevel; now: number; onEdit: (id: string) => void }) {
  const actions = useActions()
  const token = URGENCY[level]
  const snoozed = r.status === 'snoozed' && (r.snoozedUntil ?? 0) > now

  return (
    <li className="row" data-urgency={level} style={{ '--urgency': token.color } as CSSProperties}>
      <button type="button" className="check" aria-label={`Complete ${r.title}`} onClick={() => void actions.complete(r)}>
        ○
      </button>
      <div className="row-main">
        <button type="button" className="row-title" onClick={() => onEdit(r.id)}>
          {r.title}
        </button>
        <div className="row-meta">
          <span className="urgency-symbol" title={token.label}>
            {token.symbol}
          </span>
          <span>{formatReminderWhen(r, now)}</span>
          {r.priority !== 'normal' && <span className="badge">{r.priority}</span>}
          {r.tags.map((tag) => (
            <span key={tag} className="tag">
              #{tag}
            </span>
          ))}
        </div>
      </div>
      <div className="row-actions">
        {snoozed ? (
          <button type="button" onClick={() => void actions.unsnooze(r)}>
            Unsnooze
          </button>
        ) : (
          <select
            aria-label={`Snooze ${r.title}`}
            value=""
            onChange={(event) => {
              const until = Number(event.target.value)
              if (until) void actions.snooze(r, until)
            }}
          >
            <option value="">Snooze…</option>
            {snoozeChoices(now).map((choice) => (
              <option key={choice.label} value={choice.until}>
                {choice.label}
              </option>
            ))}
          </select>
        )}
        {r.rrule && (
          <button type="button" onClick={() => void actions.skip(r)}>
            Skip
          </button>
        )}
        <button type="button" aria-label={`Delete ${r.title}`} onClick={() => void actions.removeReminder(r)}>
          Delete
        </button>
      </div>
    </li>
  )
}
