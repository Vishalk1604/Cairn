import { urgencyOf, type Note, type Reminder } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { useEffect, useRef, useState } from 'react'
import { useCairn } from './app/context'
import { useNow, useObserved } from './app/hooks'
import { useAlertScheduler } from './app/useAlertScheduler'
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
      .registerQuickCapture(() => {
        void platform.showWindow()
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

  return (
    <div className="app">
      <header className="top">
        <QuickCapture inputRef={captureRef} />
      </header>
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
          <button type="button" onClick={() => setEditing({ kind: 'note' })}>
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
      {editing?.kind === 'note' && <NoteEditor key={editing.note?.id ?? 'new'} note={editing.note} onClose={() => setEditing(null)} />}
    </div>
  )
}
