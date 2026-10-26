import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { space, useColors } from '../theme'
import { ClassIcon, Glyph, MailIcon } from '../ui/icons'
import { settle, Tap } from '../ui/motion'

export type Section = 'notes' | 'tasks' | 'inbox' | 'classroom'

const SECTIONS: { id: Section; label: string; glyph: string }[] = [
  { id: 'notes', label: 'Notes', glyph: '≡' },
  { id: 'tasks', label: 'Tasks', glyph: '☑' },
  { id: 'inbox', label: 'Inbox', glyph: '✉' },
  { id: 'classroom', label: 'Classroom', glyph: '' },
]

/**
 * The tab bar. The highlight behind the current tab slides to the next one on
 * a spring rather than jumping, so switching reads as one motion.
 */
export function BottomNav({ current, badges = {}, onSelect }: { current: Section; badges?: Partial<Record<Section, number>>; onSelect: (section: Section) => void }) {
  const c = useColors()
  const [width, setWidth] = useState(0)
  const index = SECTIONS.findIndex((s) => s.id === current)
  const x = useSharedValue(index)

  useEffect(() => {
    x.value = withTiming(index, settle)
  }, [index, x])

  const slot = width / SECTIONS.length
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * slot + (slot - 56) / 2 }] }))

  return (
    <View style={[styles.bar, { backgroundColor: c.bg, borderTopColor: c.line }]} accessibilityRole="tablist" onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && <Animated.View style={[styles.pill, { backgroundColor: c.surfaceHigh }, pill]} />}
      {SECTIONS.map((s) => {
        const on = s.id === current
        return (
          <Tap
            key={s.id}
            onPress={() => onSelect(s.id)}
            scaleTo={0.92}
            haptic="tick"
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={s.label}
            style={styles.item}
          >
            <View>
              {s.id === 'inbox' ? (
                <MailIcon color={on ? c.fg : c.faint} size={22} />
              ) : s.id === 'classroom' ? (
                <ClassIcon color={on ? c.fg : c.faint} size={22} />
              ) : (
                <Glyph char={s.glyph} color={on ? c.fg : c.faint} size={20} weight={on ? '700' : '400'} />
              )}
              {badges[s.id] ? <View style={[styles.dot, { backgroundColor: c.accent }]} /> : null}
            </View>
            <Text style={{ color: on ? c.fg : c.faint, fontSize: 12, fontWeight: on ? '700' : '400' }}>{s.label}</Text>
          </Tap>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, paddingBottom: space.xs },
  pill: { position: 'absolute', top: space.sm, width: 56, height: 30, borderRadius: 15 },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
  dot: { position: 'absolute', top: 2, right: -2, width: 8, height: 8, borderRadius: 4 },
})
