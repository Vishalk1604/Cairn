import type { InboxRecord, SenderRule } from '@cairn/core'
import { gmailLink, type AiSetup } from '@cairn/sync'
import { InboxEngine, type Feature, type InboxHost, type InboxState } from '@cairn/ui'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { useCairn } from './context'

export interface Inbox extends InboxState {
  /** Reads if this computer is the reader; with `manual` (Sync now), reads here whoever is. */
  refresh(manual?: boolean): Promise<void>
  startFresh(account: string, feature: Feature): Promise<void>
  addAsTask(record: InboxRecord): Promise<void>
  dismiss(record: InboxRecord, dismissed?: boolean): Promise<void>
  /** Opens it where it lives, Gmail or Classroom, and marks it read everywhere. */
  open(record: InboxRecord): void
  mark(record: InboxRecord, rule: SenderRule): Promise<void>
  markSeen(tab: 'inbox' | 'classroom'): void
  setAiSetup(setup: AiSetup | null): Promise<void>
  setProfile(profile: string): Promise<void>
  setAutoTasks(on: boolean): Promise<void>
}

const Context = createContext<Inbox | null>(null)

/**
 * The shared inbox, on the computer. Cairn lives in the tray, so this is
 * usually the device that reads Gmail and Classroom for every other: it
 * claims the reading whenever it can read everything the phone can, sorts
 * with the same key, and writes what it finds for the phone to show.
 */
export function InboxProvider({ children, host }: { children: ReactNode; host?: Partial<InboxHost> }) {
  const { accounts, platform, reminders, userId, auth } = useCairn()
  const engine = useMemo(() => new InboxEngine({ platform, kind: 'desktop', ...host }), [platform, host])
  useEffect(() => {
    void engine.ready()
    return () => engine.dispose()
  }, [engine])

  const signedIn = auth.status === 'synced'
  useEffect(() => {
    engine.setContext({ userId: signedIn ? userId : null, accounts, reminders })
  }, [engine, signedIn, userId, accounts, reminders])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  const value = useMemo<Inbox>(
    () => ({
      ...state,
      refresh: (manual) => engine.refresh(manual),
      startFresh: (account, feature) => engine.startFresh(account, feature),
      addAsTask: (record) => engine.addAsTask(record),
      dismiss: (record, dismissed) => engine.dismiss(record, dismissed),
      open(record) {
        void engine.markRead(record)
        const link = record.classroom ? record.classroom.link : gmailLink(record)
        if (link) void platform.openLink(link)
      },
      mark: (record, rule) => engine.mark(record, rule),
      markSeen: (tab) => engine.markSeen(tab),
      setAiSetup: (setup) => engine.setAiSetup(setup),
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
