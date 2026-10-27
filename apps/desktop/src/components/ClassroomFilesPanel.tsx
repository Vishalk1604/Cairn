import { formatAgo } from '@cairn/ui'
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
  const { auth } = useCairn()
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setProblem(null)
    try {
      await work()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
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

  /**
   * Accounts reading Classroom that have not let Cairn read their class
   * files yet. Google asks in the browser for exactly that — Drive and
   * Classroom materials, read only — and nothing else changes.
   */
  const allow = files.waiting.map((account) => (
    <Row
      key={account.email}
      title={account.email}
      detail="Google will ask, in your browser, to let Cairn read the files your classes share with this account."
    >
      <button type="button" className="button" disabled={busy !== null} onClick={() => void run(account.email, () => files.allow(account.email))}>
        {busy === account.email ? 'Waiting for your browser…' : 'Allow…'}
      </button>
    </Row>
  ))

  if (files.readers.length === 0) {
    return (
      <Section title="Files from Classroom" note={note}>
        {auth.status !== 'synced' && <Row title="Sign in first" detail="Sign in from Settings with the account you set Cairn up with on your phone." />}
        {auth.status === 'synced' && files.waiting.length === 0 && (
          <Row title="No Classroom account yet" detail="Add your college account and choose Classroom in Cairn on your phone first." />
        )}
        {allow}
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
        <button type="button" className="button" disabled={busy !== null} onClick={() => void run('folder', files.chooseFolder)}>
          Change…
        </button>
        <button type="button" className="button quiet-button" onClick={() => void files.openFolder()}>
          Open
        </button>
      </Row>
      {!files.isDefault && (
        <Row title="Use the default folder" detail="Cairn Classroom in your Documents. Files already saved stay where they are.">
          <button type="button" className="button quiet-button" disabled={busy !== null} onClick={() => void run('folder', files.useDefaultFolder)}>
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
          <Switch on={course.selected} label={`Save files from ${course.name}`} onChange={(on) => void run(course.id, () => files.setCourse(course.id, on))} />
        </Row>
      ))}
      {allow}
      {problem && <Row title="Not allowed" detail={problem} tone="danger" />}
    </Section>
  )
}

