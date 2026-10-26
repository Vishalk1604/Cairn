import { modelsFor, type NoteQuery } from '@cairn/sync'
import { featuresOf, owner, readerStatus, readingOn, readsAnnouncements, recycleBin, SERVICE_NAMES, sources, type Account, type AccountGap, type Feature } from '@cairn/ui'
import { useEffect, useState } from 'react'
import { useClassroomFiles } from '../app/classroomFiles'
import { useCairn } from '../app/context'
import { usePaused } from '../app/folders'
import { useObserved } from '../app/hooks'
import { useInbox } from '../app/inbox'
import { useMediaFolder } from '../app/media'
import { useToast } from '../app/toast'
import type { PermissionState } from '../platform'
import { AccountsDialog } from './AccountsDialog'
import { AiKeyDialog, ProfileDialog } from './AiDialogs'
import { LinkRow, Row, Section, Switch } from './SettingsParts'
import { SyncButton } from './SyncButton'

const SITE = 'https://cairn-vishalk.web.app'
const WITH_DELETED: NoteQuery = { includeDeleted: true }

/**
 * Everything that is set once and then left alone, grouped the way it is
 * looked for: who Cairn reads as, how mail is sorted, Classroom, notes,
 * this computer.
 */
export function SettingsView({ onBin, onClassroomFiles }: { onBin: () => void; onClassroomFiles: () => void }) {
  return (
    <section className="view settings" aria-label="Settings">
      <header className="view-head">
        <h1 className="view-title">Settings</h1>
      </header>
      <AccountsSection />
      <InboxSection />
      <ClassroomSection onFiles={onClassroomFiles} />
      <NotesSection onBin={onBin} />
      <MediaSection />
      <SystemSection />
      <AboutSection />
    </section>
  )
}

