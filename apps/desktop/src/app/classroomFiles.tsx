import { classroomCourses, classroomFiles, driveFetch, driveFileInfo, GoogleApiError, type Course } from '@cairn/sync'
import {
  accessTokenFor,
  classroomDownload,
  classroomFilePath,
  featuresOf,
  newClassroomFiles,
  readClassroomFilesState,
  recentCoursesFirst,
  type Account,
  type ClassroomFilesState,
} from '@cairn/ui'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCairn } from './context'

const STATE_KEY = 'cairn.classroomFiles'
/** Teachers post a few times a day at most; a look every quarter hour costs a handful of requests. */
const EVERY_MS = 15 * 60 * 1000
/** After opening, once the window has settled. */
const FIRST_LOOK_MS = 10_000

/** A class the person is in, and whether its files are being saved. */
export interface ClassroomCourse {
  id: string
  name: string
  section?: string
  /** The account it was joined with. */
  account: string
  selected: boolean
  /** Files from it saved so far. */
  saved: number
}

export interface ClassroomFiles {
  /** Accounts allowed to download class files. */
  readers: Account[]
  folder: string
  isDefault: boolean
  /** Every class joined, newest first. */
  courses: ClassroomCourse[]
  /** True until the list of classes has come back once. */
  loadingCourses: boolean
  /** Files saved so far, and files left out for good. */
  saved: number
  skipped: number
  checking: boolean
  lastRun: number | null
  error: string | null
  /** Starts or stops saving one class's files. Starting fetches what it already has, too. */
  setCourse(id: string, selected: boolean): Promise<void>
  chooseFolder(): Promise<void>
  useDefaultFolder(): Promise<void>
  openFolder(): Promise<void>
  /** Looks at Classroom again: the list of classes, and new files in the chosen ones. */
  checkNow(): Promise<void>
}

const Context = createContext<ClassroomFiles | null>(null)

/** Null in a browser, which has no folder to save into. */
export function useClassroomFiles(): ClassroomFiles | null {
  return useContext(Context)
}

/** Why a file can never be fetched, as opposed to not this time. */
function permanent(error: unknown): string | null {
  if (!(error instanceof GoogleApiError) || error.missingScope || error.rateLimited) return null
  if (error.status === 404) return 'No longer shared with you'
  if (error.status === 403) return /export/i.test(error.reason + error.message) ? 'Too big for Google to convert' : 'Not shared with you'
  return null
}

function describe(account: Account, error: unknown): string {
  const text =
    error instanceof GoogleApiError && error.missingScope
      ? 'Google no longer lets Cairn read these files. Allow it again below.'
      : error instanceof Error
        ? error.message
        : String(error)
  return `${account.identity.email}: ${text}`
}

/**
 * Keeps the Classroom folder holding every file teachers attach — to an
 * assignment, an announcement or a plain material — in the classes the
 * person picked, a folder per class. Nothing is downloaded until a class is
 * picked, so a semester's worth never arrives at once. Each file is fetched
 * once: deleting or moving it afterwards is the person's business, and it is
 * never fetched again or overwritten.
 */
