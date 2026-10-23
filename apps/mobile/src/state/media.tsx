import { updateNote, type Attachment, type Note } from '@cairn/core'
import { driveDownloadUrl, startDriveUpload, type NoteQuery } from '@cairn/sync'
import { accessTokenFor, owner } from '@cairn/ui'
import { File, UploadTask, UploadType } from 'expo-file-system'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { attachmentFile, hasLocalCopy } from '../platform/media'
import { storage } from '../platform/storage'
import { useCairn } from './context'
import { useObserved } from './hooks'

const EVERYTHING: NoteQuery = {}
/** Attachment id → Drive file id, for every file this phone has already sent. */
const UPLOADED_KEY = 'cairn.media.uploaded'

/** Bumped whenever a file lands, so anything showing media looks again. */
const MediaVersion = createContext(0)

export function useMediaVersion(): number {
  return useContext(MediaVersion)
}

/**
 * Moves attachment files between this phone and the owner's Drive while
 * signed in: up for anything made here, down for anything made elsewhere.
 *
 * Which files have gone up is also remembered locally. An editor open at the
 * moment an upload finishes can save over the note without the new Drive id;
 * the record here means the next pass simply writes the id back instead of
 * sending the same photo again.
 */
export function MediaSync({ children }: { children: ReactNode }) {
  const { notes, accounts, platform, auth } = useCairn()
  const all = useObserved(notes, EVERYTHING)
  const [version, setVersion] = useState(0)
  const running = useRef(false)
  const again = useRef(false)

  useEffect(() => {
    if (auth.status !== 'synced') return
    const holder = owner(accounts)
    if (!holder) return

    const pass = async () => {
      if (running.current) {
        again.current = true
        return
      }
      running.current = true
      try {
        do {
          again.current = false
          const { accessToken } = await accessTokenFor(platform, holder)
          const uploaded = parseMap(await storage.get(UPLOADED_KEY))
          let landed = false

          for (const note of all) {
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
  }, [all, accounts, platform, auth.status, notes])

  return <MediaVersion.Provider value={version}>{children}</MediaVersion.Provider>
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

function parseMap(raw: string | null): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}')
    return value && typeof value === 'object' ? (value as Record<string, string>) : {}
  } catch {
    return {}
  }
}
