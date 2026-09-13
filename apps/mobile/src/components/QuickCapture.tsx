import { describeRecurrence, parseCapture, type CaptureResult } from '@cairn/core'
import { formatDue } from '@cairn/ui'
import { useMemo, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { useActions } from '../state/actions'
import { colors } from '../theme'
import { Button, inputStyle } from './controls'

export function QuickCapture({ onCaptured }: { onCaptured?: (result: CaptureResult | null) => void }) {
  const [text, setText] = useState('')
  const actions = useActions()
  const preview = useMemo(() => (text.trim() ? parseCapture(text, Date.now()) : null), [text])

  const submit = async (literal = false) => {
    if (!text.trim()) return
    const result = await actions.capture(text, literal)
    if (result !== undefined) {
      setText('')
      onCaptured?.(result)
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <TextInput
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => void submit()}
          submitBehavior="submit"
          returnKeyType="done"
          placeholder="Add a reminder or note, e.g. quiz friday 9am"
          placeholderTextColor={colors.muted}
          accessibilityLabel="Quick capture"
          style={[inputStyle, styles.input]}
        />
        <Button title="Add" primary disabled={!text.trim()} onPress={() => void submit()} />
      </View>
      <Text style={styles.preview} accessibilityLiveRegion="polite">
        {preview ? (
          <>
            {preview.kind === 'reminder' ? 'Reminder' : 'Note'}: <Text style={styles.strong}>{preview.title}</Text>
            {preview.dueAt !== undefined && ` · ${formatDue(preview.dueAt, preview.allDay, Date.now())}`}
            {preview.rrule && ` · ${describeRecurrence(preview.rrule)}`}
            {preview.priority !== 'normal' && ` · ${preview.priority} priority`}
            {preview.tags.map((tag) => ` #${tag}`).join('')}
          </>
        ) : (
          '#tag · !high · “quotes” are never read as dates'
        )}
      </Text>
      {preview && (
        <Text style={styles.hint} onPress={() => void submit(true)} accessibilityRole="button">
          Save the text as-is, as a note
        </Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1 },
  preview: { color: colors.muted },
  strong: { fontWeight: '700', color: colors.fg },
  hint: { color: colors.muted, textDecorationLine: 'underline', fontSize: 13 },
})
