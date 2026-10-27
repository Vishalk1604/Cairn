import { attachmentFileName, type Attachment } from '@cairn/core'
import { driveDownload, GoogleApiError, WorkerError, type NoteQuery } from '@cairn/sync'
import { planMediaSync, type LocalMediaFile } from '@cairn/ui'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useCairn } from './context'
import { useObserved } from './hooks'

/** Empty means the default folder, so moving the app data folder moves media with it. */
const FOLDER_KEY = 'cairn.mediaFolder'
const EVERYTHING: NoteQuery = { includeDeleted: true }
/** Two at a time: quick enough, and gentle on a slow connection. */
const AT_ONCE = 2
/** Lets a burst of edits from the phone settle into one pass. */
const SETTLE_MS = 1500
const RETRY_MS = 60_000

export interface MediaFolder {
  folder: string
  isDefault: boolean
  files: number
  bytes: number
  /** Files still to fetch in the pass under way. */
  fetching: number
  error: string | null
  /** Whether files can be fetched at all: it takes the account that holds the notes. */
  signedIn: boolean
  chooseFolder(): Promise<void>
  useDefaultFolder(): Promise<void>
  openFolder(): Promise<void>
}

interface Media extends MediaFolder {
  /** Bumped whenever the files on disk change, so anything showing media looks again. */
  version: number
  /** The file as a URL the page can show, or null when it is not on disk (yet). */
  urlFor(a: Attachment): Promise<string | null>
}

const Context = createContext<Media | null>(null)

/** Null in a browser, which has no folder to keep files in. */
export function useMediaFolder(): MediaFolder | null {
  return useContext(Context)
}

/** A photo or recording ready to show, once it is on disk. */
export function useMediaUrl(attachment: Attachment | undefined): string | null {
  const media = useContext(Context)
  const [url, setUrl] = useState<string | null>(null)
  const urlFor = media?.urlFor
  const version = media?.version
  useEffect(() => {
    if (!urlFor || !attachment) {
      setUrl(null)
      return
    }
    let live = true
    void urlFor(attachment).then((found) => {
      if (live) setUrl(found)
    })
    return () => {
      live = false
    }
  }, [urlFor, version, attachment])
  return url
}

/**
 * Keeps the media folder holding exactly what notes point at: fetches from
 * the owner's Drive whatever a phone added, and clears whatever was removed
 * or deleted there. Nothing is cleared until the server has answered, so a
 * slow start can never look like every note was emptied.
 */
