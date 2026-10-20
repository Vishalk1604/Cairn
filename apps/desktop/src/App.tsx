import { buildTodaySummary, urgencyOf, type Note, type Reminder } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { describeWorkload } from '@cairn/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCairn } from './app/context'
import { useNow, useObserved } from './app/hooks'
import { useAlertScheduler } from './app/useAlertScheduler'
import { AccountBar } from './components/AccountBar'
import { DoneList } from './components/DoneList'
import { NoteEditor } from './components/NoteEditor'
import { NoteList } from './components/NoteList'
import { NotificationBanner } from './components/NotificationBanner'
import { QuickCapture } from './components/QuickCapture'
import { ReminderEditor } from './components/ReminderEditor'
import { ReminderList } from './components/ReminderList'

type Tab = 'reminders' | 'notes' | 'done'
type Editing = { kind: 'reminder'; reminder?: Reminder } | { kind: 'note'; note?: Note }

const ACTIVE: ReminderQuery = { status: ['pending', 'snoozed'] }

export function App() {
  const { reminders, platform } = useCairn()
  const active = useObserved(reminders, ACTIVE)
  const now = useNow(active)
  const [tab, setTab] = useState<Tab>('reminders')
  const [editing, setEditing] = useState<Editing | null>(null)
  const captureRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let unregister: (() => void) | undefined
    let cancelled = false
    void platform
      .registerQuickCapture(async () => {
        // The window may be hidden in the tray, so raise it before focusing:
        // an input in a hidden window cannot take the caret.
        await platform.showWindow()
        setEditing(null)
        captureRef.current?.focus()
        captureRef.current?.select()
      })
      .then((stop) => (cancelled ? stop() : (unregister = stop)))
    return () => {
      cancelled = true
      unregister?.()
    }
  }, [platform])

  // The tray shows the most urgent thing pending, so a glance at the taskbar
  // is enough even with the window closed. Reduced to a level and a string
  // first, so the clock ticking does not cost a call into the host.
  const tray = useMemo(() => {
    const summary = buildTodaySummary(active, now)
    return { worst: summary.worst, tooltip: `Cairn — ${describeWorkload(summary)}` }
  }, [active, now])

  useEffect(() => {
    platform.setTrayState(tray.worst, tray.tooltip).catch((error: unknown) => {
      console.error('Could not update the tray', error)
    })
  }, [platform, tray.worst, tray.tooltip])

  useAlertScheduler(active, (id) => {
    const reminder = active.find((r) => r.id === id)
    setTab('reminders')
    if (reminder) setEditing({ kind: 'reminder', reminder })
  })

  const overdue = active.filter((r) => urgencyOf(r, now) === 'overdue').length
  const tabs: { id: Tab; label: string }[] = [
    { id: 'reminders', label: overdue > 0 ? `Reminders (${active.length}, ${overdue} overdue)` : `Reminders (${active.length})` },
    { id: 'notes', label: 'Notes' },
    { id: 'done', label: 'Done' },
  ]

  if (editing?.kind === 'note') {
    return <NoteEditor key={editing.note?.id ?? 'new'} note={editing.note} onClose={() => setEditing(null)} />
  }

  return (
    <div className="app">
      <header className="top">
        <QuickCapture inputRef={captureRef} />
      </header>
      <AccountBar />
      <NotificationBanner />
      <nav className="tabs" role="tablist" aria-label="Views">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        {tab === 'reminders' && (
          <button type="button" onClick={() => setEditing({ kind: 'reminder' })}>
            New reminder
          </button>
        )}
        {tab === 'notes' && (
          <button
            type="button"
            onClick={() => {
              // Writing happens in the composer above, not on a screen of its own.
              captureRef.current?.focus()
              captureRef.current?.select()
            }}
          >
            New note
          </button>
        )}
      </nav>
      <main role="tabpanel">
        {tab === 'reminders' && (
          <ReminderList
            reminders={active}
            now={now}
            onEdit={(id) => {
              const reminder = active.find((r) => r.id === id)
              if (reminder) setEditing({ kind: 'reminder', reminder })
            }}
          />
        )}
        {tab === 'notes' && <NoteList onOpen={(note) => setEditing({ kind: 'note', note })} />}
        {tab === 'done' && <DoneList now={now} />}
      </main>
      {editing?.kind === 'reminder' && (
        <ReminderEditor key={editing.reminder?.id ?? 'new'} reminder={editing.reminder} now={now} onClose={() => setEditing(null)} />
      )}
    </div>
  )
}
