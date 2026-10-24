import { TokenError } from '@cairn/auth'
import type { Entity } from '@cairn/core'
import {
  openLocalRepositories,
  openSyncedRepositories,
  signInToFirebase,
  signOutOfFirebase,
  type NoteRepository,
  type ReminderRepository,
  type Repository,
} from '@cairn/sync'
import {
  accessTokenFor,
  connect,
  disconnect,
  forgetAllAccounts,
  loadAccounts,
  owner,
  type Account,
  type SourceFeatures,
} from '@cairn/ui'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DesktopPlatform } from '../platform'
import { CairnContext, type Cairn } from './context'

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

export function CairnProvider({ platform, children }: { platform: DesktopPlatform; children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [accounts, setAccounts] = useState<Account[]>([])
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

  /** Brings up the synced store for whichever account owns the data. */
  const startSyncing = useCallback(
    async (all: Account[]) => {
      const holder = owner(all)
      if (!holder) {
        setStore(await openLocal())
        setAuth({ status: 'local' })
        return
      }
      setAuth({ status: 'connecting' })
      try {
        const tokens = await accessTokenFor(platform, holder)
        if (!tokens.idToken) throw new Error('Google did not confirm who you are')
        const uid = await signInToFirebase(tokens.idToken)
        const synced = await openSyncedRepositories(uid, (error) => console.error('Sync problem', error))
        await carryLocalWorkUp(platform, uid, local.current, synced)
        // Notes thirty days in the recycle bin are deleted for good, from the
        // cloud too, once the server has said what it holds.
        void Promise.all([synced.notes.serverSynced(), synced.reminders.serverSynced()])
          .then(() => Promise.all([synced.notes.purgeTombstones(Date.now()), synced.reminders.purgeTombstones(Date.now())]))
          .catch((error: unknown) => console.error('Could not empty the recycle bin', error))
        setStore({ userId: uid, reminders: synced.reminders, notes: synced.notes, close: synced.close })
        setAuth({ status: 'synced' })
      } catch (error) {
        // A dead refresh token is the one case where the stored account is
        // worthless; anything else is worth keeping and retrying later.
        if (error instanceof TokenError && error.needsReconsent) {
          await forgetAllAccounts(platform)
          setAccounts([])
          setStore(await openLocal())
          setAuth({ status: 'error', message: 'Google signed Cairn out. Sign in again to resume syncing.' })
          return
        }
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

      const saved = await loadAccounts(platform.secrets)
      if (cancelled) return
      setAccounts(saved)
      if (owner(saved)) await startSyncing(saved)
      else setAuth({ status: 'local' })
    })()
    return () => {
      cancelled = true
    }
  }, [platform, openLocal, startSyncing])

  const signIn = useCallback(async () => {
    setAuth({ status: 'connecting' })
    try {
      const all = await connect(platform, { role: 'owner' })
      setAccounts(all)
      await startSyncing(all)
    } catch (error) {
      setAuth({ status: 'error', message: message(error) })
    }
  }, [platform, startSyncing])

  /** Adds another Google account to read Gmail and Classroom from. */
  const connectSource = useCallback(
    async (features: SourceFeatures) => {
      const all = await connect(platform, { role: 'source', features })
      setAccounts(all)
    },
    [platform],
  )

  /** Asks an account already connected for one more permission. */
  const regrant = useCallback(
    async (account: Account, features: SourceFeatures) => {
      const all = await connect(platform, { role: account.role, features, expect: account.identity })
      setAccounts(all)
    },
    [platform],
  )

  const disconnectSource = useCallback(
    async (sub: string) => {
      setAccounts(await disconnect(platform, sub))
    },
    [platform],
  )

  const signOut = useCallback(async () => {
    store?.close?.()
    await forgetAllAccounts(platform)
    await signOutOfFirebase().catch(() => {})
    setAccounts([])
    setStore(await openLocal())
    setAuth({ status: 'local' })
  }, [platform, store, openLocal])

  const value = useMemo<Cairn | null>(
    () =>
      store
        ? {
            platform,
            userId: store.userId,
            reminders: store.reminders,
            notes: store.notes,
            auth,
            accounts,
            signIn,
            signOut,
            connectSource,
            regrant,
            disconnectSource,
          }
        : null,
    [platform, store, auth, accounts, signIn, signOut, connectSource, regrant, disconnectSource],
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
