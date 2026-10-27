import { dueOf, inboxTaskId, type InboxRecord } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatAgo, formatDue, readerStatus } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { useClassroomFiles } from '../app/classroomFiles'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { useInbox } from '../app/inbox'
import { useToast } from '../app/toast'
import { ClassroomFilesPanel } from './ClassroomFilesPanel'
import { ClassIcon, SettingsIcon } from './icons'
import { AccountChips, Chip, PausedNotice } from './InboxView'
import { Switch } from './SettingsParts'
import { SyncButton } from './SyncButton'

const LIVE_TASKS: ReminderQuery = {}

/**
 * New coursework and announcements from every connected account, apart from
 * the mail, the same as on the phone. Each can become a task with a tap, or
 * all of them on their own. The gear holds what only the computer does:
 * saving the files teachers attach to a folder, class by class.
 */
export function ClassroomView({ onSettings, files: filesOpen, onFiles }: { onSettings: () => void; files: boolean; onFiles: (open: boolean) => void }) {
  const inbox = useInbox()
  const toast = useToast()
  const files = useClassroomFiles()
  const { reminders } = useCairn()
  const tasks = useObserved(reminders, LIVE_TASKS)
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const [tab, setTab] = useState<'work' | 'announcement'>('work')
  const [account, setAccount] = useState<string | null>(null)
  const now = Date.now()

  const { markSeen } = inbox
  useEffect(() => markSeen('classroom'), [markSeen, inbox.classroom.length])

  const picked = account && inbox.classroomAccounts.accounts.includes(account) ? account : null
  const visible = picked ? inbox.classroom.filter((r) => r.account === picked) : inbox.classroom
  const work = visible.filter((r) => r.classroom?.kind === 'work')
  const announcements = visible.filter((r) => r.classroom?.kind === 'announcement')
  const shown = tab === 'work' ? work : announcements
  const filesOn = files !== null && files.courses.some((c) => c.selected)

  const head = (
    <header className="view-head keep">
      <h1 className="view-title">Classroom</h1>
      <span className="view-sub">{work.filter((r) => !r.classroom?.submitted).length ? `${work.filter((r) => !r.classroom?.submitted).length} to do` : ''}</span>
      <span className="spacer" />
      {inbox.signedIn && <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onClick={() => void inbox.refresh()} label="Check Classroom now" />}
      <button
        type="button"
        className={`icon ${filesOpen ? 'on' : ''}`}
        aria-label="Classroom files on this computer"
        title="Files on this computer"
        aria-expanded={filesOpen}
        onClick={() => onFiles(!filesOpen)}
      >
        <SettingsIcon size={18} />
      </button>
    </header>
  )

  const panel = filesOpen && (
    <div className="files-panel">
      <ClassroomFilesPanel />
    </div>
  )

  if (!inbox.signedIn || (inbox.classroomReaders.length === 0 && inbox.classroom.length === 0)) {
    return (
      <section className="view" aria-label="Classroom">
        {head}
        {panel}
        <div className="empty">
          <span className="empty-icon">
            <ClassIcon size={30} />
          </span>
          <p>
            {!inbox.signedIn
              ? 'Sign in with the Google account you set Cairn up with on your phone. New coursework and announcements from every account show here.'
              : 'Add your college account and choose Classroom in Cairn on your phone, and new coursework shows here.'}
          </p>
          {!inbox.signedIn && (
            <button type="button" className="accent-button" onClick={onSettings}>
              Open Settings
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="view" aria-label="Classroom">
      {head}
      {panel}
      <AccountChips chips={inbox.classroomAccounts} current={picked} onPick={setAccount} />
      <div className="chips" role="tablist" aria-label="Kind">
        <Chip label="Coursework" count={work.filter((r) => !r.classroom?.submitted).length} on={tab === 'work'} onClick={() => setTab('work')} />
        <Chip label="Announcements" count={announcements.length} on={tab === 'announcement'} onClick={() => setTab('announcement')} />
      </div>

      <div className="notice">
        <span className="notice-text">
          <strong>Automatically add tasks</strong>
          <span>Coursework at its due date, ticking itself off when handed in; announcements at any date they give. Shared with your phone.</span>
        </span>
        <Switch
          on={inbox.autoTasks}
          label="Automatically add tasks"
          onChange={(on) => {
            void inbox.setAutoTasks(on)
            toast({ message: on ? 'New coursework and announcements will become tasks on their own' : 'Classroom posts wait for a click again' })
          }}
        />
      </div>
      {!filesOpen && files && (
        <p className="hint files-hint">
          {filesOn ? `Files from ${files.courses.filter((c) => c.selected).length} classes are saved to ${files.folder}.` : 'Files teachers attach can be saved to a folder here, class by class — '}
          {!filesOn && (
            <button type="button" className="quiet" onClick={() => onFiles(true)}>
              choose classes
            </button>
          )}
        </p>
      )}
      <PausedNotice />
      {inbox.error && <p className="notice danger">{inbox.error}</p>}

      {shown.length === 0 ? (
        <p className="view-status">{tab === 'work' ? 'No new coursework. It shows here as soon as a teacher posts it.' : 'No new announcements.'}</p>
      ) : (
        <ul className="mail-list">
          {shown.map((record) => (
            <PostCard
              key={record.id}
              record={record}
              showAccount={inbox.classroomAccounts.all && !picked}
              added={taskIds.has(inboxTaskId(record))}
              now={now}
              onOpen={() => inbox.open(record)}
              onAdd={() => void inbox.addAsTask(record).then(() => toast({ message: 'Added to Tasks' }))}
              onHide={() => {
                void inbox.dismiss(record)
                toast({ message: 'Hidden on every device', action: { label: 'Undo', run: () => void inbox.dismiss(record, false) } })
              }}
            />
          ))}
        </ul>
      )}
      <p className="view-status">{readerStatus(inbox, now)}</p>
    </section>
  )
}

function PostCard({
  record,
  showAccount,
  added,
  now,
  onOpen,
  onAdd,
  onHide,
}: {
  record: InboxRecord
  showAccount: boolean
  added: boolean
  now: number
  onOpen: () => void
  onAdd: () => void
  onHide: () => void
}) {
  const post = record.classroom!
  const due = dueOf(record)
  const summary = record.triage?.summary ?? record.snippet
  return (
    <li className={`mail ${record.read ? 'read' : ''} ${post.submitted ? 'done' : ''}`}>
      <button type="button" className="mail-open" onClick={onOpen} title="Open in Classroom">
        <span className="mail-head">
          {!record.read && <span className="unread-dot" aria-label="New" />}
          <span className="mail-meta">
            {post.course} · {formatAgo(record.receivedAt, now)}
            {showAccount ? ` · ${record.account}` : ''}
          </span>
        </span>
        <h3 className="mail-subject">{record.subject}</h3>
        {summary && summary !== record.subject && <p className="mail-summary">{summary}</p>}
        {due && <span className="mail-due">Due {formatDue(due.dueAt, due.allDay, now)}</span>}
      </button>
      <div className="mail-foot">
        {post.submitted && <span className="in-tasks">Handed in</span>}
        <button type="button" className="quiet" onClick={onHide}>
          Hide
        </button>
        <span className="spacer" />
        {added ? (
          <span className="in-tasks">✓ In Tasks</span>
        ) : (
          !post.submitted && (
            <button type="button" className="accent-button" onClick={onAdd}>
              Add as task
            </button>
          )
        )}
      </div>
    </li>
  )
}
