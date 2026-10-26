import type { InboxRecord, SenderRule } from '@cairn/core'
import type { AiSetup } from '@cairn/sync'
import { InboxEngine, type Feature, type InboxState } from '@cairn/ui'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { LOCAL_USER, useCairn } from './context'

export { readingOn } from '@cairn/ui'

export interface Inbox extends InboxState {
  /** Reads if this phone is the reader; with `manual` (Sync now), reads here whoever is. */
  refresh(manual?: boolean): Promise<void>
  /** Called when a feature is switched on, so reading starts from that moment. */
  startFresh(account: string, feature: Feature): Promise<void>
  addAsTask(record: InboxRecord): Promise<void>
  dismiss(record: InboxRecord, dismissed?: boolean): Promise<void>
  markRead(record: InboxRecord): Promise<void>
  /** Moves a sender's mail in or out of Important, on every device. */
  mark(record: InboxRecord, rule: SenderRule): Promise<void>
  markSeen(tab: 'inbox' | 'classroom'): void
  /** Saves (or with null, forgets) the NVIDIA key, for this phone and the computer. */
  setAiSetup(setup: AiSetup | null): Promise<void>
  setProfile(profile: string): Promise<void>
  setAutoTasks(on: boolean): Promise<void>
}

const Context = createContext<Inbox | null>(null)

/**
 * The shared inbox, on the phone. The computer reads Gmail and Classroom
 * while it is on; the phone shows what it wrote, and reads for itself only
 * when the computer has been quiet a while, or on Sync now. Either way the
 * same records, rules and key are used on both, through the cloud.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { accounts, platform, reminders, userId } = useCairn()
  const engine = useMemo(() => new InboxEngine({ platform, kind: 'phone', active: () => AppState.currentState === 'active' }), [platform])
  useEffect(() => {
    void engine.ready()
    return () => engine.dispose()
  }, [engine])

  useEffect(() => {
    engine.setContext({ userId: userId === LOCAL_USER ? null : userId, accounts, reminders })
  }, [engine, userId, accounts, reminders])

  // A look when the app comes forward; the engine looks every few minutes while it is open.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void engine.refresh()
    })
    return () => sub.remove()
  }, [engine])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const value = useMemo<Inbox>(
    () => ({
      ...state,
      refresh: (manual) => engine.refresh(manual),
      startFresh: (account, feature) => engine.startFresh(account, feature),
      addAsTask: (record) => engine.addAsTask(record),
      dismiss: (record, dismissed) => engine.dismiss(record, dismissed),
      markRead: (record) => engine.markRead(record),
      mark: (record, rule) => engine.mark(record, rule),
      markSeen: (tab) => engine.markSeen(tab),
      setAiSetup: (setup) => engine.setAiSetup(setup),
      setProfile: (profile) => engine.setProfile(profile),
      setAutoTasks: (on) => engine.setAutoTasks(on),
    }),
    [state, engine],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useInbox(): Inbox {
  const value = useContext(Context)
  if (!value) throw new Error('useInbox needs an InboxProvider')
  return value
}
