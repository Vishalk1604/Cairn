import { currentUser, signInToFirebase, signOutOfFirebase, storedAiSetup, type AiSetup, type Want, type WorkerAccount } from '@cairn/sync'
import { consentThroughWorker, LEGACY_ACCOUNTS_KEY } from '@cairn/ui'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { mobilePlatform } from '../platform/mobile'
import { forgetPushToken } from '../platform/push'
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
import { worker } from './worker'

const platform = mobilePlatform
/** Where the NVIDIA key lives in this phone's secure storage. */
const AI_SECRET = 'ai.nvidia'

/**
 * Who the phone is signed in as, and everything set up on it.
 *
 * The phone is where Cairn is set up: signing in, adding a college account,
 * choosing what is read and the AI key all start here. Google's grants go to
 * Cairn's Worker, which reads mail for the phone and the computer alike; the
 * phone keeps only its Firebase session, and the AI key in its own secure
 * storage as well as the Worker's.
 */
export function CairnProvider({ children, onFatal }: { children: ReactNode; onFatal: (message: string) => void }) {
  const [local, setLocal] = useState<LocalStore | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [email, setEmail] = useState<string | null>(null)
  const [userId, setUserId] = useState(LOCAL_USER)
  const [syncing, setSyncing] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [aiSetup, setAiSetup] = useState<AiSetup | null>(null)
  const sync = useRef<Sync | null>(null)

  /** Starts copying notes and tasks for the signed-in person. */
  const begin = useCallback(async (store: LocalStore, uid: string, address: string | null) => {
    setAuth({ status: 'connecting' })
    try {
      sync.current?.stop()
      const started = await startSync(store, uid)
      sync.current = started
      setUserId(uid)
      setEmail(address)
      setAuth({ status: 'synced', email: address ?? '' })
      void started.ready.then(() => {
        if (sync.current === started) setSyncedAt(Date.now())
      })
    } catch (error) {
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
        setAiSetup(storedAiSetup(await platform.secrets.get(AI_SECRET).catch(() => null)))
        // Older versions kept Google refresh tokens here; the Worker holds them now.
        await platform.secrets.delete(LEGACY_ACCOUNTS_KEY).catch(() => {})
        const user = await currentUser()
        if (cancelled) return
        if (user) await begin(store, user.uid, user.email)
        else setAuth({ status: 'local' })
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
      const result = await consentThroughWorker(platform, worker, { want: ['drive'] })
      if (!result.idToken) throw new Error('The sign-in did not say who you are. Try again.')
      const uid = await signInToFirebase(result.idToken)
      await begin(local, uid, result.email)
      // A key saved before signing in goes to the Worker now.
      if (aiSetup) await worker.setupAi(aiSetup).catch(() => {})
    } catch (error) {
      setAuth({ status: 'error', message: describeError(error) })
    }
  }, [local, begin, aiSetup])

  const signOut = useCallback(async () => {
    await forgetPushToken(worker).catch(() => {})
    worker.forgetTokens()
    sync.current?.stop()
    sync.current = null
    await signOutOfFirebase().catch(() => {})
    setUserId(LOCAL_USER)
    setEmail(null)
    // Notes stay on the phone: signing out stops sharing, it does not delete.
    setAuth({ status: 'local' })
  }, [])

  const addAccount = useCallback(async () => {
    await consentThroughWorker(platform, worker, { want: ['mail', 'classroom'], link: true, add: true })
  }, [])

  const grant = useCallback(async (address: string, want: readonly Want[]) => {
    await consentThroughWorker(platform, worker, { want, hint: address, link: true })
  }, [])

  const watch = useCallback(async (address: string, what: Partial<WorkerAccount['watch']>) => {
    await worker.watch(address, what)
  }, [])

  const disconnect = useCallback(async (address: string) => {
    await worker.disconnect(address)
  }, [])

  const forgetServer = useCallback(async () => {
    await worker.forget()
  }, [])

  const saveAi = useCallback(
    async (setup: AiSetup | null) => {
      if (userId !== LOCAL_USER) await worker.setupAi(setup)
      if (setup) await platform.secrets.set(AI_SECRET, JSON.stringify(setup))
      else await platform.secrets.delete(AI_SECRET).catch(() => {})
      setAiSetup(setup)
    },
    [userId],
  )

  /**
   * Starts copying afresh: everything is pulled from the cloud again and
   * anything not there yet is sent. Firestore keeps no lasting copy on a
   * phone, so this is a real look at the server, not at a cache.
   */
  const runSync = useCallback(async () => {
    if (!local || userId === LOCAL_USER || syncing) return
    setSyncing(true)
    try {
      sync.current?.stop()
      const started = await startSync(local, userId)
      sync.current = started
      await started.ready
      setSyncedAt(Date.now())
      setAuth({ status: 'synced', email: email ?? '' })
    } catch (error) {
      setAuth({ status: 'error', message: describeError(error) })
    } finally {
      setSyncing(false)
    }
  }, [local, userId, email, syncing])

  const value = useMemo<Cairn | null>(
    () =>
      local
        ? {
            platform,
            worker,
            userId,
            reminders: local.reminders,
            notes: local.notes,
            auth,
            email,
            signIn,
            signOut,
            addAccount,
            grant,
            watch,
            disconnect,
            forgetServer,
            ai: { setup: aiSetup, save: saveAi },
            sync: { busy: syncing || auth.status === 'connecting', at: syncedAt, run: runSync },
          }
        : null,
    [local, userId, auth, email, signIn, signOut, addAccount, grant, watch, disconnect, forgetServer, aiSetup, saveAi, syncing, syncedAt, runSync],
  )

  if (!value) return null
  return <CairnContext.Provider value={value}>{children}</CairnContext.Provider>
}
