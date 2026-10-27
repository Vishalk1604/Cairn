import type { Entity } from '@cairn/core'
import {
  currentUser,
  openLocalRepositories,
  openSyncedRepositories,
  settled,
  signInToFirebase,
  signOutOfFirebase,
  type NoteRepository,
  type ReminderRepository,
  type Repository,
  type Want,
} from '@cairn/sync'
import { consentThroughWorker, LEGACY_ACCOUNTS_KEY } from '@cairn/ui'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DesktopPlatform } from '../platform'
import { CairnContext, type Cairn } from './context'
import { worker } from './worker'

export type AuthState =
  | { status: 'loading' }
  /** Signed out. Everything works; nothing leaves this machine. */
  | { status: 'local' }
  | { status: 'connecting' }
  | { status: 'synced' }
  | { status: 'error'; message: string }

interface Store {
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
  close?: () => void
}

/** Shown in a browser with ?preview: signed in as a stand-in, with nothing leaving the page. See preview.ts. */
export interface Preview {
  email: string
  seed?(store: { reminders: ReminderRepository; notes: NoteRepository }): Promise<void>
}

/**
 * Who this computer is signed in as, and the store that follows from it.
 *
 * The computer has one Google sign-in: the account the phone set Cairn up
 * with. It runs through Cairn's Worker, which keeps the Google grant; this
 * computer keeps only its Firebase session, which Firebase renews by itself
 * across launches. Everything else — the inbox, the accounts, AI sorting —
 * is set up on the phone and shown here from Firestore.
 */
export function CairnProvider({ platform, preview, children }: { platform: DesktopPlatform; preview?: Preview; children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [email, setEmail] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  // Kept so switching to the synced store can carry local work up with it.
  const local = useRef<Store | null>(null)

  const openLocal = useCallback(async (): Promise<Store> => {
    if (local.current) return local.current
    const { reminders, notes } = await openLocalRepositories(platform.storage, {
      onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
    })
    const now = Date.now()
    await Promise.all([reminders.purgeTombstones(now), notes.purgeTombstones(now)])
    const opened: Store = { userId: 'local', reminders, notes }
    local.current = opened
    return opened
  }, [platform])

  /** Brings up the synced store for the signed-in person. */
  const startSyncing = useCallback(
    async (uid: string, address: string | null) => {
      setAuth({ status: 'connecting' })
      setEmail(address)
      try {
        const synced = await openSyncedRepositories(uid, (error) => console.error('Sync problem', error))
        await carryLocalWorkUp(platform, uid, local.current, synced)
        // Notes thirty days in the recycle bin are deleted for good, from the
        // cloud too, once the server has said what it holds.
        void Promise.all([synced.notes.serverSynced(), synced.reminders.serverSynced()])
          .then(() => setSyncedAt(Date.now()))
        void Promise.all([synced.notes.serverSynced(), synced.reminders.serverSynced()])
          .then(() => Promise.all([synced.notes.purgeTombstones(Date.now()), synced.reminders.purgeTombstones(Date.now())]))
          .catch((error: unknown) => console.error('Could not empty the recycle bin', error))
        setStore({ userId: uid, reminders: synced.reminders, notes: synced.notes, close: synced.close })
        setAuth({ status: 'synced' })
      } catch (error) {
        setStore(await openLocal())
        setAuth({ status: 'error', message: message(error) })
      }
    },
    [platform, openLocal],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // The local store opens first so the app is usable immediately, rather
      // than staring at a spinner while the network is consulted.
      const opened = await openLocal()
      if (cancelled) return
      setStore(opened)
      if (preview) {
        await preview.seed?.(opened)
        setEmail(preview.email)
        setStore({ ...opened, userId: 'preview' })
        setAuth({ status: 'synced' })
        return
      }
      // Older versions kept Google refresh tokens here; the Worker holds them now.
      await platform.secrets.delete(LEGACY_ACCOUNTS_KEY).catch(() => {})
      const user = await currentUser()
      if (cancelled) return
      if (user) await startSyncing(user.uid, user.email)
      else setAuth({ status: 'local' })
    })()
    return () => {
      cancelled = true
    }
  }, [platform, preview, openLocal, startSyncing])

  const signIn = useCallback(async () => {
    setAuth({ status: 'connecting' })
    try {
      const result = await consentThroughWorker(platform, worker, { want: ['drive'] })
      if (!result.idToken) throw new Error('The sign-in did not say who you are. Try again.')
      const uid = await signInToFirebase(result.idToken)
      await startSyncing(uid, result.email)
    } catch (error) {
      setAuth({ status: 'error', message: message(error) })
    }
  }, [platform, startSyncing])

  const grant = useCallback(
    async (account: string, want: readonly Want[]) => {
      await consentThroughWorker(platform, worker, { want, hint: account, link: true })
    },
    [platform],
  )

  /**
   * The desktop keeps a live, lasting copy of the cloud, so syncing is
   * making sure everything written here has reached it — or, after a long
   * time offline, starting again from the account.
   */
  const runSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    try {
      if (auth.status === 'error') {
        const user = await currentUser()
        if (user) await startSyncing(user.uid, user.email)
      } else await settled()
      setSyncedAt(Date.now())
    } catch (error) {
      setAuth({ status: 'error', message: message(error) })
    } finally {
      setSyncing(false)
    }
  }, [syncing, auth.status, startSyncing])

  const signOut = useCallback(async () => {
    worker.forgetTokens()
    store?.close?.()
    await signOutOfFirebase().catch(() => {})
    setEmail(null)
    setStore(await openLocal())
    setAuth({ status: 'local' })
  }, [store, openLocal])

  const value = useMemo<Cairn | null>(
    () =>
      store
        ? {
            platform,
            worker,
            userId: store.userId,
            reminders: store.reminders,
            notes: store.notes,
            auth,
            email,
            signIn,
            signOut,
            grant,
            sync: { busy: syncing || auth.status === 'connecting', at: syncedAt, run: runSync },
          }
        : null,
    [platform, store, auth, email, signIn, signOut, grant, syncing, syncedAt, runSync],
  )

  if (!value) return null
  return <CairnContext.Provider value={value}>{children}</CairnContext.Provider>
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Moves anything written before signing in into the account, once.
 *
 * Without this, a first sign-in would look like the app had lost everything.
 * The marker is per account so connecting a second one does not copy the
 * same notes again, and ids are stable so a repeat would merge rather than
 * duplicate anyway.
 */
async function carryLocalWorkUp(
  platform: DesktopPlatform,
  uid: string,
  from: Store | null,
  to: { reminders: ReminderRepository; notes: NoteRepository },
): Promise<void> {
  if (!from) return
  const marker = `cairn.carried-up.${uid}`
  if (await platform.storage.get(marker)) return

  const [reminders, notes] = await Promise.all([
    from.reminders.list({ includeDeleted: true }),
    from.notes.list({ includeDeleted: true }),
  ])
  await Promise.all([copy(reminders, to.reminders, uid), copy(notes, to.notes, uid)])
  await platform.storage.set(marker, String(Date.now()))
}

/**
 * Re-files each item under the account. Work done signed out belongs to the
 * 'local' user, and the rules refuse any document whose userId is not the
 * signed-in one — so copied as-is, none of it would ever have arrived.
 */
async function copy<T extends Entity>(items: readonly T[], into: Repository<T, unknown>, uid: string): Promise<void> {
  if (items.length > 0) await into.upsertMany(items.map((item) => ({ ...item, userId: uid })))
}
