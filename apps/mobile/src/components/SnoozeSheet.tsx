import type { Reminder } from '@cairn/core'
import { snoozeChoices } from '@cairn/ui'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useActions } from '../state/actions'
import { colors } from '../theme'

/** Bottom sheet of snooze targets; also offers skipping one occurrence of a repeating reminder. */
export function SnoozeSheet({ reminder, onClose }: { reminder: Reminder; onClose: () => void }) {
  const actions = useActions()
  const act = (fn: () => Promise<unknown>) => async () => {
    await fn()
    onClose()
  }

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.heading}>Snooze “{reminder.title}”</Text>
          {snoozeChoices(Date.now()).map((choice) => (
            <Pressable key={choice.label} style={styles.item} accessibilityRole="button" onPress={act(() => actions.snooze(reminder, choice.until))}>
              <Text>{choice.label}</Text>
            </Pressable>
          ))}
          {reminder.rrule && (
            <Pressable style={styles.item} accessibilityRole="button" onPress={act(() => actions.skip(reminder))}>
              <Text>Skip this one</Text>
            </Pressable>
          )}
          <Pressable style={styles.item} accessibilityRole="button" onPress={onClose}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: colors.surface, padding: 16, gap: 2, borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  heading: { fontWeight: '700', marginBottom: 8 },
  item: { paddingVertical: 12 },
  cancel: { color: colors.muted },
})
