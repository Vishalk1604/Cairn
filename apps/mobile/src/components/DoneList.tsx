import type { ReminderQuery } from '@cairn/sync'
import { formatDue } from '@cairn/ui'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { radius, space, useColors } from '../theme'
import { Glyph, TrashIcon } from '../ui/icons'
import { appear, fadeOut, reflow, Tap } from '../ui/motion'

const DONE: ReminderQuery = { status: ['done'] }

export function DoneList({ now }: { now: number }) {
  const c = useColors()
  const { reminders } = useCairn()
  const actions = useActions()
  const done = useObserved(reminders, DONE)
  const sorted = useMemo(() => [...done].sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)).slice(0, 100), [done])

  if (sorted.length === 0) return <Text style={[styles.empty, { color: c.muted }]}>Completed tasks show up here.</Text>

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Lists appear at once; only items added while it is open animate in. */}
      <LayoutAnimationConfig skipEntering>
      {sorted.map((r, i) => (
        <Animated.View key={r.id} entering={appear} exiting={fadeOut} layout={reflow}>
          <View style={[styles.row, { backgroundColor: c.surface }]}>
            <Tap onPress={() => void actions.reopen(r)} scaleTo={0.92} hitSlop={10} style={[styles.circle, { backgroundColor: c.accent }]} accessibilityLabel={`Reopen ${r.title}`}>
              <Glyph char="✓" color={c.onAccent} size={13} weight="700" />
            </Tap>
            <View style={styles.main}>
              <Text style={[styles.title, { color: c.muted }]} numberOfLines={2}>
                {r.title}
              </Text>
              <Text style={{ color: c.faint, fontSize: 13 }}>Completed {formatDue(r.completedAt ?? r.updatedAt, false, now)}</Text>
            </View>
            <Tap onPress={() => void actions.removeReminder(r)} scaleTo={0.92} hitSlop={8} accessibilityLabel={`Delete ${r.title}`}>
              <TrashIcon color={c.faint} size={20} />
            </Tap>
          </View>
        </Animated.View>
      ))}
      </LayoutAnimationConfig>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140, paddingTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, marginBottom: space.sm, borderRadius: radius.card + 2 },
  circle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: 3 },
  title: { textDecorationLine: 'line-through', fontSize: 16 },
  empty: { textAlign: 'center', paddingTop: 80, fontSize: 15 },
})
