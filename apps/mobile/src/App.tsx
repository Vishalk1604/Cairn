import type { Note, Reminder } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { recoverNoteDraft } from '@cairn/ui'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated from 'react-native-reanimated'
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { BottomNav, type Section } from './components/BottomNav'
import { SnoozeSheet } from './components/SnoozeSheet'
import { onNotificationOpened, scheduleNotifications, setUpNotifications, setUrgentAlerts } from './platform/notifications'
import { storage } from './platform/storage'
import { ClassroomScreen } from './screens/ClassroomScreen'
import { EditorScreen } from './screens/EditorScreen'
import { FoldersScreen } from './screens/FoldersScreen'
import { InboxScreen } from './screens/InboxScreen'
import { NotesScreen } from './screens/NotesScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TaskEditorScreen } from './screens/TaskEditorScreen'
import { TasksScreen } from './screens/TasksScreen'
import { useActions } from './state/actions'
import { CairnProvider } from './state/CairnProvider'
import { useCairn } from './state/context'
import { ALL_FOLDER } from './state/folders'
import { useNow, useObserved } from './state/hooks'
import { InboxProvider, useInbox } from './state/inbox'
import { MediaSync } from './state/media'
import { PreferencesProvider, usePreferences } from './state/preferences'
import { ToastProvider } from './state/toast'
import { useNotifications } from './state/useNotifications'
import { colors, space, useColors } from './theme'
import { Reveal, type Rect } from './ui/Reveal'
import { fadeIn, fadeOut, pageIn, pageOut } from './ui/motion'

const ACTIVE: ReminderQuery = { status: ['pending', 'snoozed'] }

export function App() {
  const [fatal, setFatal] = useState<string | null>(null)

  useEffect(() => {
    void setUpNotifications()
  }, [])

  return (
    <GestureHandlerRootView style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* Measured natively before the first frame, so launching straight after boot never lays out with zero insets. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <StatusBar style="light" />
        {fatal ? (
          <Text style={styles.fatal} accessibilityRole="alert">
            Cairn couldn't open its data: {fatal}
          </Text>
        ) : (
          <CairnProvider onFatal={setFatal}>
            <PreferencesProvider>
              <ToastProvider>
                <MediaSync>
                  <InboxProvider>
                    <Main />
                  </InboxProvider>
                </MediaSync>
              </ToastProvider>
            </PreferencesProvider>
          </CairnProvider>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

/** A note being edited, and the shape on screen it grew out of. */
interface Editing {
  note?: Note
  origin: Rect
  folder?: string
  open: boolean
}

type Page = 'folders' | 'settings' | null

function Main() {
  const c = useColors()
  const { reminders, notes } = useCairn()
  const actions = useActions()
  const { preferences } = usePreferences()
  const inbox = useInbox()
  const active = useObserved(reminders, ACTIVE)
  const now = useNow(active)
  const notifications = useNotifications(active)
  const [section, setSection] = useState<Section>('notes')
  const [folder, setFolder] = useState(ALL_FOLDER)
  const [selecting, setSelecting] = useState(false)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [page, setPage] = useState<Page>(null)
  const [task, setTask] = useState<{ reminder?: Reminder; text?: string } | null>(null)
  const [snoozing, setSnoozing] = useState<Reminder | null>(null)
  const activeRef = useRef(active)
  // The first screen appears as it is. Fading it in from nothing meant that a
  // phone too busy to run that first animation (just after boot) showed an
  // empty page under the tab bar.
  const shown = useRef(false)
  useEffect(() => {
    shown.current = true
  }, [])
  activeRef.current = active

  // A note being written when the app was killed is saved now, once.
  const recovered = useRef(false)
  useEffect(() => {
    if (recovered.current) return
    recovered.current = true
    void recoverNoteDraft(storage, notes, actions)
  }, [notes, actions])

  useEffect(
    () =>
      onNotificationOpened((id) => {
        const reminder = activeRef.current.find((r) => r.id === id)
        setSection('tasks')
        if (reminder) setTask({ reminder })
      }),
    [],
  )

  // Asked for when there is first something to alert about, not on first launch.
  useEffect(() => {
    if (active.length > 0 && notifications.permission === 'undetermined') void notifications.request()
  }, [active.length, notifications])

  useEffect(() => {
    setUrgentAlerts(preferences.urgentAlerts)
    if (notifications.permission === 'granted') void scheduleNotifications(activeRef.current, Date.now())
  }, [preferences.urgentAlerts, notifications.permission])

  const closeEditor = useCallback(() => setEditing((e) => (e ? { ...e, open: false } : e)), [])
  const editorGone = useCallback(() => setEditing(null), [])
  const closePage = useCallback(() => setPage(null), [])

  const badges = { inbox: section === 'inbox' ? 0 : inbox.unseen, classroom: section === 'classroom' ? 0 : inbox.unseenClassroom }

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
        <Animated.View key={section} entering={shown.current ? fadeIn : undefined} exiting={fadeOut} style={styles.root}>
          {section === 'notes' && (
            <NotesScreen
              folder={folder}
              onFolderChange={setFolder}
              onOpen={(note, origin) => setEditing({ note, origin, open: true })}
              onNew={(origin, current) => setEditing({ origin, folder: current, open: true })}
              onFolders={() => setPage('folders')}
              onSettings={() => setPage('settings')}
              onSelectingChange={setSelecting}
            />
          )}
          {section === 'tasks' && (
            <TasksScreen active={active} now={now} onEdit={(reminder) => setTask({ reminder })} onSnooze={setSnoozing} onMore={(text) => setTask({ text })} />
          )}
          {section === 'inbox' && <InboxScreen onSettings={() => setPage('settings')} />}
          {section === 'classroom' && <ClassroomScreen onSettings={() => setPage('settings')} />}
        </Animated.View>

        {!selecting && <BottomNav current={section} badges={badges} onSelect={setSection} />}
      </SafeAreaView>

      {page && (
        <Animated.View entering={pageIn} exiting={pageOut} style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
          <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
            {page === 'folders' ? (
              <FoldersScreen
                current={folder}
                onBack={closePage}
                onPick={(id) => {
                  setFolder(id)
                  setPage(null)
                }}
              />
            ) : (
              <SettingsScreen onBack={closePage} />
            )}
          </SafeAreaView>
        </Animated.View>
      )}

      {editing && (
        <Reveal origin={editing.origin} open={editing.open} background={c.bg} onClosed={editorGone}>
          <EditorScreen note={editing.note} folder={editing.folder} onClose={closeEditor} />
        </Reveal>
      )}

      {task && (
        <Animated.View entering={pageIn} exiting={pageOut} style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
          <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
            <TaskEditorScreen key={task.reminder?.id ?? 'new'} reminder={task.reminder} text={task.text} now={now} onClose={() => setTask(null)} />
          </SafeAreaView>
        </Animated.View>
      )}
      {snoozing && <SnoozeSheet reminder={snoozing} onClose={() => setSnoozing(null)} />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fatal: { padding: space.xl, color: colors.danger },
})
