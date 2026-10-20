import type { Entity } from '@cairn/core'
import { TokenError, type GoogleIdentity } from '@cairn/auth'
import {
  openLocalRepositories,
  openSyncedRepositories,
  signInToFirebase,
  signOutOfFirebase,
  type NoteRepository,
  type ReminderRepository,
  type Repository,
} from '@cairn/sync'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Platform } from '../platform'
import { CairnContext, type Cairn } from './context'
import { accessToken, forgetCachedTokens, forgetSession, loadSession, signIn as runSignIn, type Session } from './googleSignIn'

export type AuthState =
  | { status: 'loading' }
  /** Signed out. Everything works; nothing leaves this machine. */
  | { status: 'local' }
  | { status: 'connecting' }
  | { status: 'synced'; account: GoogleIdentity }
  | { status: 'error'; message: string }

interface Store {
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
  close?: () => void
}

export function CairnProvider({ platform, children }: { platform: Platform; children: ReactNode }) {
  const [store, setStore] = useState<Store | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  // Kept so switching to the synced store can carry local work up with it.
  const local = useRef<Store | null>(null)

  const openLocal = useCallback(async (): Promise<Store> => {
    if (local.current) return local.current
    const { reminders, notes } = await openLocalRepositories(platform.storage, {
      onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
    })
    const opened: Store = { userId: 'local', reminders, notes }
    local.current = opened
    return opened
  }, [platform])

  const connect = useCallback(
    async (session: Session) => {
      setAuth({ status: 'connecting' })
      try {
        const tokens = await accessToken(platform, session)
        if (!tokens.idToken) throw new Error('Google did not confirm who you are')
        const uid = await signInToFirebase(tokens.idToken)
        const synced = await openSyncedRepositories(uid, (error) => console.error('Sync problem', error))
        await carryLocalWorkUp(platform, uid, local.current, synced)
        setStore({ userId: uid, reminders: synced.reminders, notes: synced.notes, close: synced.close })
        setAuth({ status: 'synced', account: session.identity })
      } catch (error) {
        // A dead refresh token is the one case where the stored session is
        // worthless; anything else is worth keeping and retrying later.
        if (error instanceof TokenError && error.needsReconsent) {
          await forgetSession(platform.secrets)
          forgetCachedTokens()
          setStore(await openLocal())
          setAuth({ status: 'error', message: 'Google signed Cairn out. Sign in again to resume syncing.' })
          return
        }
        setStore(await openLocal())
        setAuth({ status: 'error', message: error instanceof Error ? error.message : String(error) })
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

      const session = await loadSession(platform.secrets)
      if (cancelled) return
      if (session) await connect(session)
      else setAuth({ status: 'local' })
    })()
    return () => {
      cancelled = true
    }
  }, [platform, openLocal, connect])

  const signIn = useCallback(async () => {
    setAuth({ status: 'connecting' })
    try {
      const { session } = await runSignIn(platform)
      await connect(session)
    } catch (error) {
      setAuth({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [platform, connect])

  const signOut = useCallback(async () => {
    store?.close?.()
    forgetCachedTokens()
    await forgetSession(platform.secrets)
    await signOutOfFirebase().catch(() => {})
    setStore(await openLocal())
    setAuth({ status: 'local' })
  }, [platform, store, openLocal])

  const value = useMemo<Cairn | null>(
    () => (store ? { platform, userId: store.userId, reminders: store.reminders, notes: store.notes, auth, signIn, signOut } : null),
    [platform, store, auth, signIn, signOut],
  )

  if (!value) return null
  return <CairnContext.Provider value={value}>{children}</CairnContext.Provider>
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
  platform: Platform,
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
  await Promise.all([copy(reminders, to.reminders), copy(notes, to.notes)])
  await platform.storage.set(marker, String(Date.now()))
}

async function copy<T extends Entity>(items: readonly T[], into: Repository<T, unknown>): Promise<void> {
  if (items.length > 0) await into.upsertMany(items)
}
