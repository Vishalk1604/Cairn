import { TokenError } from '@cairn/auth'
import { signOutOfFirebase } from '@cairn/sync'
import { connect, disconnect, forgetAllAccounts, loadAccounts, owner, type Account, type SourceFeatures } from '@cairn/ui'
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
      sync.current = await startSync(store, all, platform)
      setUserId(sync.current.uid)
      setAuth({ status: 'synced', email: holder.identity.email })
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
          }
        : null,
    [local, userId, auth, accounts, signIn, signOut, connectSource, regrant, disconnectSource],
  )

  if (!value) return null
  return <CairnContext.Provider value={value}>{children}</CairnContext.Provider>
}
