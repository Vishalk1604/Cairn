import type { Note } from '@cairn/core'
import { createNoteSaveQueue, type NoteFormValues } from '@cairn/ui'
import { useEffect, useState } from 'react'
import { Modal, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useActions } from '../state/actions'
import { colors } from '../theme'
import { Button, inputStyle } from './controls'

const AUTOSAVE_MS = 800

/** Saves on a debounce while typing and once more on close (including the back button). */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
  const [queue] = useState(() => createNoteSaveQueue(actions, note))
  const [values, setValues] = useState<NoteFormValues>(() => ({
    title: note?.title ?? '',
    body: note?.body ?? '',
    tags: note?.tags.join(' ') ?? '',
    pinned: note?.pinned ?? false,
  }))
  const [status, setStatus] = useState<'saved' | 'unsaved'>('saved')

  const edit = (patch: Partial<NoteFormValues>) => {
    const next = { ...values, ...patch }
    setValues(next)
    queue.change(next)
    setStatus('unsaved')
  }

  useEffect(() => {
    if (!queue.dirty) return
    const timer = setTimeout(() => {
      void queue.save().then(() => {
        if (!queue.dirty) setStatus('saved')
      })
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [values, queue])

  const close = () => void queue.save().then(onClose)
  const remove = async () => {
    if (queue.saved) await actions.removeNote(queue.saved)
    onClose()
  }

  return (
    <Modal animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TextInput
            value={values.title}
            onChangeText={(title) => edit({ title })}
            placeholder="Title"
            placeholderTextColor={colors.muted}
            style={[inputStyle, styles.title]}
            autoFocus={!note}
            accessibilityLabel="Title"
          />
          <TextInput
            value={values.body}
            onChangeText={(body) => edit({ body })}
            placeholder="Write anything"
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            style={[inputStyle, styles.body]}
            accessibilityLabel="Note text"
          />
          <TextInput
            value={values.tags}
            onChangeText={(tags) => edit({ tags })}
            placeholder="Tags, e.g. os lecture"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            style={inputStyle}
            accessibilityLabel="Tags"
          />
          <View style={styles.inline}>
            <Switch value={values.pinned} onValueChange={(pinned) => edit({ pinned })} accessibilityLabel="Pinned" />
            <Text>Pinned</Text>
          </View>
          <View style={styles.inline}>
            <Text style={styles.status} accessibilityLiveRegion="polite">
              {status === 'saved' ? (queue.saved ? 'Saved' : '') : 'Saving…'}
            </Text>
            <View style={styles.spacer} />
            {queue.saved && <Button title="Delete" onPress={() => void remove()} />}
            <Button title="Done" primary onPress={close} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: '600' },
  body: { minHeight: 220 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { color: colors.muted },
  spacer: { flex: 1 },
})
