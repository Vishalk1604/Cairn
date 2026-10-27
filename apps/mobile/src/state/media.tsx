import { updateNote, type Attachment, type Note } from '@cairn/core'
import { driveDownloadUrl, GoogleApiError, setDriveTrashed, startDriveUpload, type NoteQuery } from '@cairn/sync'
import { planDriveTrash } from '@cairn/ui'
import { File, UploadTask, UploadType } from 'expo-file-system'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { attachmentFile, hasLocalCopy } from '../platform/media'
import { storage } from '../platform/storage'
import { useCairn } from './context'
import { useObserved } from './hooks'

/** The recycle bin too: a note in it is what sends its files to Drive's trash. */
const EVERYTHING: NoteQuery = { includeDeleted: true }
/** Attachment id → Drive file id, for every file this phone has already sent. */
const UPLOADED_KEY = 'cairn.media.uploaded'
/** Drive file ids this phone has moved to Drive's trash. */
const TRASHED_KEY = 'cairn.media.trashed'

/** Bumped whenever a file lands, so anything showing media looks again. */
const MediaVersion = createContext(0)

export function useMediaVersion(): number {
  return useContext(MediaVersion)
}

/**
 * Moves attachment files between this phone and the owner's Drive while
 * signed in: up for anything made here, down for anything made elsewhere.
 * A note moved to the recycle bin sends its files to Drive's trash, and
 * restoring it brings them back; Drive empties its trash after thirty days,
 * when the note itself is deleted for good.
 *
 * Which files have gone up is also remembered locally. An editor open at the
 * moment an upload finishes can save over the note without the new Drive id;
 * the record here means the next pass simply writes the id back instead of
 * sending the same photo again.
 */
export function MediaSync({ children }: { children: ReactNode }) {
  const { notes, email, worker, auth } = useCairn()
  const all = useObserved(notes, EVERYTHING)
  const [version, setVersion] = useState(0)
  const running = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (auth.status !== 'synced' || !email) return

    const pass = async () => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        do {
          again.current = false
          // A token for Cairn's own Drive files and nothing else, from the Worker.
          const { accessToken } = await worker.token(email, 'drive')
          const uploaded = parseMap(await storage.get(UPLOADED_KEY))
          let landed = false

          for (const note of all.filter((n) => n.deletedAt === undefined)) {
            const fixed: Attachment[] = []
            let changed = false
            for (const a of note.attachments ?? []) {
              let driveFileId = a.driveFileId ?? uploaded[a.id]
              if (!driveFileId && hasLocalCopy(a)) {
                driveFileId = await upload(accessToken, a)
                uploaded[a.id] = driveFileId
                await storage.set(UPLOADED_KEY, JSON.stringify(uploaded))
              }
              if (driveFileId && !hasLocalCopy(a)) {
                await File.downloadFileAsync(driveDownloadUrl(driveFileId), attachmentFile(a), {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  idempotent: true,
                })
                landed = true
              }
              if (driveFileId !== a.driveFileId) changed = true
              fixed.push(driveFileId ? { ...a, driveFileId } : a)
            }
            if (changed) await notes.upsert(updateNote(note as Note, { attachments: fixed }, Date.now()))
          }
          if (landed) setVersion((v) => v + 1)
          await followBin(accessToken, all, uploaded)
        } while (again.current)
      } catch (error) {
        // Offline, or Drive is unavailable: the files wait for the next pass.
        console.warn('Media sync paused', error)
      } finally {
        running.current = false
      }
    }

    // Edits come in bursts while typing; wait for a pause before looking.
    const timer = setTimeout(() => void pass(), 1500)
    return () => clearTimeout(timer)
  }, [all, email, worker, auth.status, notes])

  return <MediaVersion.Provider value={version}>{children}</MediaVersion.Provider>
}

/** Puts the Drive files of binned notes in Drive's trash, and takes restored ones back out. */
async function followBin(accessToken: string, notes: readonly Note[], uploaded: Record<string, string>): Promise<void> {
  const trashed = new Set(parseList(await storage.get(TRASHED_KEY)))
  const plan = planDriveTrash(notes, uploaded, trashed)
  if (!plan.trash.length && !plan.restore.length && !plan.forget.length) return
  for (const [files, trash] of [
    [plan.trash, true],
    [plan.restore, false],
  ] as const) {
    for (const file of files) {
      try {
        await setDriveTrashed(accessToken, file, trash)
      } catch (error) {
        // Already gone from Drive means nothing is left to trash or bring back; anything else is tried again later.
        if (!(error instanceof GoogleApiError && error.status === 404)) {
          console.warn('Drive would not move', file, error)
          continue
        }
      }
      if (trash) trashed.add(file)
      else trashed.delete(file)
    }
  }
  for (const file of plan.forget) {
    trashed.delete(file)
    for (const [id, sent] of Object.entries(uploaded)) if (sent === file) delete uploaded[id]
  }
  await storage.set(TRASHED_KEY, JSON.stringify([...trashed]))
  await storage.set(UPLOADED_KEY, JSON.stringify(uploaded))
}

async function upload(accessToken: string, a: Attachment): Promise<string> {
  const file = attachmentFile(a)
  const session = await startDriveUpload(accessToken, { name: file.name, mime: a.mime, bytes: file.size })
  const result = await new UploadTask(file, session, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': a.mime },
  }).uploadAsync()
  if (result.status < 200 || result.status >= 300) throw new Error(`Drive refused the upload (${result.status})`)
  const id = (JSON.parse(result.body) as { id?: string }).id
  if (!id) throw new Error('Drive did not say where it put the file')
  return id
}

function parseList(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function parseMap(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
