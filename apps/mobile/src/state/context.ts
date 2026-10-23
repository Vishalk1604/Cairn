import {
  openLocalRepositories,
  openSyncedRepositories,
  replicate,
  signInToFirebase,
  type NoteRepository,
  type ReminderRepository,
} from '@cairn/sync'
import { accessTokenFor, owner, type Account, type Platform, type SourceFeatures } from '@cairn/ui'
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

export interface Cairn {
  platform: Platform
  /** Stamped on everything created; the Firebase uid once signed in. */
  userId: string
  /** Always this device's own store — see replicate() for why. */
  reminders: ReminderRepository
  notes: NoteRepository
  auth: AuthState
  accounts: Account[]
  signIn(): Promise<void>
  signOut(): Promise<void>
  connectSource(features: SourceFeatures): Promise<void>
  /** Asks Google for more permission; returns the accounts as they now stand. */
  regrant(account: Account, features: SourceFeatures): Promise<Account[]>
  disconnectSource(sub: string): Promise<void>
}

export interface LocalStore {
  reminders: ReminderRepository
  notes: NoteRepository
}

export async function openLocal(): Promise<LocalStore> {
  const { reminders, notes } = await openLocalRepositories(storage, {
    onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
  })
  const now = Date.now()
  await Promise.all([reminders.purgeTombstones(now), notes.purgeTombstones(now)])
  return { reminders, notes }
}

/** What a running sync needs to be told to stop. */
export interface Sync {
  uid: string
  stop(): void
}

/**
 * Signs the owner account into Firebase and starts copying both ways.
 *
 * The phone's own store stays the one the app reads and writes; this only
 * keeps the cloud in step with it. So signing in never empties the screen
 * while the network is consulted, and work done offline is never at the
 * mercy of an in-memory cache.
 */
export async function startSync(local: LocalStore, accounts: readonly Account[], platform: Platform): Promise<Sync> {
  const holder = owner(accounts)
  if (!holder) throw new Error('No account holds the data yet')
  const tokens = await accessTokenFor(platform, holder)
  if (!tokens.idToken) throw new Error('Google did not confirm who you are')
  const uid = await signInToFirebase(tokens.idToken)
  const synced = await openSyncedRepositories(uid, (error) => console.error('Sync problem', error))
  const stops = [
    replicate(local.notes, synced.notes, { includeDeleted: true }, uid),
    replicate(local.reminders, synced.reminders, { includeDeleted: true }, uid),
  ]
  return {
    uid,
    stop() {
      for (const stop of stops) stop()
      synced.close()
    },
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
