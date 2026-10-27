import {
  openLocalRepositories,
  openSyncedRepositories,
  replicate,
  type AiSetup,
  type NoteRepository,
  type ReminderRepository,
  type Want,
  type WorkerAccount,
  type WorkerClient,
} from '@cairn/sync'
import type { Platform } from '@cairn/ui'
import { createContext, useContext } from 'react'
import { storage } from '../platform/storage'

/** Signed out, everything belongs to this device's own user. */
export const LOCAL_USER = 'local'

export type AuthState =
  | { status: 'loading' }
  /** Signed out. Everything works; nothing leaves the phone. */
  | { status: 'local' }
  | { status: 'connecting' }
  | { status: 'synced'; email: string }
  | { status: 'error'; message: string }

/** Notes and tasks reaching the cloud: whether a sync is under way, and when one last finished. */
export interface SyncStatus {
  busy: boolean
  at: number | null
  /** Pulls everything afresh from the cloud and sends anything not yet there. */
  run(): Promise<void>
}

export interface Cairn {
  platform: Platform
  /** Cairn's Worker, which holds the Google accounts and reads them. */
  worker: WorkerClient
  /** Stamped on everything created; the Firebase uid once signed in. */
  userId: string
  /** Always this device's own store — see replicate() for why. */
  reminders: ReminderRepository
  notes: NoteRepository
  auth: AuthState
  /** The Google account signed in with, which holds the notes. */
  email: string | null
  /** Signs in with the personal Google account, through the Worker. */
  signIn(): Promise<void>
  signOut(): Promise<void>
  /** Connects another Google account, such as a college one, to read Gmail and Classroom from. */
  addAccount(): Promise<void>
  /** Asks Google for more for an account already connected; Google shows only what is new. */
  grant(email: string, want: readonly Want[]): Promise<void>
  /** What the Worker reads from an account. */
  watch(email: string, watch: Partial<WorkerAccount['watch']>): Promise<void>
  /** Forgets a read-only account, on the Worker too. */
  disconnect(email: string): Promise<void>
  /** Stops every check, gives every permission back to Google and deletes what the Worker holds. */
  forgetServer(): Promise<void>
  /** The NVIDIA key: kept in this phone's secure storage and sent to the Worker, never to Firestore. */
  ai: { setup: AiSetup | null; save(setup: AiSetup | null): Promise<void> }
  sync: SyncStatus
}

export interface LocalStore {
  reminders: ReminderRepository
  notes: NoteRepository
}

let opened: Promise<LocalStore> | null = null

/**
 * The phone's own store, opened once per process. The home-screen widget
 * runs in the same JavaScript as the app when the app is alive, and two
 * copies of the store would each save over what the other wrote.
 */
export function openLocal(): Promise<LocalStore> {
  opened ??= (async () => {
    const { reminders, notes } = await openLocalRepositories(storage, {
      onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
    })
    const now = Date.now()
    await Promise.all([reminders.purgeTombstones(now), notes.purgeTombstones(now)])
    return { reminders, notes }
  })().catch((error: unknown) => {
    opened = null
    throw error
  })
  return opened
}

/** What a running sync needs to be told to stop. */
export interface Sync {
  uid: string
  /** Resolves once the cloud has answered for both notes and tasks. */
  ready: Promise<void>
  stop(): void
}

/**
 * Starts copying both ways for the signed-in person.
 *
 * The phone's own store stays the one the app reads and writes; this only
 * keeps the cloud in step with it. So signing in never empties the screen
 * while the network is consulted, and work done offline is never at the
 * mercy of an in-memory cache.
 */
export async function startSync(local: LocalStore, uid: string): Promise<Sync> {
  const synced = await openSyncedRepositories(uid, (error) => console.error('Sync problem', error))
  const stops = [
    replicate(local.notes, synced.notes, { includeDeleted: true }, uid),
    replicate(local.reminders, synced.reminders, { includeDeleted: true }, uid),
  ]
  void purgeExpired(synced)
  const sync: Sync = {
    uid,
    ready: Promise.all([synced.notes.serverSynced(), synced.reminders.serverSynced()]).then(() => {}),
    stop() {
      for (const stop of stops) stop()
      synced.close()
      if (running === sync) running = null
    },
  }
  running = sync
  return sync
}

let running: Sync | null = null

/** The sync under way in this process, if any: the app's, or one the widget started to send a tick up. */
export function runningSync(): Sync | null {
  return running
}

/**
 * Deletes for good what has sat in the recycle bin for thirty days, from the
 * cloud as well as here. Run once the server has answered, so the whole
 * collection is known, not just what was cached.
 */
async function purgeExpired(synced: Awaited<ReturnType<typeof openSyncedRepositories>>): Promise<void> {
  try {
    await Promise.all([synced.notes.serverSynced(), synced.reminders.serverSynced()])
    const now = Date.now()
    await Promise.all([synced.notes.purgeTombstones(now), synced.reminders.purgeTombstones(now)])
  } catch (error) {
    console.error('Could not empty the recycle bin', error)
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnContext provider')
  return cairn
}