export function MediaProvider({ children }: { children: ReactNode }) {
  const { platform, notes, auth, email, worker } = useCairn()
  const media = platform.media
  const all = useObserved(notes, EVERYTHING)
  const [fallback, setFallback] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [present, setPresent] = useState<LocalMediaFile[]>([])
  const [fetching, setFetching] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [retry, setRetry] = useState(0)
  const urls = useRef(new Map<string, Promise<string | null>>())
  const onDisk = useRef(new Set<string>())
  const running = useRef(false)
  const again = useRef(false)

  const folder = chosen || fallback
  const signedIn = auth.status === 'synced' && email !== null

  useEffect(() => {
    if (!media) return
    void (async () => {
      setFallback(await media.defaultFolder())
      setChosen(await platform.storage.get(FOLDER_KEY))
    })()
  }, [media, platform])

  const forget = useCallback((name: string) => {
    const cached = urls.current.get(name)
    urls.current.delete(name)
    void cached?.then((url) => url && URL.revokeObjectURL(url))
  }, [])

  useEffect(
    () => () => {
      for (const name of [...urls.current.keys()]) forget(name)
    },
    [forget],
  )

  /** Reads what is on disk, and tells anything showing media when that changed. */
  const look = useCallback(
    async (dir: string) => {
      if (!media) return []
      const files = await media.list(dir)
      const names = new Set(files.map((f) => f.name))
      const changed = names.size !== onDisk.current.size || [...names].some((n) => !onDisk.current.has(n))
      onDisk.current = names
      setPresent(files)
      if (changed) setVersion((v) => v + 1)
      return files
    },
    [media],
  )

  useEffect(() => {
    if (!media || !folder) return
    const pass = async () => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        do {
          again.current = false
          const files = await look(folder)
          if (!signedIn || !email) break
          await notes.serverSynced?.()
          const plan = planMediaSync(await notes.list({ includeDeleted: true }), files)
          for (const name of plan.remove) {
            await media.remove(folder, name)
            forget(name)
          }
          let failed = 0
          let why: unknown = null
          if (plan.download.length) {
            setFetching(plan.download.length)
            // A token for Cairn's own Drive files and nothing else, from the Worker.
            const { accessToken } = await worker.token(email, 'drive')
            await eachLimit(plan.download, AT_ONCE, async (a) => {
              try {
                const bytes = await driveDownload(accessToken, a.driveFileId!)
                const name = attachmentFileName(a)
                await media.write(folder, name, bytes)
                forget(name)
              } catch (e) {
                failed++
                why ??= e
                console.error('Could not fetch', a.driveFileId, e)
              } finally {
                setFetching((n) => Math.max(0, n - 1))
              }
            })
          }
          setError(failed ? `${failed} ${failed === 1 ? 'file' : 'files'} could not be fetched from Drive: ${fetchProblem(why)} Cairn will try again.` : null)
          if (failed) setTimeout(() => setRetry((r) => r + 1), RETRY_MS)
          if (plan.remove.length || plan.download.length) await look(folder)
        } while (again.current)
      } catch (e) {
        setError(e instanceof WorkerError && e.needsConsent ? 'Cairn was not allowed into your Drive. Sign out and sign in again, and tick the Drive box.' : e instanceof Error ? e.message : String(e))
      } finally {
        running.current = false
        setFetching(0)
      }
    }
    const timer = setTimeout(() => void pass(), SETTLE_MS)
    return () => clearTimeout(timer)
  }, [media, folder, all, signedIn, email, worker, notes, look, forget, retry])

  const urlFor = useCallback(
    (a: Attachment): Promise<string | null> => {
      const name = attachmentFileName(a)
      if (!media || !folder || !onDisk.current.has(name)) return Promise.resolve(null)
      let cached = urls.current.get(name)
      if (!cached) {
        cached = media
          .read(folder, name)
          .then((bytes) => URL.createObjectURL(new Blob([bytes], { type: a.mime })))
          .catch(() => null)
        urls.current.set(name, cached)
      }
      return cached
    },
    [media, folder],
  )

  const moveTo = useCallback(
    async (next: string, remember: string) => {
      if (!media || !folder) return
      setError(null)
      try {
        if (next !== folder) await media.move(folder, next)
        await platform.storage.set(FOLDER_KEY, remember)
        for (const name of [...urls.current.keys()]) forget(name)
        onDisk.current = new Set()
        setChosen(remember)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [media, folder, platform, forget],
  )

  const value = useMemo<Media | null>(() => {
    if (!media || !folder) return null
    return {
      folder,
      isDefault: folder === fallback,
      files: present.length,
      bytes: present.reduce((sum, f) => sum + f.bytes, 0),
      fetching,
      error,
      signedIn,
      version,
      urlFor,
      async chooseFolder() {
        const picked = await media.pickFolder(folder)
        if (picked) await moveTo(picked, picked)
      },
      async useDefaultFolder() {
        if (fallback) await moveTo(fallback, '')
      },
      async openFolder() {
        await media.open(folder)
      },
    }
  }, [media, folder, fallback, present, fetching, error, signedIn, version, urlFor, moveTo])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

/** Why a download failed, in words that say what to do about it. */
function fetchProblem(error: unknown): string {
  if (error instanceof GoogleApiError) {
    if (error.status === 401 || error.missingScope) return 'Drive refused this sign-in. Sign out and sign in again, and tick the Drive box.'
    if (error.status === 404) return 'Drive could not find it. It may still be uploading from your phone, or it was deleted there.'
    return `${error.message} (${error.status}).`
  }
  const text = error instanceof Error ? error.message : String(error)
  return /fetch|network|load/i.test(text) ? `Drive could not be reached (${text}).` : `${text}.`
}

async function eachLimit<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lane = async () => {
    while (next < items.length) await work(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane))
}
