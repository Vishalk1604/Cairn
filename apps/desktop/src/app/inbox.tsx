import type { InboxRecord, SenderRule } from '@cairn/core'
import { gmailLink } from '@cairn/sync'
import { InboxEngine, type InboxHost, type InboxState } from '@cairn/ui'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useCairn } from './context'

export interface Inbox extends InboxState {
  /** Sync now: Cairn's Worker looks at every account straight away. */
  refresh(): Promise<void>
  addAsTask(record: InboxRecord): Promise<void>
  dismiss(record: InboxRecord, dismissed?: boolean): Promise<void>
  /** Opens it where it lives, Gmail or Classroom, and marks it read everywhere. */
  open(record: InboxRecord): void
  mark(record: InboxRecord, rule: SenderRule): Promise<void>
  markSeen(tab: 'inbox' | 'classroom'): void
  setProfile(profile: string): Promise<void>
  setAutoTasks(on: boolean): Promise<void>
}

const Context = createContext<Inbox | null>(null)

/**
 * The shared inbox, on the computer: what the Worker read and sorted, from
 * Firestore. While Cairn runs, what arrives is announced here as a toast, the
 * same things the phone is told by push.
 */
export function InboxProvider({ children, host }: { children: ReactNode; host?: Partial<InboxHost> }) {
  const { platform, reminders, userId, auth, worker } = useCairn()
  const engine = useMemo(() => new InboxEngine({ platform, worker, announce: true, ...host }), [platform, worker, host])
  useEffect(() => {
    void engine.ready()
    return () => engine.dispose()
  }, [engine])

  const signedIn = auth.status === 'synced'
  useEffect(() => {
    engine.setContext({ userId: signedIn ? userId : null, reminders })
  }, [engine, signedIn, userId, reminders])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const value = useMemo<Inbox>(
    () => ({
      ...state,
      refresh: () => engine.refresh(),
      addAsTask: (record) => engine.addAsTask(record),
      dismiss: (record, dismissed) => engine.dismiss(record, dismissed),
      open(record) {
        void engine.markRead(record)
        const link = record.classroom ? record.classroom.link : gmailLink(record)
        if (link) void platform.openLink(link)
      },
      mark: (record, rule) => engine.mark(record, rule),
      markSeen: (tab) => engine.markSeen(tab),
      setProfile: (profile) => engine.setProfile(profile),
      setAutoTasks: (on) => engine.setAutoTasks(on),
    }),
    [state, engine, platform],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useInbox(): Inbox {
  const value = useContext(Context)
  if (!value) throw new Error('useInbox needs an InboxProvider')
  return value
}
