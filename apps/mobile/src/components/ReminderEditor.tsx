import { addLocalDays, buildRecurrence, describeRecurrence, type Priority, type Reminder } from '@cairn/core'
import {
  ALERT_CHOICES,
  applyWhen,
  changesFromDraft,
  draftFromReminder,
  emptyDraft,
  formatDue,
  fromInputs,
  inputFromDraft,
  toDateInput,
  type ReminderDraft,
  type RepeatChoice,
} from '@cairn/ui'
import { useState } from 'react'
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useActions } from '../state/actions'
import { colors } from '../theme'
import { Button, Chip, Field, inputStyle } from './controls'

const REPEATS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]
const PRIORITIES: Priority[] = ['low', 'normal', 'high']

export function ReminderEditor({ reminder, now, onClose }: { reminder?: Reminder; now: number; onClose: () => void }) {
  const actions = useActions()
  const [draft, setDraft] = useState<ReminderDraft>(() => (reminder ? draftFromReminder(reminder) : emptyDraft(now)))
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ReminderDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const applyWhenText = () => {
    if (!when.trim()) return
    const next = applyWhen(draft, when, Date.now())
    if (next) {
      setDraft(next)
      setWhen('')
      setError(null)
    } else {
      setError(`Couldn't find a date in “${when}”`)
    }
  }

  const save = async () => {
    if (reminder) {
      const result = changesFromDraft(reminder, draft)
      if (!result.ok) return setError(result.error)
      await actions.saveReminder(reminder, result.value)
    } else {
      const result = inputFromDraft(draft)
      if (!result.ok) return setError(result.error)
      await actions.addReminder(result.value)
    }
    onClose()
  }

  const dueAt = fromInputs(draft.date, draft.time, 9)
  const customLabel = draft.customRule && dueAt !== null ? describeRecurrence(buildRecurrence(draft.customRule, dueAt)) : null
  const schedule =
    dueAt === null
      ? 'Check the date and time'
      : [formatDue(dueAt, draft.time.trim() === '', Date.now()), customLabel ?? REPEATS.find((r) => r.value === draft.repeat && r.value !== 'none')?.label]
          .filter(Boolean)
          .join(' · ')

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.heading} accessibilityRole="header">
            {reminder ? 'Edit reminder' : 'New reminder'}
          </Text>

          <Field label="Title">
            <TextInput value={draft.title} onChangeText={(title) => set({ title })} autoFocus={!reminder} style={inputStyle} accessibilityLabel="Title" />
          </Field>

          <Field label="When (type it)">
            <TextInput
              value={when}
              onChangeText={setWhen}
              onSubmitEditing={applyWhenText}
              onBlur={applyWhenText}
              placeholder="fri 6pm, tomorrow, every weekday 9am"
              placeholderTextColor={colors.muted}
              style={inputStyle}
              accessibilityLabel="When"
            />
          </Field>
          <Text style={styles.schedule} accessibilityLiveRegion="polite">
            {schedule}
          </Text>

          <Field label="Day">
            <View style={styles.chips}>
              {[
                ['Today', 0],
                ['Tomorrow', 1],
                ['In a week', 7],
              ].map(([label, days]) => {
                const date = toDateInput(addLocalDays(Date.now(), days as number))
                return <Chip key={label} label={label as string} selected={draft.date === date} onPress={() => set({ date })} />
              })}
            </View>
          </Field>

          <Field label="Time (empty for all day)">
            <View style={styles.inline}>
              <TextInput
                value={draft.time}
                onChangeText={(time) => set({ time })}
                placeholder="All day"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                style={[inputStyle, styles.time]}
                accessibilityLabel="Time"
              />
              <Chip label="All day" selected={draft.time.trim() === ''} onPress={() => set({ time: draft.time.trim() ? '' : '09:00' })} />
            </View>
          </Field>

          <Field label="Repeat">
            <View style={styles.chips}>
              {REPEATS.map((r) => (
                <Chip key={r.value} label={r.label} selected={draft.repeat === r.value} onPress={() => set({ repeat: r.value })} />
              ))}
              {customLabel && <Chip label={customLabel} selected={draft.repeat === 'custom'} onPress={() => set({ repeat: 'custom' })} />}
            </View>
          </Field>

          <Field label="Priority">
            <View style={styles.chips}>
              {PRIORITIES.map((p) => (
                <Chip key={p} label={p} selected={draft.priority === p} onPress={() => set({ priority: p })} />
              ))}
            </View>
          </Field>

          <Field label="Alerts">
            <View style={styles.chips}>
              {ALERT_CHOICES.map((c) => {
                const on = draft.alerts.includes(c.minutes)
                return (
                  <Chip
                    key={c.minutes}
                    label={c.label}
                    selected={on}
                    onPress={() => set({ alerts: on ? draft.alerts.filter((m) => m !== c.minutes) : [...draft.alerts, c.minutes] })}
                  />
                )
              })}
            </View>
            {draft.alerts.length === 0 && <Text style={styles.hint}>No alerts. It still shows in your list and widget.</Text>}
          </Field>

          <Field label="Tags">
            <TextInput value={draft.tags} onChangeText={(tags) => set({ tags })} placeholder="dbms uni" placeholderTextColor={colors.muted} style={inputStyle} autoCapitalize="none" accessibilityLabel="Tags" />
          </Field>

          {error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}

          <View style={styles.actions}>
            <Button title="Save" primary onPress={() => void save()} />
            <Button title="Cancel" onPress={onClose} />
            {reminder && (
              <>
                <Button
                  title="Complete"
                  onPress={async () => {
                    await actions.complete(reminder)
                    onClose()
                  }}
                />
                <Button
                  title="Delete"
                  onPress={async () => {
                    await actions.removeReminder(reminder)
                    onClose()
                  }}
                />
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, gap: 14 },
  heading: { fontSize: 20, fontWeight: '700', color: colors.fg },
  schedule: { color: colors.fg, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  time: { width: 110 },
  hint: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
})
