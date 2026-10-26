import { TokenError } from '@cairn/auth'
import { signOutOfFirebase } from '@cairn/sync'
import { connect, disconnect, forgetAllAccounts, loadAccounts, owner, type Account, type AccountGap, type SourceFeatures } from '@cairn/ui'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mobilePlatform } from '../platform/mobile'
import {
  CairnContext,
  describeError,
  LOCAL_USER,
  openLocal,
  startSync,
  type AuthState,
  type Cairn,
  type LocalStore,
  type Sync,
} from './context'

const platform = mobilePlatform

export function CairnProvider({ children, onFatal }: { children: ReactNode; onFatal: (message: string) => void }) {
  const [local, setLocal] = useState<LocalStore | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [userId, setUserId] = useState(LOCAL_USER)
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const sync = useRef<Sync | null>(null)

  const begin = useCallback(async (store: LocalStore, all: Account[]) => {
    const holder = owner(all)
    if (!holder) {
      setAuth({ status: 'local' })
      return
    }
    setAuth({ status: 'connecting' })
    try {
      sync.current?.stop()
      const started = await startSync(store, all, platform)
      sync.current = started
      setUserId(started.uid)
      setAuth({ status: 'synced', email: holder.identity.email })
      void started.ready.then(() => {
        if (sync.current === started) setSyncedAt(Date.now())
      })
    } catch (error) {
      // A dead refresh token is the one case where the stored account is
      // worthless; anything else (no network, mostly) is worth retrying.
      if (error instanceof TokenError && error.needsReconsent) {
        await forgetAllAccounts(platform)
        setAccounts([])
        setAuth({ status: 'error', message: 'Google signed Cairn out. Sign in again to resume syncing.' })
        return
      }
      setAuth({ status: 'error', message: describeError(error) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // The phone's store opens first so the app is usable at once, rather
        // than waiting on a network it may not have.
        const store = await openLocal()
        if (cancelled) return
        setLocal(store)
        const saved = await loadAccounts(platform.secrets)
        if (cancelled) return
        setAccounts(saved)
        await begin(store, saved)
      } catch (error) {
        onFatal(describeError(error))
      }
    })()
    return () => {
      cancelled = true
      sync.current?.stop()
    }
  }, [begin, onFatal])

  const signIn = useCallback(async () => {
    if (!local) return
    setAuth({ status: 'connecting' })
    try {
      const all = await connect(platform, { role: 'owner' })
      setAccounts(all)
      await begin(local, all)
    } catch (error) {
      setAuth({ status: 'error', message: describeError(error) })
    }
  }, [local, begin])

  const signOut = useCallback(async () => {
    sync.current?.stop()
    sync.current = null
    await forgetAllAccounts(platform)
    await signOutOfFirebase().catch(() => {})
    setAccounts([])
    setUserId(LOCAL_USER)
    // Notes stay on the phone: signing out stops sharing, it does not delete.
    setAuth({ status: 'local' })
  }, [])

  const connectSource = useCallback(async (features: SourceFeatures) => {
    setAccounts(await connect(platform, { role: 'source', features }))
  }, [])

  const regrant = useCallback(async (account: Account, features: SourceFeatures) => {
    const all = await connect(platform, { role: account.role, features, expect: account.identity })
    setAccounts(all)
    return all
  }, [])

  const disconnectSource = useCallback(async (sub: string) => {
    setAccounts(await disconnect(platform, sub))
  }, [])

  const matchAccount = useCallback(async (gap: AccountGap) => {
    const expect = gap.account?.identity ?? { sub: gap.sub, email: gap.email, emailVerified: true }
    setAccounts(await connect(platform, { role: gap.role, features: gap.features, expect }))
  }, [])

  /**
   * Starts copying afresh: everything is pulled from the cloud again and
   * anything not there yet is sent. Firestore keeps no lasting copy on a
   * phone, so this is a real look at the server, not at a cache.
   */
  const runSync = useCallback(async () => {
    if (!local || !owner(accounts) || syncing) return
    setSyncing(true)
    try {
      sync.current?.stop()
      const started = await startSync(local, accounts, platform)
      sync.current = started
      setUserId(started.uid)
      await started.ready
      setSyncedAt(Date.now())
      setAuth({ status: 'synced', email: owner(accounts)!.identity.email })
    } catch (error) {
      setAuth({ status: 'error', message: describeError(error) })
    } finally {
      setSyncing(false)
    }
  }, [local, accounts, syncing])

  const value = useMemo<Cairn | null>(
    () =>
      local
        ? {
            platform,
            userId,
            reminders: local.reminders,
            notes: local.notes,
            auth,
            accounts,
            signIn,
            signOut,
            connectSource,
            regrant,
            disconnectSource,
            matchAccount,
            sync: { busy: syncing || auth.status === 'connecting', at: syncedAt, run: runSync },
          }
        : null,
    [local, userId, auth, accounts, signIn, signOut, connectSource, regrant, disconnectSource, matchAccount, syncing, syncedAt, runSync],
  )

  if (!value) return null
  return <CairnContext.Provider value={value}>{children}</CairnContext.Provider>
}
