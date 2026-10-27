import { buildTodaySummary, urgencyOf, type Note, type Reminder } from '@cairn/core'
import type { NoteQuery, ReminderQuery } from '@cairn/sync'
import { ALL_FOLDER, describeWorkload, foldersOf, recoverNoteDraft } from '@cairn/ui'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useActions } from './app/actions'
import { useCairn } from './app/context'
import { usePinnedFolders } from './app/folders'
import { useNow, useObserved } from './app/hooks'
import { useInbox } from './app/inbox'
import { useAlertScheduler } from './app/useAlertScheduler'
import { useWide } from './app/useWide'
import { ClassroomView } from './components/ClassroomView'
import { DoneIcon, SettingsIcon } from './components/icons'
import { InboxView } from './components/InboxView'
import { NoteEditor } from './components/NoteEditor'
import { NotesView } from './components/NotesView'
import { NotificationBanner } from './components/NotificationBanner'
import { QuickCapture } from './components/QuickCapture'
import { RecycleBinView } from './components/RecycleBinView'
import { SettingsView } from './components/SettingsView'
import { Sidebar, type Section } from './components/Sidebar'
import { TaskPanel } from './components/TaskPanel'
import { DoneView, TasksView } from './components/TasksView'
import { TitleBar } from './components/TitleBar'
import { TodayView } from './components/TodayView'
import { useDeskData, useDeskFeed } from './desk/useDesk'

type Editing = { kind: 'task'; reminder?: Reminder; text?: string } | { kind: 'note'; note?: Note }

const ACTIVE: ReminderQuery = { status: ['pending', 'snoozed'] }
const NOTES: NoteQuery = {}

/**
 * One window, two shapes. Small, it is a widget on the desktop that opens on
 * Today: what is due, what came in from Classroom, the mail that matters,
 * and a box to write in. Expanded, it is the full app: folders down the
 * side, notes as a grid, and a task opening beside the list.
 */
