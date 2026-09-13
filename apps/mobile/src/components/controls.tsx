import type { ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../theme'

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={selected ? styles.chipTextSelected : undefined}>{label}</Text>
    </Pressable>
  )
}

export function Button({
  title,
  onPress,
  primary,
  disabled,
  style,
  accessibilityLabel,
}: {
  title: string
  onPress: () => void
  primary?: boolean
  disabled?: boolean
  style?: StyleProp<ViewStyle>
  accessibilityLabel?: string
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.button, primary && styles.primary, disabled && styles.disabled, style]}
    >
      <Text style={primary ? styles.primaryText : undefined}>{title}</Text>
    </Pressable>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  )
}

export const inputStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: 6,
  paddingHorizontal: 10,
  paddingVertical: 8,
  backgroundColor: colors.surface,
  color: colors.fg,
} as const

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipSelected: { backgroundColor: colors.fg, borderColor: colors.fg },
  chipTextSelected: { color: colors.bg },
  button: { borderWidth: 1, borderColor: colors.line, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center' },
  primary: { backgroundColor: colors.fg, borderColor: colors.fg },
  primaryText: { color: colors.bg, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  field: { gap: 6 },
  label: { color: colors.muted, fontSize: 13 },
})
