import { compareByUrgency, URGENCY_LEVELS, urgencyOf, type Reminder, type UrgencyLevel } from '@cairn/core'
import { formatReminderWhen, URGENCY } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { FadeOutLeft, LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useActions } from '../state/actions'
import { radius, space, useColors } from '../theme'
import { Glyph } from '../ui/icons'
import { appear, duration, ease, feel, reflow, settle, Tap } from '../ui/motion'

interface Props {
  reminders: readonly Reminder[]
  now: number
  onEdit: (reminder: Reminder) => void
  onSnooze: (reminder: Reminder) => void
}

/** Tasks grouped by how soon they bite, each group in the colour the widget and tray use for it. */
export function ReminderList({ reminders, now, onEdit, onSnooze }: Props) {
  const c = useColors()
  const sections = useMemo(() => {
    const byLevel = new Map<UrgencyLevel, Reminder[]>()
    for (const r of [...reminders].sort(compareByUrgency(now))) {
      const level = urgencyOf(r, now)
      byLevel.set(level, [...(byLevel.get(level) ?? []), r])
    }
    return URGENCY_LEVELS.flatMap((level) => {
      const data = byLevel.get(level)
      return data ? [{ level, data }] : []
    })
  }, [reminders, now])

  let index = 0
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* Lists appear at once; only items added while it is open animate in. */}
      <LayoutAnimationConfig skipEntering>
      {sections.map(({ level, data }) => (
        <Animated.View key={level} layout={reflow}>
          <View style={styles.header}>
            <View style={[styles.dot, { backgroundColor: URGENCY[level].color }]} />
            <Text style={[styles.headerText, { color: c.fg }]} accessibilityRole="header">
              {URGENCY[level].label}
            </Text>
            <Text style={{ color: c.faint }}>{data.length}</Text>
          </View>
          {data.map((r) => (
            <ReminderRow key={r.id} reminder={r} level={level} now={now} delay={Math.min(index++, 10) * 30} onEdit={onEdit} onSnooze={onSnooze} />
          ))}
        </Animated.View>
      ))}
      </LayoutAnimationConfig>
    </ScrollView>
  )
}

function ReminderRow({
  reminder: r,
  level,
  now,
  delay,
  onEdit,
  onSnooze,
}: {
  reminder: Reminder
  level: UrgencyLevel
  now: number
  delay: number
  onEdit: (r: Reminder) => void
  onSnooze: (r: Reminder) => void
}) {
  const c = useColors()
  const actions = useActions()
  const token = URGENCY[level]
  const [ticking, setTicking] = useState(false)
  const fill = useSharedValue(0)
  const snoozed = r.status === 'snoozed' && (r.snoozedUntil ?? 0) > now
  const meta = [formatReminderWhen(r, now), r.priority === 'high' ? 'High priority' : null, ...r.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')

  useEffect(() => {
    fill.value = withTiming(ticking ? 1 : 0, settle)
  }, [ticking, fill])
  const check = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.4 + fill.value * 0.6 }] }))

  const complete = () => {
    setTicking(true)
    feel('medium')
    // A beat for the tick to be seen before the row leaves.
    setTimeout(() => void actions.complete(r), 260)
  }

  return (
    <Animated.View entering={appear} exiting={FadeOutLeft.duration(duration.medium).easing(ease.exit)} layout={reflow}>
      <Tap onPress={() => onEdit(r)} scaleTo={0.98} style={[styles.row, { backgroundColor: c.surface }]} accessibilityLabel={`${r.title}, ${token.label}`}>
        <Tap onPress={complete} scaleTo={0.92} haptic="none" hitSlop={10} style={[styles.circle, { borderColor: token.color }]} accessibilityLabel={`Complete ${r.title}`}>
          <Animated.View style={[styles.fill, { backgroundColor: token.color }, check]}>
            <Glyph char="✓" color="#000" size={13} weight="700" />
          </Animated.View>
        </Tap>
        <View style={styles.main}>
          <Text style={[styles.title, { color: c.fg }]} numberOfLines={2}>
            {r.title}
          </Text>
          <Text style={{ color: level === 'overdue' ? token.color : c.muted, fontSize: 13 }} numberOfLines={1}>
            {meta}
          </Text>
          {r.body ? (
            <Text style={{ color: c.faint, fontSize: 13 }} numberOfLines={1}>
              {r.body}
            </Text>
          ) : null}
        </View>
        <Tap
          onPress={() => (snoozed ? void actions.unsnooze(r) : onSnooze(r))}
          scaleTo={0.92}
          hitSlop={8}
          style={[styles.snooze, { backgroundColor: c.surfaceHigh }]}
          accessibilityLabel={snoozed ? `Unsnooze ${r.title}` : `Snooze ${r.title}`}
        >
          <Text style={{ color: c.muted, fontSize: 13 }}>{snoozed ? 'Wake' : 'Snooze'}</Text>
        </Tap>
      </Tap>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 140, paddingTop: space.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.lg, paddingBottom: space.sm, paddingHorizontal: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  headerText: { fontWeight: '700', fontSize: 15, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, marginBottom: space.sm, borderRadius: radius.card + 2 },
  circle: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fill: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  main: { flex: 1, gap: 3 },
  title: { fontWeight: '600', fontSize: 16 },
  snooze: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: 14 },
})
