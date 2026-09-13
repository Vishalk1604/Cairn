import { urgencyOf, type Note, type Reminder } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { CairnContext, openCairn, useCairn, type Cairn } from './state/context'
import { useNow, useObserved } from './state/hooks'
import { ToastProvider } from './state/toast'
import { useNotifications } from './state/useNotifications'
import { Button } from './components/controls'
import { DoneList } from './components/DoneList'
import { NoteEditor } from './components/NoteEditor'
import { NoteList } from './components/NoteList'
import { QuickCapture } from './components/QuickCapture'
import { ReminderEditor } from './components/ReminderEditor'
import { ReminderList } from './components/ReminderList'
import { SnoozeSheet } from './components/SnoozeSheet'
import { onNotificationOpened, setUpNotifications } from './platform/notifications'
import { colors } from './theme'

type Tab = 'reminders' | 'notes' | 'done'
type Editing = { kind: 'reminder'; reminder?: Reminder } | { kind: 'note'; note?: Note }

const ACTIVE: ReminderQuery = { status: ['pending', 'snoozed'] }

export function App() {
  const [cairn, setCairn] = useState<Cairn | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void setUpNotifications()
    openCairn().then(setCairn, (e: unknown) => setError(String(e)))
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {error ? (
        <Text style={styles.fatal} accessibilityRole="alert">
          Cairn couldn't open its data: {error}
        </Text>
      ) : cairn ? (
        <CairnContext.Provider value={cairn}>
          <ToastProvider>
            <Main />
          </ToastProvider>
        </CairnContext.Provider>
      ) : null}
    </SafeAreaProvider>
  )
}

function Main() {
  const { reminders } = useCairn()
  const active = useObserved(reminders, ACTIVE)
  const now = useNow(active)
  const notifications = useNotifications(active)
  const [tab, setTab] = useState<Tab>('reminders')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [snoozing, setSnoozing] = useState<Reminder | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(
    () =>
      onNotificationOpened((id) => {
        const reminder = activeRef.current.find((r) => r.id === id)
        setTab('reminders')
        if (reminder) setEditing({ kind: 'reminder', reminder })
      }),
    [],
  )

  const overdue = active.filter((r) => urgencyOf(r, now) === 'overdue').length
  const tabs: { id: Tab; label: string }[] = [
    { id: 'reminders', label: overdue ? `Reminders · ${overdue} overdue` : `Reminders · ${active.length}` },
    { id: 'notes', label: 'Notes' },
    { id: 'done', label: 'Done' },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.top}>
        <QuickCapture
          onCaptured={(result) => {
            // Ask for notifications the first time there's something to be notified about.
            if (result?.kind === 'reminder' && notifications.permission === 'undetermined') void notifications.request()
          }}
        />
        {notifications.supported && notifications.permission === 'denied' && (
          <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="button" style={styles.banner}>
            <Text>Notifications are off, so Cairn can't alert you. Tap to open settings.</Text>
          </Pressable>
        )}
        {notifications.supported && notifications.permission === 'undetermined' && active.length > 0 && (
          <Pressable onPress={() => void notifications.request()} accessibilityRole="button" style={styles.banner}>
            <Text>Turn on notifications so reminders can alert you.</Text>
          </Pressable>
        )}
        <View style={styles.tabs} accessibilityRole="tablist">
          {tabs.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === t.id }}
              style={[styles.tab, tab === t.id && styles.tabSelected]}
            >
              <Text style={tab === t.id ? styles.tabTextSelected : styles.tabText}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.body}>
        {tab === 'reminders' && (
          <ReminderList reminders={active} now={now} onEdit={(reminder) => setEditing({ kind: 'reminder', reminder })} onSnooze={setSnoozing} />
        )}
        {tab === 'notes' && <NoteList onOpen={(note) => setEditing({ kind: 'note', note })} />}
        {tab === 'done' && <DoneList now={now} />}
      </View>

      {tab !== 'done' && (
        <Button
          title={tab === 'notes' ? 'New note' : 'New reminder'}
          primary
          style={styles.fab}
          onPress={() => setEditing(tab === 'notes' ? { kind: 'note' } : { kind: 'reminder' })}
        />
      )}

      {editing?.kind === 'reminder' && <ReminderEditor reminder={editing.reminder} now={now} onClose={() => setEditing(null)} />}
      {editing?.kind === 'note' && <NoteEditor note={editing.note} onClose={() => setEditing(null)} />}
      {snoozing && <SnoozeSheet reminder={snoozing} onClose={() => setSnoozing(null)} />}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  body: { flex: 1, paddingHorizontal: 16 },
  banner: { padding: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  tabs: { flexDirection: 'row', gap: 4, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabSelected: { borderBottomColor: colors.fg },
  tabText: { color: colors.muted },
  tabTextSelected: { color: colors.fg, fontWeight: '700' },
  fab: { position: 'absolute', right: 16, bottom: 24 },
  fatal: { padding: 24, color: colors.danger },
})
