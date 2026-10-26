import { formatAgo } from '@cairn/ui'
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { space, useColors } from '../theme'
import { SyncIcon } from '../ui/icons'
import { Tap } from '../ui/motion'

/**
 * Sync now, wherever it is natural: the arrows turn while it works, and the
 * line beside them says when it last finished, so a glance answers "is this
 * up to date?".
 */
export function SyncButton({
  busy,
  at,
  onPress,
  label = 'Sync now',
  caption = 'before',
}: {
  busy: boolean
  at?: number | null
  onPress: () => void
  label?: string
  /** Where the last-synced line goes, if anywhere. */
  caption?: 'before' | 'after' | 'none'
}) {
  const c = useColors()
  const turn = useSharedValue(0)
  useEffect(() => {
    if (busy) turn.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false)
    else {
      cancelAnimation(turn)
      turn.value = withTiming(0, { duration: 150 })
    }
  }, [busy, turn])
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360}deg` }] }))
  const text = busy ? 'Syncing…' : at ? `Synced ${formatAgo(at, Date.now())}` : null
  const line = caption !== 'none' && text ? <Text style={[styles.caption, { color: c.faint }]}>{text}</Text> : null
  return (
    <View style={styles.row}>
      {caption === 'before' && line}
      <Tap onPress={() => !busy && onPress()} scaleTo={0.9} haptic="light" style={styles.button} accessibilityRole="button" accessibilityLabel={busy ? 'Syncing' : label}>
        <Animated.View style={spin}>
          <SyncIcon color={busy ? c.accent : c.muted} size={22} />
        </Animated.View>
      </Tap>
      {caption === 'after' && line}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  caption: { fontSize: 12 },
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
})