export function ClassroomFilesProvider({ children }: { children: ReactNode }) {
  const { platform, accounts } = useCairn()
  const classroom = platform.classroom
  const [state, setState] = useState<ClassroomFilesState | null>(null)
  const [fallback, setFallback] = useState<string | null>(null)
  const [joined, setJoined] = useState<{ account: Account; course: Course }[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef<ClassroomFilesState | null>(null)
  latest.current = state
  const busy = useRef(false)
  const again = useRef(false)

  const readers = useMemo(() => accounts.filter((a) => featuresOf(a).files), [accounts])
  const folder = state?.folder || fallback

  useEffect(() => {
    if (!classroom) return
    void (async () => {
      setFallback(await classroom.defaultFolder())
      setState(readClassroomFilesState(await platform.storage.get(STATE_KEY)))
    })()
  }, [classroom, platform])

  const keep = useCallback(
    async (next: ClassroomFilesState) => {
      latest.current = next
      setState(next)
      await platform.storage.set(STATE_KEY, JSON.stringify(next))
    },
    [platform],
  )

  /** Every class each account is in. One request per account. */
  const loadCourses = useCallback(async () => {
    const found: { account: Account; course: Course }[] = []
    const problems: string[] = []
    for (const account of readers) {
      try {
        const { accessToken } = await accessTokenFor(platform, account)
        for (const course of await classroomCourses(accessToken)) found.push({ account, course })
      } catch (e) {
        problems.push(describe(account, e))
      }
    }
    setJoined(found)
    return { found, problems }
  }, [readers, platform])

  const look = useCallback(async () => {
    if (!classroom || !folder || readers.length === 0) return
    // A class picked while files are coming down is looked at straight after.
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    setChecking(true)
    try {
      const { found, problems } = await loadCourses()
      const current = latest.current
      if (!current) return
      const next: ClassroomFilesState = { ...current, files: { ...current.files } }
      const saved: { course: string; path: string }[] = []
      for (const account of readers) {
        const chosen = found.filter((j) => j.account === account && current.courses.includes(j.course.id)).map((j) => j.course)
        if (chosen.length === 0) continue
        try {
          const { accessToken } = await accessTokenFor(platform, account)
          const { files } = await classroomFiles(accessToken, chosen)
          for (const item of newClassroomFiles(files, next)) {
            try {
              const plan = classroomDownload(await driveFileInfo(accessToken, item.file.id))
              if ('skip' in plan) {
                next.files[item.file.id] = { course: item.course.id, skipped: plan.skip, at: Date.now() }
              } else {
                const bytes = await driveFetch(accessToken, item.file.id, plan.exportAs)
                const path = await classroom.write(folder, classroomFilePath(item.course.name, plan.name), bytes)
                next.files[item.file.id] = { course: item.course.id, path, at: Date.now() }
                saved.push({ course: item.course.name, path })
              }
            } catch (e) {
              const why = permanent(e)
              if (!why) throw e
              next.files[item.file.id] = { course: item.course.id, skipped: why, at: Date.now() }
            }
            // Written after every file, so quitting midway never fetches one twice.
            await keep({ ...(latest.current ?? next), files: { ...next.files } })
          }
        } catch (e) {
          problems.push(describe(account, e))
        }
      }
      // The choice of classes may have changed while files were coming down; keep it.
      await keep({ ...(latest.current ?? next), files: next.files })
      setError(problems.length ? problems.join('\n') : null)
      setLastRun(Date.now())
      if (saved.length) {
        const first = saved[0]!
        const courseDir = first.path.split('/')[0]!
        void platform.notify({
          title: saved.length === 1 ? 'New file from Classroom' : `${saved.length} new files from Classroom`,
          body: saved.length === 1 ? `${first.course}: ${first.path.split('/').pop()}` : saved.slice(0, 3).map((s) => s.path.split('/').pop()).join(' · '),
          tag: 'classroom-files',
          onClick: () => void classroom.open(saved.length === 1 ? `${folder}\\${courseDir}` : folder),
        })
      }
    } finally {
      busy.current = false
      setChecking(false)
      if (again.current) {
        again.current = false
        setTimeout(() => void lookRef.current(), 0)
      }
    }
  }, [classroom, folder, readers, platform, keep, loadCourses])

  const lookRef = useRef(look)
  lookRef.current = look

  // The list of classes as soon as an account may read them, so they can be picked.
  useEffect(() => {
    if (!classroom || readers.length === 0) return
    void loadCourses().then(({ problems }) => setError(problems.length ? problems.join('\n') : null))
  }, [classroom, readers, loadCourses])

  // With a class picked: a look shortly after opening, then every quarter hour while Cairn runs in the tray.
  const picked = (state?.courses.length ?? 0) > 0
  useEffect(() => {
    if (!picked || readers.length === 0) return
    const first = setTimeout(() => void lookRef.current(), FIRST_LOOK_MS)
    const timer = setInterval(() => void lookRef.current(), EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [picked, readers.length])

  const value = useMemo<ClassroomFiles | null>(() => {
    if (!classroom || !state || !folder) return null
    const records = Object.values(state.files)
    const courses = recentCoursesFirst(joined?.map((j) => ({ ...j.course, account: j.account.identity.email })) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      section: c.section,
      account: c.account,
      selected: state.courses.includes(c.id),
      saved: records.filter((r) => r.course === c.id && r.path).length,
    }))
    return {
      readers,
      folder,
      isDefault: !state.folder,
      courses,
      loadingCourses: readers.length > 0 && joined === null,
      saved: records.filter((r) => r.path).length,
      skipped: records.filter((r) => r.skipped).length,
      checking,
      lastRun,
      error,
      async setCourse(id, selected) {
        const current = latest.current ?? state
        const chosen = selected ? [...new Set([...current.courses, id])] : current.courses.filter((c) => c !== id)
        await keep({ ...current, courses: chosen })
        if (selected) setTimeout(() => void lookRef.current(), 0)
      },
      async chooseFolder() {
        const pickedFolder = await classroom.pickFolder(folder)
        // Files already saved stay where they are; only new ones go to the new folder.
        if (pickedFolder) await keep({ ...(latest.current ?? state), folder: pickedFolder === fallback ? '' : pickedFolder })
      },
      async useDefaultFolder() {
        await keep({ ...(latest.current ?? state), folder: '' })
      },
      async openFolder() {
        await classroom.open(folder)
      },
      async checkNow() {
        await lookRef.current()
      },
    }
  }, [classroom, state, folder, fallback, joined, readers, checking, lastRun, error, keep])

  return <Context.Provider value={value}>{children}</Context.Provider>
}
