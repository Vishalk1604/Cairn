import type { ReminderQuery } from '@cairn/sync'
import { formatDue } from '@cairn/ui'
import { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { colors } from '../theme'

const DONE: ReminderQuery = { status: ['done'] }

export function DoneList({ now }: { now: number }) {
  const { reminders } = useCairn()
  const actions = useActions()
  const done = useObserved(reminders, DONE)
  const sorted = useMemo(
    () => [...done].sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)).slice(0, 100),
    [done],
  )

  return (
    <FlatList
      data={sorted}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.content}
      ListEmptyComponent={<Text style={styles.empty}>Completed reminders show up here.</Text>}
      renderItem={({ item: r }) => (
        <View style={styles.row}>
          <View style={styles.main}>
            <Text style={styles.title}>{r.title}</Text>
            <Text style={styles.meta}>Completed {formatDue(r.completedAt ?? r.updatedAt, false, now)}</Text>
          </View>
          <Pressable onPress={() => void actions.reopen(r)} accessibilityRole="button" accessibilityLabel={`Reopen ${r.title}`} hitSlop={8}>
            <Text style={styles.action}>Reopen</Text>
          </Pressable>
          <Pressable onPress={() => void actions.removeReminder(r)} accessibilityRole="button" accessibilityLabel={`Delete ${r.title}`} hitSlop={8}>
            <Text style={styles.action}>Delete</Text>
          </Pressable>
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 4, backgroundColor: colors.surface },
  main: { flex: 1 },
  title: { color: colors.muted, textDecorationLine: 'line-through' },
  meta: { color: colors.muted, fontSize: 13 },
  action: { color: colors.muted },
  empty: { color: colors.muted, paddingVertical: 24 },
})
