import { dueOf, inboxTaskId, isImportant, tagsOf, type InboxRecord, type SenderRule } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatAgo, formatDue, readerStatus, SERVICE_NAMES, type AccountGap } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { useInbox } from '../app/inbox'
import { useToast } from '../app/toast'
import { InboxIcon } from './icons'
import { SyncButton } from './SyncButton'

const LIVE_TASKS: ReminderQuery = {}

type Filter = { kind: 'important' } | { kind: 'folder'; name: string } | { kind: 'rest' }

export function sender(from: string): string {
  return from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || from
}

/**
 * Gmail, sorted — the same inbox the phone shows, from the same records.
 * Important collects what needs attention, folders the model made gather
 * what belongs together, and the rest waits under Everything else.
 */
export function InboxView({ onSettings }: { onSettings: () => void }) {
  const inbox = useInbox()
  const toast = useToast()
  const { reminders, accounts } = useCairn()
  const tasks = useObserved(reminders, LIVE_TASKS)
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const [filter, setFilter] = useState<Filter>({ kind: 'important' })
  const [account, setAccount] = useState<string | null>(null)
  const now = Date.now()

  const { markSeen } = inbox
  useEffect(() => markSeen('inbox'), [markSeen, inbox.mail.length])

  const picked = account && inbox.mailAccounts.accounts.includes(account) ? account : null
  const visible = picked ? inbox.mail.filter((r) => r.account === picked) : inbox.mail
  const important = visible.filter((r) => isImportant(r, inbox.senders))
  const rest = visible.filter((r) => !isImportant(r, inbox.senders))
  const folders = inbox.folders.filter((f) => visible.some((r) => r.triage?.folder === f))
  const current = filter.kind === 'folder' && !folders.includes(filter.name) ? ({ kind: 'important' } as Filter) : filter
  const shown = current.kind === 'important' ? important : current.kind === 'rest' ? rest : visible.filter((r) => r.triage?.folder === current.name)
  const gaps = inbox.gaps.filter((g) => g.missing.includes('mail'))

  const mark = (record: InboxRecord, rule: SenderRule) => {
    void inbox.mark(record, rule)
    toast({
      message: rule === 'unimportant' ? `Mail from ${sender(record.from)} will skip Important` : `Mail from ${sender(record.from)} will stay in Important`,
      action: { label: 'Undo', run: () => void inbox.mark(record, rule === 'important' ? 'unimportant' : 'important') },
    })
  }

  const head = (
    <header className="view-head keep">
      <h1 className="view-title">Inbox</h1>
      <span className="view-sub">{important.length ? `${important.length} important` : ''}</span>
      <span className="spacer" />
      {inbox.signedIn && <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onClick={() => void inbox.refresh(true)} label="Check mail now" />}
    </header>
  )

  if (!inbox.signedIn || accounts.length === 0 || (inbox.mailAccounts.accounts.length === 0 && gaps.length === 0)) {
    return (
      <section className="view" aria-label="Inbox">
        {head}
        <div className="empty">
          <span className="empty-icon">
            <InboxIcon size={30} />
          </span>
          <p>
            {!inbox.signedIn
              ? 'Sign in with the Google account your phone uses, and the inbox your phone sorts shows here too.'
              : 'Turn on Gmail for an account in Settings. Classroom posts have their own tab.'}
          </p>
          <button type="button" className="accent-button" onClick={onSettings}>
            Open Settings
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="view" aria-label="Inbox">
      {head}
      <AccountChips chips={inbox.mailAccounts} current={picked} onPick={setAccount} />
      <div className="chips" role="tablist" aria-label="Sections">
        <Chip label="Important" count={important.length} on={current.kind === 'important'} onClick={() => setFilter({ kind: 'important' })} />
        {folders.map((name) => (
          <Chip
            key={name}
            label={name}
            count={visible.filter((r) => r.triage?.folder === name).length}
            on={current.kind === 'folder' && current.name === name}
            onClick={() => setFilter({ kind: 'folder', name })}
          />
        ))}
        {rest.length > 0 && <Chip label="Everything else" count={rest.length} on={current.kind === 'rest'} onClick={() => setFilter({ kind: 'rest' })} />}
      </div>

      <GapNotices gaps={gaps} what="mail" />
      {inbox.error && <p className="notice danger">{inbox.error}</p>}
      {inbox.ai.on && inbox.ai.error && <p className="notice">AI sorting paused: {inbox.ai.error} New mail is still checked for deadlines.</p>}
      {!inbox.ai.on && (
        <div className="notice">
          <span className="notice-text">
            <strong>Sort mail into folders with AI</strong>
            <span>Add your NVIDIA API key in Settings — once, on either device — and each new email is read to pick out what matters.</span>
          </span>
          <button type="button" className="button" onClick={onSettings}>
            Settings
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="view-status">
          {current.kind === 'important' ? 'Nothing important yet. New mail shows here from the moment Gmail was switched on.' : 'Nothing here right now.'}
        </p>
      ) : (
        <ul className="mail-list">
          {shown.map((record) => (
            <MailCard
              key={record.id}
              record={record}
              senders={inbox.senders}
              showFolder={current.kind !== 'folder'}
              showAccount={inbox.mailAccounts.all && !picked}
              added={taskIds.has(inboxTaskId(record))}
              now={now}
              onOpen={() => inbox.open(record)}
              onAdd={() => void inbox.addAsTask(record).then(() => toast({ message: 'Added to Tasks' }))}
              onMark={(rule) => mark(record, rule)}
              onHide={() => {
                void inbox.dismiss(record)
                toast({ message: 'Hidden on every device', action: { label: 'Undo', run: () => void inbox.dismiss(record, false) } })
              }}
            />
          ))}
        </ul>
      )}
      <p className="view-status">
        {readerStatus(inbox, 'desktop', now)}
        {inbox.ai.model ? ` · sorted by ${inbox.ai.model}` : ''}
      </p>
    </section>
  )
}

export function Chip({ label, count, on, onClick }: { label: string; count?: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="tab" aria-selected={on} className="chip" onClick={onClick}>
      {label}
      {count ? <span className="seg-count"> {count}</span> : null}
    </button>
  )
}

/** All and one chip per account when there are several; just the account when there is one. */
export function AccountChips({ chips, current, onPick }: { chips: { all: boolean; accounts: string[] }; current: string | null; onPick: (account: string | null) => void }) {
  if (chips.accounts.length === 0) return null
  if (!chips.all) return <p className="account-only">{chips.accounts[0]}</p>
  return (
    <div className="chips account-chips" role="tablist" aria-label="Accounts">
      <Chip label="All" on={current === null} onClick={() => onPick(null)} />
      {chips.accounts.map((account) => (
        <Chip key={account} label={account} on={current === account} onClick={() => onPick(account)} />
      ))}
    </div>
  )
}

/** What the phone reads that this computer cannot yet, with the way to put it right: Google asks this computer separately. */
export function GapNotices({ gaps, what }: { gaps: AccountGap[]; what: string }) {
  const { matchAccount } = useCairn()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const connect = async (gap: AccountGap) => {
    setBusy(gap.sub)
    try {
      await matchAccount(gap)
      toast({ message: `${gap.email} now matches your phone` })
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      {gaps.map((gap) => (
        <div key={gap.sub} className="notice accent">
          <span className="notice-text">
            <strong>Connect {gap.email} to match your phone</strong>
            <span>
              Your phone reads {gap.missing.map((s) => SERVICE_NAMES[s]).join(' and ')} for it. Until this computer can too, the phone reads your {what}.
            </span>
          </span>
          <button type="button" className="button" disabled={busy !== null} onClick={() => void connect(gap)}>
            {busy === gap.sub ? 'Waiting for your browser…' : 'Connect…'}
          </button>
        </div>
      ))}
    </>
  )
}

function MailCard({
  record,
  senders,
  showFolder,
  showAccount,
  added,
  now,
  onOpen,
  onAdd,
  onMark,
  onHide,
}: {
  record: InboxRecord
  senders: Record<string, SenderRule>
  showFolder: boolean
  showAccount: boolean
  added: boolean
  now: number
  onOpen: () => void
  onAdd: () => void
  onMark: (rule: SenderRule) => void
  onHide: () => void
}) {
  const { triage } = record
  const important = isImportant(record, senders)
  const due = dueOf(record)
  const summary = triage?.summary ?? record.snippet
  const tags = triage ? tagsOf(record) : []
  return (
    <li className={`mail ${record.read ? 'read' : ''}`}>
      <button type="button" className="mail-open" onClick={onOpen} title="Open in Gmail">
        <span className="mail-head">
          {!record.read && <span className="unread-dot" aria-label="Unread" />}
          {showFolder && triage?.folder && <span className="folder-tag">{triage.folder}</span>}
          <span className="mail-meta">
            {sender(record.from)} · {formatAgo(record.receivedAt, now)}
            {showAccount ? ` · ${record.account}` : ''}
          </span>
        </span>
        <h3 className="mail-subject">{record.subject || '(no subject)'}</h3>
        {summary && <p className="mail-summary">{summary}</p>}
        {record.sorting && <span className="mail-tags">Sorting…</span>}
        {important && triage?.why && <span className="mail-why">{triage.why}</span>}
        {tags.length > 0 && <span className="mail-tags">{tags.map((t) => `#${t}`).join('  ')}</span>}
        {due && (
          <span className="mail-due">
            {due.title} · {formatDue(due.dueAt, due.allDay, now)}
          </span>
        )}
      </button>
      <div className="mail-foot">
        <button type="button" className="quiet" onClick={() => onMark(important ? 'unimportant' : 'important')}>
          {important ? 'Not important' : 'Important'}
        </button>
        <button type="button" className="quiet" onClick={onHide}>
          Hide
        </button>
        <span className="spacer" />
        {added ? (
          <span className="in-tasks">✓ In Tasks</span>
        ) : (
          due && (
            <button type="button" className="accent-button" onClick={onAdd}>
              Add as task
            </button>
          )
        )}
      </div>
    </li>
  )
}
