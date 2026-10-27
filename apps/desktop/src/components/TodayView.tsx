import { compareByUrgency, dueOf, isImportant, urgencyOf, type InboxRecord, type Reminder } from '@cairn/core'
import { formatAgo, formatDue, readerStatus } from '@cairn/ui'
import type { ReactNode } from 'react'
import { useInbox } from '../app/inbox'
import { PausedNotice, sender } from './InboxView'
import { TaskRow } from './TasksView'

/** Posts and mail older than this are not news for today. */
const FRESH_MS = 3 * 24 * 60 * 60 * 1000
const SHOWN = 3

interface Props {
  active: readonly Reminder[]
  now: number
  capture: ReactNode
  onEdit: (reminder: Reminder) => void
  onSection: (section: 'tasks' | 'inbox' | 'classroom') => void
}

/**
 * What the widget opens on: what is due next, what came in from Classroom,
 * the mail that matters, and a line to write something down. Everything
 * else is a tap away.
 */
export function TodayView({ active, now, capture, onEdit, onSection }: Props) {
  const inbox = useInbox()
  const next = [...active].sort(compareByUrgency(now))
  const dueNow = next.filter((r) => ['overdue', 'soon', 'today'].includes(urgencyOf(r, now)))
  const due = (dueNow.length ? dueNow : next).slice(0, 5)
  const posts = inbox.classroom.filter((r) => !r.read && !r.classroom?.submitted && now - r.foundAt < FRESH_MS)
  const mail = inbox.mail.filter((r) => !r.read && isImportant(r, inbox.senders) && now - r.foundAt < FRESH_MS)
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <section className="view today" aria-label="Today">
      <header className="view-head">
        <h1 className="view-title">Today</h1>
        <span className="view-sub">{date}</span>
      </header>

      {capture}
      {inbox.signedIn && <PausedNotice />}

      <Part
        title={dueNow.length ? 'Due today' : 'Coming up'}
        count={dueNow.length || undefined}
        more={next.length > due.length ? `All ${next.length} tasks` : 'All tasks'}
        onMore={() => onSection('tasks')}
      >
        {due.length === 0 ? (
          <p className="today-empty">Nothing due. Write something with a date above — “submit lab report fri 5pm”.</p>
        ) : (
          <ul className="task-list">
            {due.map((r) => (
              <TaskRow key={r.id} reminder={r} level={urgencyOf(r, now)} now={now} onEdit={onEdit} />
            ))}
          </ul>
        )}
      </Part>

      {inbox.signedIn && (
        <>
          <Part title="New in Classroom" count={posts.length || undefined} more="Classroom" onMore={() => onSection('classroom')}>
            {posts.length === 0 ? (
              <p className="today-empty">{inbox.classroomReaders.length ? 'No new coursework or announcements.' : 'Classroom is set up on your phone.'}</p>
            ) : (
              <ul className="today-list">
                {posts.slice(0, SHOWN).map((r) => (
                  <Item key={r.id} record={r} meta={r.classroom!.course} now={now} onOpen={() => inbox.open(r)} />
                ))}
              </ul>
            )}
          </Part>

          <Part title="Important mail" count={mail.length || undefined} more="Inbox" onMore={() => onSection('inbox')}>
            {mail.length === 0 ? (
              <p className="today-empty">{inbox.mailReaders.length ? 'Nothing important waiting.' : 'Gmail is set up on your phone.'}</p>
            ) : (
              <ul className="today-list">
                {mail.slice(0, SHOWN).map((r) => (
                  <Item key={r.id} record={r} meta={sender(r.from)} now={now} onOpen={() => inbox.open(r)} />
                ))}
              </ul>
            )}
          </Part>
          <p className="view-status">{readerStatus(inbox, now)}</p>
        </>
      )}
    </section>
  )
}

function Part({ title, count, more, onMore, children }: { title: string; count?: number; more: string; onMore: () => void; children: ReactNode }) {
  return (
    <section className="today-part" aria-label={title}>
      <h2 className="group-head">
        {title}
        {count ? <span className="group-count">{count}</span> : null}
        <span className="spacer" />
        <button type="button" className="quiet today-more" onClick={onMore}>
          {more} ›
        </button>
      </h2>
      {children}
    </section>
  )
}

/** One post or email: what it is about, in a line, and when it is due if it says. */
function Item({ record, meta, now, onOpen }: { record: InboxRecord; meta: string; now: number; onOpen: () => void }) {
  const due = dueOf(record)
  return (
    <li>
      <button type="button" className="today-item" onClick={onOpen} title={record.classroom ? 'Open in Classroom' : 'Open in Gmail'}>
        <span className="today-item-meta">
          {meta} · {formatAgo(record.receivedAt, now)}
        </span>
        <span className="today-item-title">{record.subject || '(no subject)'}</span>
        {record.triage?.summary && record.triage.summary !== record.subject && <span className="today-item-summary">{record.triage.summary}</span>}
        {due && <span className="mail-due">Due {formatDue(due.dueAt, due.allDay, now)}</span>}
      </button>
    </li>
  )
}
