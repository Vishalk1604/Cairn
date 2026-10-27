import type { Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { binCountdown, noteHeading, purgeWarning, recycleBin, type Actions } from '@cairn/ui'
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { radius, space, useColors } from '../theme'
import { Glyph } from '../ui/icons'
import { fadeOut, reflow, Tap } from '../ui/motion'

const WITH_DELETED: NoteQuery = { includeDeleted: true }

/** Asks with the system's own dialog before anything is deleted forever. */
function confirmPurge(actions: Actions, notes: readonly Note[]): void {
  const warning = purgeWarning(notes.length)
  Alert.alert(warning.title, warning.message, [
    { text: 'Cancel', style: 'cancel' },
    { text: warning.confirm, style: 'destructive', onPress: () => void actions.purgeNotes(notes) },
  ])
}

/**
 * Deleted notes, for thirty days. After that Cairn deletes them for good —
 * from this phone, from the cloud, and their photos and recordings from Drive.
 * Delete forever (a long press) and Empty bin do the same at once, after asking.
 */
export function RecycleBinScreen({ onBack }: { onBack: () => void }) {
  const c = useColors()
  const actions = useActions()
  const { notes } = useCairn()
  const bin = recycleBin(useObserved(notes, WITH_DELETED), Date.now())

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.bar}>
        <Tap onPress={onBack} scaleTo={0.92} style={styles.icon} accessibilityLabel="Back">
          <Glyph char="←" color={c.fg} />
        </Tap>
        <Text style={[styles.title, { color: c.fg }]}>Recycle bin</Text>
        {bin.length > 0 ? (
          <Tap onPress={() => confirmPurge(actions, bin.map((e) => e.note))} scaleTo={0.94} style={styles.empty} accessibilityLabel="Empty the recycle bin">
            <Text style={{ color: c.danger, fontWeight: '600' }}>Empty</Text>
          </Tap>
        ) : (
          <View style={styles.icon} />
        )}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.hint, { color: c.faint }]}>
          Deleted notes stay here for 30 days, then they are deleted for good, photos and recordings included. Press and hold one to delete it forever now.
        </Text>
        {bin.length === 0 && <Text style={[styles.hint, { color: c.muted, paddingTop: 60 }]}>The recycle bin is empty.</Text>}
        {bin.map(({ note, daysLeft }) => (
          <Animated.View key={note.id} exiting={fadeOut} layout={reflow}>
            <Tap
              onLongPress={() => confirmPurge(actions, [note])}
              scaleTo={0.98}
              style={[styles.row, { backgroundColor: c.surface }]}
              accessibilityLabel={noteHeading(note)}
              accessibilityHint="Press and hold to delete it forever"
            >
              <View style={styles.text}>
                <Text style={[styles.name, { color: c.fg }]} numberOfLines={1}>
                  {noteHeading(note)}
                </Text>
                <Text style={[styles.left, { color: daysLeft <= 3 ? c.danger : c.muted }]}>{binCountdown(daysLeft)}</Text>
              </View>
              <Tap onPress={() => void actions.restoreNote(note)} scaleTo={0.94} style={[styles.restore, { borderColor: c.accent }]}>
                <Text style={{ color: c.accent, fontWeight: '600' }}>Restore</Text>
              </Tap>
            </Tap>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, height: 60 },
  title: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '600' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  body: { padding: space.lg, gap: space.md, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.card + 6, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 68 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 19 },
  left: { fontSize: 13 },
  restore: { borderWidth: 1, borderRadius: 16, paddingHorizontal: space.md, paddingVertical: 6 },
  empty: { minWidth: 48, height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  hint: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
})
