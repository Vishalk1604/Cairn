import type { NoteQuery } from '@cairn/sync'
import { binCountdown, featuresOf, noteHeading, owner, recycleBin, sources } from '@cairn/ui'
import { useEffect, useState, type ReactNode } from 'react'
import { useActions } from '../app/actions'
import { useClassroomFiles } from '../app/classroomFiles'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'
import { useMediaFolder } from '../app/media'
import type { PermissionState } from '../platform'
import { AccountsDialog } from './AccountsDialog'

const SITE = 'https://cairn-vishalk.web.app'
const WITH_DELETED: NoteQuery = { includeDeleted: true }

/** Everything that is set once and then left alone, in one place. */
export function SettingsView() {
  return (
    <section className="view settings" aria-label="Settings">
      <header className="view-head">
        <h1 className="view-title">Settings</h1>
      </header>
      <AccountSection />
      <MediaSection />
      <ClassroomSection />
      <BinSection />
      <SystemSection />
      <AboutSection />
    </section>
  )
}

function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-heading">{title}</h2>
      {note && <p className="settings-note">{note}</p>}
      <div className="settings-card">{children}</div>
    </section>
  )
}

function Row({ title, detail, tone, children }: { title: string; detail?: ReactNode; tone?: 'danger'; children?: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {detail && <span className={`settings-row-detail ${tone ?? ''}`}>{detail}</span>}
      </div>
      {children && <div className="settings-row-actions">{children}</div>}
    </div>
  )
}

