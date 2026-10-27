import type { NoteQuery } from '@cairn/sync'
import { accountProblem, CLASSROOM_FROM_EMAIL, describeReading, readerStatus, recycleBin, type AiStatus, type WorkerAccount } from '@cairn/ui'
import { useEffect, useState } from 'react'
import { useClassroomFiles } from '../app/classroomFiles'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { useInbox } from '../app/inbox'
import { useMediaFolder } from '../app/media'
import { useToast } from '../app/toast'
import type { PermissionState } from '../platform'
import { ProfileDialog } from './ProfileDialog'
import { LinkRow, Row, Section, Switch } from './SettingsParts'
import { SyncButton } from './SyncButton'

const SITE = 'https://cairn-vishalk.web.app'
const WITH_DELETED: NoteQuery = { includeDeleted: true }

/**
 * Everything that is set once and then left alone, grouped the way it is
 * looked for: who this computer is signed in as, what the phone set up, the
 * inbox, Classroom, notes, this computer.
 */
export function SettingsView({ onBin, onClassroomFiles }: { onBin: () => void; onClassroomFiles: () => void }) {
  return (
    <section className="view settings" aria-label="Settings">
      <header className="view-head">
        <h1 className="view-title">Settings</h1>
      </header>
      <AccountSection />
      <PhoneSection />
      <InboxSection />
      <ClassroomSection onFiles={onClassroomFiles} />
      <NotesSection onBin={onBin} />
      <MediaSection />
      <SystemSection />
      <AboutSection />
    </section>
  )
}

/** Shown on what only the phone changes. */
function Managed() {
  return <span className="managed">Managed on your phone</span>
}

/** The one sign-in this computer has. */
function AccountSection() {
  const { auth, email, signIn, signOut, sync } = useCairn()
  const inbox = useInbox()
  if (auth.status !== 'synced' || !email) {
    return (
      <Section
        title="Account"
        note="Sign in with the Google account you set Cairn up with on your phone. Notes, tasks, the inbox and Classroom then show here too. Signed out, everything stays on this computer."
      >
        <Row
          title={auth.status === 'error' ? 'Not syncing' : 'On this computer only'}
          detail={auth.status === 'error' ? auth.message : auth.status === 'connecting' ? 'Finish signing in in your browser…' : 'Google asks once, in your browser.'}
          tone={auth.status === 'error' ? 'danger' : undefined}
        >
          <button type="button" className="accent-button" disabled={auth.status === 'connecting'} onClick={() => void signIn()}>
            {auth.status === 'error' ? 'Try again' : 'Sign in with Google'}
          </button>
        </Row>
      </Section>
    )
  }
  return (
    <Section title="Account">
      <Row title={email} detail="Holds your notes and tasks · syncing" head>
        <SyncButton
          busy={sync.busy || inbox.refreshing}
          at={sync.at}
          onClick={() => {
            void sync.run()
            void inbox.refresh()
          }}
          label="Sync now"
        />
      </Row>
      <Row title="Sign out" detail="Notes stay on this computer; they just stop syncing. Your phone and Cairn's server carry on.">
        <button type="button" className="button quiet-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </Row>
    </Section>
  )
}

/**
 * What the phone set up — which accounts are read, and AI sorting — shown
 * here and changed there, so Cairn is set up in one place.
 */
function PhoneSection() {
  const { auth } = useCairn()
  const inbox = useInbox()
  if (auth.status !== 'synced') return null
  return (
    <Section
      title="Accounts & AI"
      note="Cairn's server reads these accounts every ten minutes, sorts new mail with your NVIDIA key and writes what it finds for this computer and your phone. Add accounts, choose what is read and set up AI sorting in Cairn on your phone."
    >
      {inbox.accounts.length === 0 && <Row title="No accounts yet" detail="Set Cairn up on your phone: it walks you through it." />}
      {inbox.accounts.map((account) => (
        <AccountRow key={account.email} account={account} />
      ))}
      <Row title="AI sorting" detail={aiDetail(inbox.ai)} tone={inbox.ai.on && inbox.ai.error ? 'danger' : undefined}>
        <Managed />
      </Row>
      <Row title="Mail checks" detail={readerStatus(inbox, Date.now())} tone={inbox.paused ? 'danger' : undefined}>
        <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onClick={() => void inbox.refresh()} label="Check now" caption={false} />
      </Row>
    </Section>
  )
}

function aiDetail(ai: AiStatus): string {
  if (!ai.on) return 'Off. New mail is checked for deadlines by fixed rules.'
  if (ai.error) return `On, but the last try failed: ${ai.error}`
  return ai.model ? `On · last sorted by ${ai.model}` : `On · ${ai.preferred ?? 'GPT-OSS'} sorts new mail`
}

function AccountRow({ account }: { account: WorkerAccount }) {
  const detail = [account.role === 'owner' ? 'Holds your notes' : 'Read only', `reads ${describeReading(account)}`, account.services.includes('files') ? 'class files allowed' : '']
    .filter(Boolean)
    .join(' · ')
  const problem = accountProblem(account)
  return (
    <Row
      title={account.email}
      detail={problem ?? (account.classroomVia === 'email' && account.watch.classroom ? `${detail}. ${CLASSROOM_FROM_EMAIL}.` : detail)}
      tone={problem ? 'danger' : undefined}
    >
      <Managed />
    </Row>
  )
}

function InboxSection() {
  const { auth } = useCairn()
  const inbox = useInbox()
  const toast = useToast()
  const [profileDialog, setProfileDialog] = useState(false)
  if (auth.status !== 'synced') return null
  return (
    <Section title="Inbox" note="What the AI is told matters to you. It reads every new email and Classroom post with this in mind.">
      <Row title="What matters to you" detail={inbox.profile.length > 160 ? `${inbox.profile.slice(0, 157)}…` : inbox.profile}>
        <button type="button" className="button" onClick={() => setProfileDialog(true)}>
          Edit…
        </button>
      </Row>
      {profileDialog && (
        <ProfileDialog
          profile={inbox.profile}
          onClose={() => setProfileDialog(false)}
          onSave={(text) => {
            void inbox.setProfile(text)
            toast({ message: 'Saved. New mail is read with it from now on.' })
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
        detail="New coursework becomes a task at its due date and ticks itself off when handed in. Announcements become tasks at any date they give. Shared with your phone."
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
  const [pinned, setPinned] = useState<boolean | null>(null)

  useEffect(() => {
    void platform.notificationPermission().then(setPermission)
    void platform.autostart?.isEnabled().then(setAutostart)
    void platform.desk?.pinned().then(setPinned)
  }, [platform])

  return (
    <Section title="This computer">
      <Row
        title="Notifications"
        detail={
          permission === 'granted'
            ? 'On. Cairn alerts you when things are due, and when new coursework or important mail arrives while it runs.'
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
        <Row title="Start with Windows" detail="Opens quietly as the widget when you log in, so reminders keep firing.">
          <Switch on={autostart} label="Start with Windows" onChange={async (next) => setAutostart(await platform.autostart!.set(next))} />
        </Row>
      )}
      {platform.desk && pinned !== null && (
        <Row
          title="Pin to desktop"
          detail="Today on your wallpaper, behind your windows and still there after Show desktop. Click a circle to tick a task off; double-click for the full app."
        >
          <Switch on={pinned} label="Pin to desktop" onChange={async (next) => setPinned(await platform.desk!.pin(next))} />
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