export function App() {
  const { reminders, notes, platform, auth } = useCairn()
  const active = useObserved(reminders, ACTIVE)
  const allNotes = useObserved(notes, NOTES)
  const now = useNow(active)
  const wide = useWide()
  const { pinned, toggle } = usePinnedFolders()
  const folders = useMemo(() => foldersOf(allNotes, pinned), [allNotes, pinned])
  const [section, setSection] = useState<Section>('today')
  const [folder, setFolder] = useState(ALL_FOLDER)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const inbox = useInbox()
  const captureRef = useRef<HTMLInputElement>(null)
  const actions = useActions()

  // A note being written when Cairn was closed is saved now, once, into
  // whichever store this session settles on.
  const recovered = useRef(false)
  useEffect(() => {
    if (recovered.current || auth.status === 'loading' || auth.status === 'connecting') return
    recovered.current = true
    void recoverNoteDraft(platform.storage, notes, actions)
  }, [auth.status, platform, notes, actions])

  // A folder emptied or renamed elsewhere goes away; show everything instead.
  useEffect(() => {
    if (folder !== ALL_FOLDER && !folders.some((f) => f.id === folder)) setFolder(ALL_FOLDER)
  }, [folders, folder])

  useEffect(() => {
    let unregister: (() => void) | undefined
    let cancelled = false
    void platform
      .registerQuickCapture(async () => {
        // The window may be hidden in the tray, so raise it before focusing:
        // an input in a hidden window cannot take the caret.
        await platform.showWindow()
        setEditing(null)
        setSection((current) => (current === 'notes' || current === 'tasks' ? current : 'today'))
        // After the capture box has rendered in the section just opened.
        setTimeout(() => {
          captureRef.current?.focus()
          captureRef.current?.select()
        }, 0)
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

  useAlertScheduler(active, inbox, (id) => {
    const reminder = active.find((r) => r.id === id)
    setSection('tasks')
    if (reminder) setEditing({ kind: 'task', reminder })
  })

  // Today pinned to the desktop: told what to show, and asked to tick a task off or open up.
  useDeskFeed(useDeskData(active, now), (action) => {
    const reminder = action.id ? active.find((r) => r.id === action.id) : undefined
    if (action.kind === 'complete') {
      if (reminder) void actions.complete(reminder)
      return
    }
    void platform.showWindow().then(() => platform.setWindowMode('full'))
    if (reminder) {
      setSection('tasks')
      setEditing({ kind: 'task', reminder })
    }
  })

  const overdue = active.filter((r) => urgencyOf(r, now) === 'overdue').length
  const unseen = { inbox: section === 'inbox' ? 0 : inbox.unseen, classroom: section === 'classroom' ? 0 : inbox.unseenClassroom }
  const go = (next: Section) => {
    setEditing(null)
    setSection(next)
  }
  const capture = <QuickCapture inputRef={captureRef} />

  const view =
    section === 'notes' ? (
      <NotesView
        notes={allNotes}
        folders={folders}
        folder={folder}
        wide={wide}
        capture={capture}
        onFolder={setFolder}
        onOpen={(note) => setEditing({ kind: 'note', note })}
        onNew={() => setEditing({ kind: 'note' })}
      />
    ) : section === 'done' ? (
      <DoneView now={now} />
    ) : section === 'settings' ? (
      <SettingsView
        onBin={() => go('bin')}
        onClassroomFiles={() => {
          setFilesOpen(true)
          go('classroom')
        }}
      />
    ) : section === 'bin' ? (
      <RecycleBinView onBack={() => go('settings')} />
    ) : section === 'inbox' ? (
      <InboxView onSettings={() => go('settings')} />
    ) : section === 'classroom' ? (
      <ClassroomView onSettings={() => go('settings')} files={filesOpen} onFiles={setFilesOpen} />
    ) : section === 'today' ? (
      <TodayView active={active} now={now} capture={capture} onEdit={(reminder) => setEditing({ kind: 'task', reminder })} onSection={go} />
    ) : (
      <TasksView
        active={active}
        now={now}
        capture={capture}
        onEdit={(reminder) => setEditing({ kind: 'task', reminder })}
        onNew={() => setEditing({ kind: 'task' })}
      />
    )

  return (
    <div className={`shell ${wide ? 'wide' : 'widget'}`}>
      <TitleBar wide={wide} />
      <div className="body">
        {wide && (
          <Sidebar
            section={section}
            folder={folder}
            folders={folders}
            pinned={pinned}
            taskCount={active.length}
            overdue={overdue}
            unseen={unseen}
            onSection={go}
            onFolder={(f) => {
              go('notes')
              setFolder(f)
            }}
            onTogglePin={auth.status === 'synced' ? (tag) => void toggle(tag) : undefined}
          />
        )}
        <main className="main">
          {editing?.kind === 'note' ? (
            <NoteEditor key={editing.note?.id ?? 'new'} note={editing.note} onClose={() => setEditing(null)} />
          ) : (
            <>
              {!wide && <WidgetNav section={section} overdue={overdue} unseen={unseen} onSection={go} />}
              <NotificationBanner />
              <div className="scroll">{view}</div>
            </>
          )}
        </main>
        {editing?.kind === 'task' && (
          <TaskPanel
            key={editing.reminder?.id ?? 'new'}
            reminder={editing.reminder}
            text={editing.text}
            now={now}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  )
}

/**
 * The widget's switcher, in place of the full app's sidebar. Today holds
 * what is due; the full list of tasks opens from there.
 */
function WidgetNav({
  section,
  overdue,
  unseen,
  onSection,
}: {
  section: Section
  overdue: number
  unseen: { inbox: number; classroom: number }
  onSection: (s: Section) => void
}) {
  return (
    <nav className="widget-nav" aria-label="Cairn">
      <div className="seg" role="tablist">
        <button type="button" role="tab" aria-selected={section === 'today' || section === 'tasks'} onClick={() => onSection('today')}>
          Today
          {overdue > 0 && <span className="seg-count danger">{overdue} late</span>}
        </button>
        <button type="button" role="tab" aria-selected={section === 'notes'} onClick={() => onSection('notes')}>
          Notes
        </button>
        <button type="button" role="tab" aria-selected={section === 'inbox'} onClick={() => onSection('inbox')}>
          Inbox
          {unseen.inbox > 0 && <span className="seg-dot" aria-label={`${unseen.inbox} new`} />}
        </button>
        <button type="button" role="tab" aria-selected={section === 'classroom'} onClick={() => onSection('classroom')}>
          Classroom
          {unseen.classroom > 0 && <span className="seg-dot" aria-label={`${unseen.classroom} new`} />}
        </button>
      </div>
      <span className="spacer" />
      <button type="button" className={`icon ${section === 'done' ? 'on' : ''}`} aria-label="Completed" title="Completed" onClick={() => onSection('done')}>
        <DoneIcon />
      </button>
      <button type="button" className={`icon ${section === 'settings' || section === 'bin' ? 'on' : ''}`} aria-label="Settings" title="Settings" onClick={() => onSection('settings')}>
        <SettingsIcon />
      </button>
    </nav>
  )
}
