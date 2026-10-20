import type { Note } from '@cairn/core'
import {
  canRedo,
  canUndo,
  createHistory,
  createNoteSaveQueue,
  edit as recordEdit,
  noteCharacterCount,
  noteTimestamp,
  redo,
  undo,
  type History,
} from '@cairn/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useActions } from '../state/actions'
import { colors } from '../theme'

const AUTOSAVE_MS = 800

/** The text under undo/redo. Tags and pinning are settings, not writing. */
interface Text_ {
  title: string
  body: string
}

/**
 * A full-screen writing surface: title, a date and length line, then the note
 * itself filling the rest. Saves on a pause and again on the way out, so
 * leaving by the back gesture never loses anything.
 */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
  const [queue] = useState(() => createNoteSaveQueue(actions, note))
  const [history, setHistory] = useState<History<Text_>>(() =>
    createHistory({ title: note?.title ?? '', body: note?.body ?? '' }, Date.now()),
  )
  const [tags, setTags] = useState(note?.tags.join(' ') ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [status, setStatus] = useState<'saved' | 'unsaved'>('saved')
  const [showTags, setShowTags] = useState(Boolean(note?.tags.length))
  // Only steal the caret when the field is opened by hand; a note that
  // already has tags should still put the caret in the note itself.
  const [tagsJustOpened, setTagsJustOpened] = useState(false)
  const bodyRef = useRef<TextInput>(null)
  const text = history.present

  const push = useCallback(
    (next: History<Text_>, extra?: { tags?: string; pinned?: boolean }) => {
      setHistory(next)
      queue.change({
        title: next.present.title,
        body: next.present.body,
        tags: extra?.tags ?? tags,
        pinned: extra?.pinned ?? pinned,
      })
      setStatus('unsaved')
    },
    [queue, tags, pinned],
  )

  const change = (patch: Partial<Text_>) => push(recordEdit(history, { ...text, ...patch }, Date.now()))

  useEffect(() => {
    if (!queue.dirty) return
    const timer = setTimeout(() => {
      void queue.save().then(() => {
        if (!queue.dirty) setStatus('saved')
      })
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [history, tags, pinned, queue])

  const leave = useCallback(() => void queue.save().then(onClose), [queue, onClose])
  const savedAt = queue.saved?.updatedAt ?? note?.updatedAt ?? Date.now()

  return (
    <Modal animationType="slide" onRequestClose={leave}>
      <SafeAreaView style={styles.screen}>
        <View style={styles.bar}>
          <Icon label="Back to notes" glyph="←" onPress={leave} />
          <View style={styles.spacer} />
          <Icon label="Undo" glyph="↶" onPress={() => push(undo(history, Date.now()))} disabled={!canUndo(history)} />
          <Icon label="Redo" glyph="↷" onPress={() => push(redo(history, Date.now()))} disabled={!canRedo(history)} />
          <Icon
            label={pinned ? 'Unpin note' : 'Pin note'}
            glyph={pinned ? '★' : '☆'}
            selected={pinned}
            onPress={() => {
              const next = !pinned
              setPinned(next)
              push(history, { pinned: next })
            }}
          />
          <Icon label="Done" glyph="✓" onPress={leave} />
        </View>

        <KeyboardAvoidingView
          style={styles.sheet}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TextInput
            value={text.title}
            onChangeText={(title) => change({ title })}
            onSubmitEditing={() => bodyRef.current?.focus()}
            placeholder="Title"
            placeholderTextColor={colors.faint}
            style={styles.title}
            submitBehavior="submit"
            returnKeyType="next"
            accessibilityLabel="Title"
            autoFocus={!note}
          />

          <View style={styles.meta}>
            <Text style={styles.metaText}>{noteTimestamp(savedAt)}</Text>
            <Text style={styles.metaText}>|</Text>
            <Text style={styles.metaText}>{noteCharacterCount(text.title, text.body)}</Text>
            <View style={styles.spacer} />
            <Text style={styles.metaText} accessibilityLiveRegion="polite">
              {status === 'unsaved' ? 'Saving…' : queue.saved ? 'Saved' : ''}
            </Text>
          </View>

          <TextInput
            ref={bodyRef}
            value={text.body}
            onChangeText={(body) => change({ body })}
            placeholder="Start typing"
            placeholderTextColor={colors.faint}
            style={styles.body}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Note"
            autoFocus={Boolean(note)}
          />

          <View style={styles.foot}>
            {showTags ? (
              <TextInput
                value={tags}
                onChangeText={(next) => {
                  setTags(next)
                  push(history, { tags: next })
                }}
                placeholder="Tags, separated by spaces"
                placeholderTextColor={colors.faint}
                style={styles.tags}
                autoCapitalize="none"
                accessibilityLabel="Tags"
                autoFocus={tagsJustOpened}
              />
            ) : (
              <Pressable
                onPress={() => {
                  setTagsJustOpened(true)
                  setShowTags(true)
                }}
                accessibilityRole="button"
                hitSlop={8}
              >
                <Text style={styles.quiet}>Add tags</Text>
              </Pressable>
            )}
            <View style={styles.spacer} />
            {queue.saved && (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={async () => {
                  await actions.removeNote(queue.saved!)
                  onClose()
                }}
              >
                <Text style={styles.quiet}>Delete</Text>
              </Pressable>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  )
}

function Icon({
  label,
  glyph,
  onPress,
  disabled,
  selected,
}: {
  label: string
  glyph: string
  onPress: () => void
  disabled?: boolean
  selected?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected }}
      hitSlop={6}
      style={[styles.icon, disabled && styles.iconDisabled]}
    >
      <Text style={styles.iconGlyph}>{glyph}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, paddingVertical: 6 },
  spacer: { flex: 1 },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  iconDisabled: { opacity: 0.3 },
  iconGlyph: { fontSize: 18, color: colors.fg },
  sheet: { flex: 1, paddingHorizontal: 20, paddingBottom: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.fg, paddingVertical: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 10 },
  metaText: { color: colors.muted, fontSize: 12 },
  body: { flex: 1, fontSize: 16, lineHeight: 24, color: colors.fg },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 },
  tags: { flex: 1, color: colors.muted, fontSize: 14, paddingVertical: 4 },
  quiet: { color: colors.muted, fontSize: 14 },
})
