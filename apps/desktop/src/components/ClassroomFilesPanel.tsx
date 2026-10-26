import { featuresOf, formatAgo } from '@cairn/ui'
import { useState } from 'react'
import { useClassroomFiles } from '../app/classroomFiles'
import { useCairn } from '../app/context'
import { Row, Section, Switch } from './SettingsParts'

/**
 * Saving the files teachers attach to a folder on this computer: which
 * folder, and which classes. Lives behind the gear in the Classroom tab.
 */
export function ClassroomFilesPanel() {
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
        {accounts.length === 0 && <Row title="Sign in first" detail="Sign in from Settings with the Google account your classes are in." />}
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
      `${files.lastRun ? `Checked ${formatAgo(files.lastRun, Date.now())}` : picked ? 'First look in a few seconds' : 'Pick a class below to start'} · ${files.saved} ${files.saved === 1 ? 'file' : 'files'} saved${files.skipped ? ` · ${files.skipped} left out` : ''}`)
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

