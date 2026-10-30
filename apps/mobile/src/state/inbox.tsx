import type { InboxRecord, SenderRule } from '@cairn/core'
import { InboxEngine, type CourseColorKey, type InboxState } from '@cairn/ui'
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { notificationPermission, type PermissionState } from '../platform/notifications'
import { onPushTokenChange, registerPush, timeZone } from '../platform/push'
import { LOCAL_USER, useCairn } from './context'

export interface Inbox extends InboxState {
  /** Sync now: Cairn's Worker looks at every account straight away. */
  refresh(): Promise<void>
  addAsTask(record: InboxRecord): Promise<void>
  dismiss(record: InboxRecord, dismissed?: boolean): Promise<void>
  markRead(record: InboxRecord): Promise<void>
  /** Moves a sender's mail in or out of Important, on every device. */
  mark(record: InboxRecord, rule: SenderRule): Promise<void>
  markSeen(tab: 'inbox' | 'classroom'): void
  setProfile(profile: string): Promise<void>
  setAutoTasks(on: boolean): Promise<void>
  setCourseColor(courseId: string, color: CourseColorKey | 'auto'): Promise<void>
}

const Context = createContext<Inbox | null>(null)

/**
 * The shared inbox, on the phone: what Cairn's Worker read and sorted, from
 * Firestore. The phone reads no mail itself; it hears about what arrives by
 * push, even while Cairn is closed.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { platform, reminders, userId, worker } = useCairn()
  const engine = useMemo(() => new InboxEngine({ platform, worker }), [platform, worker])
  useEffect(() => {
    void engine.ready()
    return () => engine.dispose()
  }, [engine])

  const signedIn = userId !== LOCAL_USER
  useEffect(() => {
    engine.setContext({ userId: signedIn ? userId : null, reminders })
    // The Worker keeps the evening and morning notifications on this phone's clock.
    if (signedIn) void engine.setTimeZone(timeZone())
  }, [engine, signedIn, userId, reminders])

  // Push needs someone signed in and notifications allowed, which can change in system settings.
  const [notifications, setNotifications] = useState<PermissionState | null>(null)
  useEffect(() => {
    void notificationPermission().then(setNotifications)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void notificationPermission().then(setNotifications)
    })
    return () => sub.remove()
  }, [])
  useEffect(() => {
    if (!signedIn || notifications !== 'granted') return
    void registerPush(worker).catch((error: unknown) => console.warn('Push is not set up in this build', error))
    return onPushTokenChange(worker)
  }, [signedIn, notifications, worker])

  const state = useSyncExternalStore(engine.subscribe, engine.getState)
  // Kept apart from the state so screens can run effects on them without rerunning on every change.
  const actions = useMemo<Omit<Inbox, keyof InboxState>>(
    () => ({
      refresh: () => engine.refresh(),
      addAsTask: (record) => engine.addAsTask(record),
      dismiss: (record, dismissed) => engine.dismiss(record, dismissed),
      markRead: (record) => engine.markRead(record),
      mark: (record, rule) => engine.mark(record, rule),
      markSeen: (tab) => engine.markSeen(tab),
      setProfile: (profile) => engine.setProfile(profile),
      setAutoTasks: (on) => engine.setAutoTasks(on),
      setCourseColor: (courseId, color) => engine.setCourseColor(courseId, color),
    }),
    [engine],
  )
  const value = useMemo<Inbox>(() => ({ ...state, ...actions }), [state, actions])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useInbox(): Inbox {
  const value = useContext(Context)
  if (!value) throw new Error('useInbox needs an InboxProvider')
  return value
}