function AccountSection() {
  const { auth, accounts, signIn, signOut } = useCairn()
  const [managing, setManaging] = useState(false)
  const holder = owner(accounts)
  const extra = sources(accounts).length

  return (
    <Section title="Account" note="Signed in, notes and tasks sync with your phone. Signed out, everything stays on this computer.">
      {holder ? (
        <>
          <Row
            title={holder.identity.email}
            detail={
              auth.status === 'synced'
                ? `Syncing${extra ? ` · reading ${extra === 1 ? 'one more account' : `${extra} more accounts`}` : ''}`
                : auth.status === 'error'
                  ? auth.message
                  : 'Connecting…'
            }
            tone={auth.status === 'error' ? 'danger' : undefined}
          >
            <button type="button" className="button" onClick={() => setManaging(true)}>
              Accounts
            </button>
            <button type="button" className="button quiet-button" onClick={() => void signOut()}>
              Sign out
            </button>
          </Row>
        </>
      ) : (
        <Row
          title={auth.status === 'error' ? 'Not syncing' : 'On this computer only'}
          detail={auth.status === 'error' ? auth.message : auth.status === 'connecting' ? 'Finish signing in in your browser…' : 'Sign in with the Google account your phone uses.'}
          tone={auth.status === 'error' ? 'danger' : undefined}
        >
          <button type="button" className="accent-button" disabled={auth.status === 'connecting'} onClick={() => void signIn()}>
            {auth.status === 'error' ? 'Try again' : 'Sign in with Google'}
          </button>
        </Row>
      )}
      {managing && <AccountsDialog onClose={() => setManaging(false)} />}
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
      <Section title="Photos and recordings">
        <Row title="Shown in the Cairn desktop app" detail="A browser tab has nowhere to keep them." />
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
      title="Photos and recordings"
      note="Photos and recordings added on your phone are downloaded here so they show in your notes. When one is changed or deleted on the phone, the copy here follows. Only Cairn's own files in the folder are ever touched."
    >
      <Row title="Folder" detail={<span className="path">{media.folder}</span>}>
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

function ClassroomSection() {
  const files = useClassroomFiles()
  const { accounts, regrant, connectSource } = useCairn()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const note =
    'Pick the classes to save. Notes, slides and worksheets their teachers attach are saved to a folder per class: what is there now, then each new one as it is posted. Google Docs and Slides are saved as PDF. Nothing already in the folder is ever changed or deleted.'

  if (!files) {
    return (
      <Section title="Files from Classroom">
        <Row title="Saved by the Cairn desktop app" detail="A browser tab has nowhere to keep them." />
      </Section>
    )
  }

  const allow = (
    <Row title="Another account" detail="Such as your university's, if your classes are there.">
      <button type="button" className="button quiet-button" disabled={busy} onClick={() => void run(() => connectSource({ mail: false, classroom: true, files: true }))}>
        Connect…
      </button>
    </Row>
  )

  if (files.readers.length === 0) {
    return (
      <Section title="Files from Classroom" note={note}>
        {accounts.length === 0 && <Row title="Sign in first" detail="Sign in above with the Google account your classes are in." />}
        {accounts.map((account) => (
          <Row key={account.identity.sub} title={account.identity.email} detail="Google will ask you to let Cairn read files your classes share with this account.">
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void run(() => regrant(account, { ...featuresOf(account), classroom: true, files: true }))}
            >
              Allow
            </button>
          </Row>
        ))}
        {accounts.length > 0 && allow}
        {problem && <Row title="Not allowed" detail={problem} tone="danger" />}
      </Section>
    )
  }

  const picked = files.courses.filter((c) => c.selected).length
  const status = files.checking
    ? 'Checking Classroom…'
    : (files.error ??
      `${files.lastRun ? `Checked ${ago(files.lastRun)}` : picked ? 'First look in a few seconds' : 'Pick a class below to start'} · ${files.saved} ${files.saved === 1 ? 'file' : 'files'} saved${files.skipped ? ` · ${files.skipped} left out` : ''}`)
  const many = files.readers.length > 1

  return (
    <Section title="Files from Classroom" note={note}>
      <Row title="Folder" detail={<span className="path">{files.folder}</span>}>
        <button type="button" className="button" disabled={busy} onClick={() => void run(files.chooseFolder)}>
          Change…
        </button>
        <button type="button" className="button quiet-button" onClick={() => void files.openFolder()}>
          Open
        </button>
      </Row>
      {!files.isDefault && (
        <Row title="Use the default folder" detail="Cairn Classroom in your Documents. Files already saved stay where they are.">
          <button type="button" className="button quiet-button" disabled={busy} onClick={() => void run(files.useDefaultFolder)}>
            Use default
          </button>
        </Row>
      )}
      <Row title="Status" detail={status} tone={files.error ? 'danger' : undefined}>
        <button type="button" className="button quiet-button" disabled={files.checking} onClick={() => void files.checkNow()}>
          {picked ? 'Check now' : 'Refresh'}
        </button>
      </Row>
      {files.loadingCourses && <Row title="Your classes" detail="Asking Classroom…" />}
      {!files.loadingCourses && files.courses.length === 0 && (
        <Row title="No classes" detail="Classroom shows no classes you have joined as a student." />
      )}
      {files.courses.map((course) => (
        <Row
          key={course.id}
          title={course.name}
          detail={[course.section, many ? course.account : null, course.selected ? `${course.saved} ${course.saved === 1 ? 'file' : 'files'} saved` : null]
            .filter(Boolean)
            .join(' · ') || undefined}
        >
          <Switch on={course.selected} label={`Save files from ${course.name}`} onChange={(on) => void run(() => files.setCourse(course.id, on))} />
        </Row>
      ))}
      {allow}
      {problem && <Row title="Not allowed" detail={problem} tone="danger" />}
    </Section>
  )
}

function ago(t: number): string {
  const minutes = Math.round((Date.now() - t) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function BinSection() {
  const { notes } = useCairn()
  const actions = useActions()
  const bin = recycleBin(useObserved(notes, WITH_DELETED), Date.now())
  return (
    <Section
      title="Recycle bin"
      note="Deleted notes stay here for 30 days, then they are deleted for good, from every device and with their photos and recordings."
    >
      {bin.length === 0 && <Row title="Empty" detail="Notes you delete show up here." />}
      {bin.map(({ note, daysLeft }) => (
        <Row key={note.id} title={noteHeading(note)} detail={binCountdown(daysLeft)} tone={daysLeft <= 3 ? 'danger' : undefined}>
          <button type="button" className="button" onClick={() => void actions.restoreNote(note)}>
            Restore
          </button>
        </Row>
      ))}
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
            ? 'On. Cairn alerts you when things are due.'
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
        <Row title="Start with Windows" detail="Opens quietly as the widget when you log in.">
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

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (next: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="switch-knob" />
    </button>
  )
}

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
