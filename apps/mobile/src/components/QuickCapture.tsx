import { describeRecurrence, parseCapture, type CaptureResult } from '@cairn/core'
import { formatDue } from '@cairn/ui'
import { useMemo, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useActions } from '../state/actions'
import { colors } from '../theme'
import { Button } from './controls'

/**
 * The way most things get into Cairn: a title line and a body under it.
 * The title is read for a date, a repeat, tags and priority, and Cairn
 * decides from that whether what you wrote is a reminder, a note, or both.
 */
export function QuickCapture({ onCaptured }: { onCaptured?: (result: CaptureResult | null) => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const bodyRef = useRef<TextInput>(null)
  const actions = useActions()

  const preview = useMemo(() => (title.trim() ? parseCapture(title, Date.now()) : null), [title])
  const empty = !title.trim() && !body.trim()

  const submit = async (literal = false) => {
    if (empty) return
    const result = await actions.capture({ title, body }, literal)
    if (result !== undefined) {
      setTitle('')
      setBody('')
      onCaptured?.(result)
    }
  }

  return (
    <View style={styles.wrap}>
      <TextInput
        value={title}
        onChangeText={setTitle}
        // A one-liner is the common case, so the return key files it.
        onSubmitEditing={() => void submit()}
        submitBehavior="submit"
        returnKeyType="done"
        placeholder="What do you need to remember?"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Title"
        style={styles.title}
      />

      <TextInput
        ref={bodyRef}
        value={body}
        onChangeText={setBody}
        placeholder="Notes (optional)"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Notes"
        style={styles.body}
        multiline
        textAlignVertical="top"
      />

      <View style={styles.foot}>
        <Text style={styles.preview} accessibilityLiveRegion="polite" numberOfLines={2}>
          {preview ? (
            <>
              {preview.kind === 'reminder' ? 'Reminder' : 'Note'}: <Text style={styles.strong}>{preview.title}</Text>
              {preview.dueAt !== undefined && ` · ${formatDue(preview.dueAt, preview.allDay, Date.now())}`}
              {preview.rrule && ` · ${describeRecurrence(preview.rrule)}`}
              {preview.priority !== 'normal' && ` · ${preview.priority} priority`}
              {preview.tags.map((tag) => ` #${tag}`).join('')}
              {preview.kind === 'reminder' && body.trim() ? ' · with your note' : ''}
            </>
          ) : (
            'Add a date to make it a reminder · #tag · !high'
          )}
        </Text>
        <Button title="Add" primary disabled={empty} onPress={() => void submit()} />
      </View>

      {preview && (
        <Pressable onPress={() => void submit(true)} accessibilityRole="button" hitSlop={6}>
          <Text style={styles.literal}>Save the text as-is, as a note</Text>
        </Pressable>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    gap: 2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.fg, paddingVertical: 2 },
  body: { minHeight: 56, fontSize: 15, lineHeight: 21, color: colors.fg, paddingVertical: 2 },
  foot: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6 },
  preview: { flex: 1, color: colors.muted, fontSize: 13 },
  strong: { fontWeight: '700', color: colors.fg },
  literal: { color: colors.muted, textDecorationLine: 'underline', fontSize: 12, marginTop: 6 },
})
