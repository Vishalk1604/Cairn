import { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useColors } from '../theme'
import { settle } from '../ui/motion'

/** A switch whose thumb travels on a spring, so flipping it feels like a toggle rather than a repaint. */
export function Switch({ on }: { on: boolean }) {
  const c = useColors()
  const t = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    t.value = withTiming(on ? 1 : 0, settle)
  }, [on, t])
  const track = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(t.value, [0, 1], [c.surfaceHigh, c.accent]) }))
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: t.value * 22 }] }))
  return (
    <Animated.View style={[styles.track, track]} accessibilityRole="switch" accessibilityState={{ checked: on }}>
      <Animated.View style={[styles.thumb, thumb]} />
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  track: { width: 52, height: 30, borderRadius: 15, padding: 3 },
  thumb: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' },
})
