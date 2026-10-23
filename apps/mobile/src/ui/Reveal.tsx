import { useEffect, type ReactNode } from 'react'
import { StyleSheet, useWindowDimensions } from 'react-native'
import Animated, { interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { duration, ease } from './motion'

/** Where something on screen sits, in window coordinates. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
  radius: number
  /** The surface's own colour, which the growing window fades from. */
  color: string
}

/**
 * A container transform: the thing you pressed becomes the screen it opens.
 *
 * The + button grows into the editor, and a note card grows into that note,
 * so it is always clear where a screen came from and where closing it will
 * take you. The window's edges are animated as insets from the full screen
 * rather than as a width and height, so once open it is simply the whole
 * screen and the keyboard can resize it like any other.
 */
export function Reveal({
  origin,
  open,
  background,
  onClosed,
  children,
}: {
  origin: Rect
  /** Set false to play the way back; onClosed fires when it has landed. */
  open: boolean
  background: string
  onClosed: () => void
  /** The content owns the system back gesture, since closing usually means saving first. */
  children: ReactNode
}) {
  const { width, height } = useWindowDimensions()
  const t = useSharedValue(0)

  useEffect(() => {
    // A curve, not a spring: the window lands exactly on the screen's edges
    // instead of overshooting them and wobbling back.
    if (open) t.value = withTiming(1, { duration: duration.long, easing: ease.enter })
    else {
      t.value = withTiming(0, { duration: duration.medium, easing: ease.exit }, (finished) => {
        if (finished) runOnJS(onClosed)()
      })
    }
  }, [open, t, onClosed])

  const insets = () => {
    'worklet'
    return {
      left: interpolate(t.value, [0, 1], [origin.x, 0]),
      top: interpolate(t.value, [0, 1], [origin.y, 0]),
      right: interpolate(t.value, [0, 1], [width - origin.x - origin.width, 0]),
      bottom: interpolate(t.value, [0, 1], [height - origin.y - origin.height, 0]),
    }
  }

  const window = useAnimatedStyle(() => {
    const edge = insets()
    return {
      ...edge,
      borderRadius: interpolate(t.value, [0, 1], [origin.radius, 0]),
      backgroundColor: interpolateColor(t.value, [0, 0.55], [origin.color, background]),
    }
  })

  // The content is pinned to the screen, not to the growing window, so the
  // window reveals it like a lens instead of squashing it.
  const content = useAnimatedStyle(() => {
    const edge = insets()
    return {
      left: -edge.left,
      top: -edge.top,
      right: -edge.right,
      bottom: -edge.bottom,
      opacity: interpolate(t.value, [0.35, 0.9], [0, 1], 'clamp'),
    }
  })

  return (
    <Animated.View style={[styles.window, window]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.content, content]}>{children}</Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  window: { position: 'absolute', overflow: 'hidden' },
  content: { position: 'absolute' },
})