/** Runs an action with the row busy, and says what went wrong rather than failing silently. */
function useRun(): { busy: string | null; run: (key: string, work: () => Promise<void>) => Promise<void> } {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    try {
      await work()
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function AccountsSection() {
  const cairn = useCairn()
  const { auth, accounts, signIn, signOut, regrant, matchAccount, disconnectSource, sync } = cairn
  const inbox = useInbox()
  const { paused, setPaused } = usePaused()
  const { busy, run } = useRun()
  const [adding, setAdding] = useState(false)
  const holder = owner(accounts)

  if (!holder) {
    return (
      <Section title="Accounts & access" note="Signed in, notes and tasks sync with your phone, and so do the inbox and Classroom. Signed out, everything stays on this computer.">
        <Row
          title={auth.status === 'error' ? 'Not syncing' : 'On this computer only'}
          detail={auth.status === 'error' ? auth.message : auth.status === 'connecting' ? 'Finish signing in in your browser…' : 'Sign in with the Google account your phone uses.'}
          tone={auth.status === 'error' ? 'danger' : undefined}
        >
          <button type="button" className="accent-button" disabled={auth.status === 'connecting'} onClick={() => void signIn()}>
            {auth.status === 'error' ? 'Try again' : 'Sign in with Google'}
          </button>
        </Row>
      </Section>
    )
  }

  /**
   * Switching off is a choice shared with the phone and takes effect at
   * once. Switching on only goes to Google when this computer lacks the
   * permission, and reading then starts from that moment.
   */
  const toggle = (account: Account, feature: Feature) => {
    const sub = account.identity.sub
    if (readingOn(account, feature, paused)) {
      void setPaused(feature, sub, true)
      return
    }
    void run(`${sub}:${feature}`, async () => {
      if (!featuresOf(account)[feature]) await regrant(account, { ...featuresOf(account), [feature]: true })
      await inbox.startFresh(sub, feature)
      await setPaused(feature, sub, false)
    })
  }

  const syncAll = () => {
    void sync.run()
    void inbox.refresh(true)
  }

  return (
    <Section
      title="Accounts & access"
      note={`${holder.identity.email} holds your notes and tasks. Other accounts, such as a university one, are only read. Each device asks Google for itself, so this computer and your phone connect accounts separately.`}
    >
      {[holder, ...sources(accounts)].map((account) => (
        <AccountRows
          key={account.identity.sub}
          account={account}
          status={
            account.role === 'owner'
              ? auth.status === 'synced'
                ? 'Holds your notes · syncing'
                : auth.status === 'error'
                  ? auth.message
                  : 'Connecting…'
              : 'Read only'
          }
          danger={account.role === 'owner' && auth.status === 'error'}
          syncing={account.role === 'owner' ? sync.busy || inbox.refreshing : inbox.refreshing}
          syncedAt={account.role === 'owner' ? sync.at : inbox.checkedAt}
          onSync={account.role === 'owner' ? syncAll : () => void inbox.refresh(true)}
          paused={paused}
          busy={busy}
          onToggle={(feature) => toggle(account, feature)}
          onAnnouncements={() => void run(`${account.identity.sub}:announcements`, () => regrant(account, { ...featuresOf(account), classroom: true }))}
          onRemove={account.role === 'source' ? () => void run(`x${account.identity.sub}`, () => disconnectSource(account.identity.sub)) : undefined}
        />
      ))}
      {inbox.gaps.map((gap) => (
        <GapRow key={gap.sub} gap={gap} busy={busy === `gap:${gap.sub}`} onConnect={() => void run(`gap:${gap.sub}`, () => matchAccount(gap))} />
      ))}
      <Row title="Another account" detail="A university or work account to read Gmail and Classroom from.">
        <button type="button" className="button" onClick={() => setAdding(true)}>
          Connect…
        </button>
      </Row>
      <Row title="Sign out" detail="Notes stay on this computer; they just stop syncing.">
        <button type="button" className="button quiet-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </Row>
      {adding && <AccountsDialog adding onClose={() => setAdding(false)} />}
    </Section>
  )
}

function AccountRows({
  account,
  status,
  danger,
  syncing,
  syncedAt,
  onSync,
  paused,
  busy,
  onToggle,
  onAnnouncements,
  onRemove,
}: {
  account: Account
  status: string
  danger: boolean
  syncing: boolean
  syncedAt: number | null
  onSync: () => void
  paused: Record<Feature, string[]>
  busy: string | null
  onToggle: (feature: Feature) => void
  onAnnouncements: () => void
  onRemove?: () => void
}) {
  const sub = account.identity.sub
  const files = featuresOf(account).files
  return (
    <>
      <Row
        title={
          <>
            {account.identity.email} {account.identity.domain && <span className="badge">{account.identity.domain}</span>}
          </>
        }
        detail={`${status}${files ? ' · saves class files here' : ''}`}
        tone={danger ? 'danger' : undefined}
        head
      >
        <SyncButton busy={syncing} at={syncedAt} onClick={onSync} label={`Sync ${account.identity.email}`} />
        {onRemove && (
          <button type="button" className="button quiet-button" disabled={busy !== null} onClick={onRemove}>
            Remove
          </button>
        )}
      </Row>
      <Row title="Read Gmail" detail="New mail, sorted into the Inbox">
        <Switch on={readingOn(account, 'mail', paused)} disabled={busy === `${sub}:mail`} label={`Read Gmail for ${account.identity.email}`} onChange={() => onToggle('mail')} />
      </Row>
      <Row title="Read Classroom" detail="New coursework and announcements, in the Classroom tab">
        <Switch on={readingOn(account, 'classroom', paused)} disabled={busy === `${sub}:classroom`} label={`Read Classroom for ${account.identity.email}`} onChange={() => onToggle('classroom')} />
      </Row>
      {readingOn(account, 'classroom', paused) && !readsAnnouncements(account) && (
        <Row title="Read announcements too" detail="Classroom was switched on before Cairn read announcements. Google will ask once more.">
          <button type="button" className="button" disabled={busy !== null} onClick={onAnnouncements}>
            Allow…
          </button>
        </Row>
      )}
    </>
  )
}

/** Something the phone reads that this computer cannot yet. */
function GapRow({ gap, busy, onConnect }: { gap: AccountGap; busy: boolean; onConnect: () => void }) {
  return (
    <Row
      title={`Connect ${gap.email} to match your phone`}
      detail={`Your phone has ${gap.missing.map((s) => SERVICE_NAMES[s]).join(' and ')} for it. Google asks this computer separately; until then the phone does the reading.`}
    >
      <button type="button" className="accent-button" disabled={busy} onClick={onConnect}>
        {busy ? 'Waiting for your browser…' : 'Connect…'}
      </button>
    </Row>
  )
}

function InboxSection() {
  const { auth } = useCairn()
  const inbox = useInbox()
  const toast = useToast()
  const { busy, run } = useRun()
  const [keyDialog, setKeyDialog] = useState(false)
  const [profileDialog, setProfileDialog] = useState(false)
  const signedIn = auth.status === 'synced'

  return (
    <Section
      title="Inbox & AI"
      note="With a key, the device reading your mail sends the text of each new email and Classroom post to NVIDIA's AI service, which picks out what matters, files it into folders, tags it and reads off any deadline. The key is kept in your Cairn account, so your phone uses it too."
    >
      {signedIn && (
        <Row title="Who reads your mail" detail={`${readerStatus(inbox, 'desktop', Date.now())}. This computer reads whenever it is on and has the same access as your phone.`}>
          <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onClick={() => void inbox.refresh(true)} label="Check now" />
        </Row>
      )}
      <Row title="What matters to you" detail={inbox.profile.length > 160 ? `${inbox.profile.slice(0, 157)}…` : inbox.profile}>
        <button type="button" className="button" onClick={() => setProfileDialog(true)}>
          Edit…
        </button>
      </Row>
      {inbox.ai.on ? (
        <Row
          title="AI sorting is on"
          detail={inbox.ai.error ?? (inbox.ai.model ? `Last sorted by ${inbox.ai.model}` : `Uses ${inbox.ai.preferred ?? 'GPT-OSS'} from the next mail that arrives`)}
          tone={inbox.ai.error ? 'danger' : undefined}
        >
          <button type="button" className="button" onClick={() => setKeyDialog(true)}>
            Change key
          </button>
          <button type="button" className="button quiet-button" disabled={busy === 'ai'} onClick={() => void run('ai', () => inbox.setAiSetup(null))}>
            Remove
          </button>
        </Row>
      ) : (
        <Row title="Add an NVIDIA API key" detail="Free from NVIDIA. Paste the code from their GPT-OSS page and Cairn finds the key in it. Added on your phone, it shows here by itself.">
          <button type="button" className="accent-button" onClick={() => setKeyDialog(true)}>
            Add key…
          </button>
        </Row>
      )}
      {keyDialog && (
        <AiKeyDialog
          onClose={() => setKeyDialog(false)}
          onSave={async (setup, model) => {
            await inbox.setAiSetup(setup)
            const preferred = modelsFor(setup)[0]?.label ?? model
            toast({ message: model === preferred ? `Key works. Mail will be sorted by ${model}.` : `Key works. ${preferred} is busy, so ${model} will sort mail for now.` })
          }}
        />
      )}
      {profileDialog && (
        <ProfileDialog
          profile={inbox.profile}
          onClose={() => setProfileDialog(false)}
          onSave={(text) => {
            void inbox.setProfile(text)
            toast({ message: 'Saved. New mail is read with it from now on, here and on your phone.' })
          }}
        />
      )}
    </Section>
  )
}

function ClassroomSection({ onFiles }: { onFiles: () => void }) {
  const { auth } = useCairn()
  const inbox = useInbox()
  const files = useClassroomFiles()
  const picked = files?.courses.filter((c) => c.selected).length ?? 0
  return (
    <Section title="Classroom">
      <Row
        title="Automatically add tasks"
        detail="New coursework becomes a task at its due date and ticks itself off when handed in. Announcements become tasks at any date they give. On your phone too."
      >
        <Switch on={inbox.autoTasks} disabled={auth.status !== 'synced'} label="Automatically add tasks" onChange={(on) => void inbox.setAutoTasks(on)} />
      </Row>
      {files ? (
        <>
          <Row title="Files folder" detail={<span className="path">{files.folder}</span>}>
            <button type="button" className="button" onClick={() => void files.chooseFolder()}>
              Change…
            </button>
            <button type="button" className="button quiet-button" onClick={() => void files.openFolder()}>
              Open
            </button>
          </Row>
          <LinkRow
            title="Classes to save files from"
            detail={picked ? `${picked} ${picked === 1 ? 'class' : 'classes'} · ${files.saved} ${files.saved === 1 ? 'file' : 'files'} saved` : 'None yet. Pick them in the Classroom tab.'}
            onClick={onFiles}
          />
        </>
      ) : (
        <Row title="Files from Classroom" detail="Saved by the Cairn desktop app. A browser tab has nowhere to keep them." />
      )}
    </Section>
  )
}

function NotesSection({ onBin }: { onBin: () => void }) {
  const { notes } = useCairn()
  const binned = recycleBin(useObserved(notes, WITH_DELETED), Date.now()).length
  return (
    <Section title="Notes">
      <LinkRow title="Recycle bin" detail={`${binned === 0 ? 'Empty' : binned === 1 ? '1 note' : `${binned} notes`} · deleted notes are kept for 30 days`} onClick={onBin} />
    </Section>
  )
}

function MediaSection() {
  const media = useMediaFolder()
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  if (!media) {
    return (
      <Section title="Media">
        <Row title="Photos and recordings" detail="Shown in the Cairn desktop app. A browser tab has nowhere to keep them." />
      </Section>
    )
  }

  const status = media.error
    ? media.error
    : media.fetching
      ? `Fetching ${media.fetching} from your Drive…`
      : !media.signedIn
        ? 'Sign in to fetch them from your Drive.'
        : media.files === 0
          ? 'Nothing here yet. Photos added on your phone arrive on their own.'
          : `${media.files} ${media.files === 1 ? 'file' : 'files'} · ${size(media.bytes)} · up to date`

  return (
    <Section
      title="Media"
      note="Photos and recordings added on your phone are downloaded here so they show in your notes. When one is changed or deleted on the phone, the copy here follows. Only Cairn's own files in the folder are ever touched."
    >
      <Row title="Photos and recordings folder" detail={<span className="path">{media.folder}</span>}>
        <button type="button" className="button" disabled={busy} onClick={() => void run(media.chooseFolder)}>
          Change…
        </button>
        <button type="button" className="button quiet-button" onClick={() => void media.openFolder()}>
          Open
        </button>
      </Row>
      {!media.isDefault && (
        <Row title="Use the default folder" detail="Cairn's own folder in your app data, moving the files back there.">
          <button type="button" className="button quiet-button" disabled={busy} onClick={() => void run(media.useDefaultFolder)}>
            Use default
          </button>
        </Row>
      )}
      <Row title="Status" detail={status} tone={media.error ? 'danger' : undefined} />
    </Section>
  )
}

function SystemSection() {
  const { platform } = useCairn()
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const [autostart, setAutostart] = useState<boolean | null>(null)

  useEffect(() => {
    void platform.notificationPermission().then(setPermission)
    void platform.autostart?.isEnabled().then(setAutostart)
  }, [platform])

  return (
    <Section title="This computer">
      <Row
        title="Notifications"
        detail={
          permission === 'granted'
            ? 'On. Cairn alerts you when things are due, and when important mail arrives.'
            : permission === 'denied'
              ? 'Blocked. Allow them in your system settings; your lists still work.'
              : 'Off, so nothing alerts you when it is due.'
        }
        tone={permission === 'granted' ? undefined : 'danger'}
      >
        {permission === 'default' && (
          <button type="button" className="button" onClick={async () => setPermission(await platform.requestNotificationPermission())}>
            Turn on
          </button>
        )}
      </Row>
      {platform.autostart && autostart !== null && (
        <Row title="Start with Windows" detail="Opens quietly as the widget when you log in, so mail keeps being read.">
          <Switch on={autostart} label="Start with Windows" onChange={async (next) => setAutostart(await platform.autostart!.set(next))} />
        </Row>
      )}
      <Row title="Quick capture" detail="Press Ctrl+Shift+Space anywhere to write something down." />
    </Section>
  )
}

function AboutSection() {
  const { platform } = useCairn()
  return (
    <Section title="About">
      <Row title="Privacy policy">
        <button type="button" className="button quiet-button" onClick={() => void platform.openLink(`${SITE}/privacy`)}>
          Open
        </button>
      </Row>
      <Row title="Terms">
        <button type="button" className="button quiet-button" onClick={() => void platform.openLink(`${SITE}/terms`)}>
          Open
        </button>
      </Row>
    </Section>
  )
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
