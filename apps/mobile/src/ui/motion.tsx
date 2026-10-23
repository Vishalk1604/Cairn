import * as Haptics from 'expo-haptics'
import { forwardRef, type ReactNode } from 'react'
import { Pressable, type AccessibilityRole, type AccessibilityState, type StyleProp, type View, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  SlideInDown,
  SlideInRight,
  SlideOutDown,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/**
 * Every animation in the app draws from these. Timing curves rather than
 * springs: a spring that overshoots reads as playful once and as wobbly
 * every time after, and nothing in a notes app should wobble. The curves
 * are Material's emphasised set — quick to start moving, gentle to land.
 */
export const ease = {
  /** Things moving within the screen. */
  standard: Easing.bezier(0.2, 0, 0, 1),
  /** Things arriving: fast out of the gate, soft landing. */
  enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  /** Things leaving: gather speed and go. */
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),
}

export const duration = { quick: 120, short: 180, medium: 260, long: 340 } as const

/** A small fade-and-rise for something new appearing in place. */
export const appear = FadeInDown.duration(duration.short)
  .easing(ease.enter)
  .withInitialValues({ opacity: 0, transform: [{ translateY: 6 }] })
export const fadeIn = FadeIn.duration(duration.short).easing(ease.enter)
export const fadeOut = FadeOut.duration(duration.quick).easing(ease.exit)
/** Items reflowing when one is added, removed or moved. */
export const reflow = LinearTransition.duration(duration.medium).easing(ease.standard)
/** Sheets rising from the bottom edge. */
export const sheetIn = SlideInDown.duration(duration.medium).easing(ease.enter)
export const sheetOut = SlideOutDown.duration(duration.short).easing(ease.exit)
/** Pages pushed in from the side. */
export const pageIn = SlideInRight.duration(duration.long).easing(ease.enter)
export const pageOut = SlideOutRight.duration(duration.medium).easing(ease.exit)

/** For a value moving between states — a tab highlight, a switch thumb. */
export const settle = { duration: duration.medium, easing: ease.standard }

export type Haptic = 'none' | 'tick' | 'light' | 'medium'

export function feel(kind: Haptic): void {
  if (kind === 'none') return
  // Haptics are a courtesy: a phone without a motor must not throw on a tap.
  const done = kind === 'tick'
    ? Haptics.selectionAsync()
    : Haptics.impactAsync(kind === 'medium' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light)
  done.catch(() => {})
}

export interface TapProps {
  children: ReactNode
  onPress?: () => void
  onLongPress?: () => void
  style?: StyleProp<ViewStyle>
  /** How far it sinks. Large surfaces should barely move; small buttons can dip a little more. */
  scaleTo?: number
  haptic?: Haptic
  disabled?: boolean
  hitSlop?: number
  accessibilityRole?: AccessibilityRole
  accessibilityLabel?: string
  accessibilityState?: AccessibilityState
  accessibilityHint?: string
}

/**
 * The one way anything in Cairn is pressed.
 *
 * It settles slightly the moment a finger lands and comes back on release —
 * no overshoot, just enough to show the touch registered before whatever it
 * opens has had time to appear. A long press is confirmed by feel rather
 * than by a bigger movement.
 */
export const Tap = forwardRef<View, TapProps>(function Tap(
  { children, onPress, onLongPress, style, scaleTo = 0.97, haptic = 'tick', disabled, hitSlop, ...a11y },
  ref,
) {
  const pressed = useSharedValue(0)
  // Disabled lives in here rather than in a static style, because an
  // animated opacity always wins over a static one.
  const animated = useAnimatedStyle(
    () => ({
      transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
      opacity: disabled ? 0.35 : 1 - 0.12 * pressed.value,
    }),
    [disabled, scaleTo],
  )

  return (
    <AnimatedPressable
      // Reanimated's ref type is narrower than Pressable's own; the instance is the same View.
      ref={ref as never}
      disabled={disabled}
      hitSlop={hitSlop}
      delayLongPress={400}
      onPressIn={() => {
        pressed.value = withTiming(1, { duration: 90, easing: ease.standard })
      }}
      onPressOut={() => {
        pressed.value = withTiming(0, { duration: duration.short, easing: ease.standard })
      }}
      onPress={
        onPress &&
        (() => {
          feel(haptic)
          onPress()
        })
      }
      onLongPress={
        onLongPress &&
        (() => {
          feel('medium')
          onLongPress()
        })
      }
      style={[style, animated]}
      {...a11y}
    >
      {children}
    </AnimatedPressable>
  )
})
