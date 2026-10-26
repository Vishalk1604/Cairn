import { useEffect } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { space, useColors } from '../theme'
import { settle, Tap } from '../ui/motion'

/** One chip in a row of filters. The fill behind the chosen one grows in rather than snapping. */
export function FilterChip({ label, count, on, onPress, small }: { label: string; count?: number; on: boolean; onPress: () => void; small?: boolean }) {
  const c = useColors()
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, settle)
  }, [on, fill])
  const pill = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.85 + fill.value * 0.15 }] }))
  return (
    <Tap
      onPress={onPress}
      scaleTo={0.92}
      style={[styles.chip, small && styles.small]}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, { backgroundColor: c.surfaceHigh }, pill]} />
      <Text style={[small ? styles.smallText : styles.text, { color: on ? c.fg : c.muted, fontWeight: on ? '700' : '400' }]} numberOfLines={1}>
        {label}
      </Text>
      {!!count && <Text style={[styles.count, { color: on ? c.accent : c.faint }]}>{count}</Text>}
    </Tap>
  )
}

/**
 * Which account to show: All and one chip per account when there are
 * several, and just the account's name when there is only one, since a
 * choice of one is no choice.
 */
export function AccountChips({ chips, current, onPick }: { chips: { all: boolean; accounts: string[] }; current: string | null; onPick: (account: string | null) => void }) {
  const c = useColors()
  if (chips.accounts.length === 0) return null
  if (!chips.all) {
    return (
      <Text style={[styles.only, { color: c.faint }]} numberOfLines={1}>
        {chips.accounts[0]}
      </Text>
    )
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.row} contentContainerStyle={styles.rowContent}>
      <FilterChip small label="All" on={current === null} onPress={() => onPick(null)} />
      {chips.accounts.map((account) => (
        <FilterChip key={account} small label={account} on={current === account} onPress={() => onPick(account)} />
      ))}
      <View style={{ width: space.sm }} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // A fixed height rather than padding around the text: regular and bold
  // Roboto measure differently on Android, and padding let chips clip.
  chip: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: space.lg, gap: 6 },
  small: { height: 32, paddingHorizontal: space.md },
  fill: { borderRadius: 16 },
  text: { fontSize: 16, lineHeight: 22, includeFontPadding: false },
  smallText: { fontSize: 13, lineHeight: 18, includeFontPadding: false, maxWidth: 200 },
  count: { fontSize: 13, lineHeight: 18, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  row: { flexGrow: 0, height: 40 },
  rowContent: { paddingHorizontal: space.lg, gap: space.xs, alignItems: 'center' },
  only: { fontSize: 13, paddingHorizontal: space.xl, paddingBottom: space.xs },
})
