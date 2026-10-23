import { addLocalDays, buildRecurrence, describeRecurrence, type Priority, type Reminder } from '@cairn/core'
import {
  ALERT_CHOICES,
  applyWhen,
  changesFromDraft,
  draftFromReminder,
  draftFromText,
  emptyDraft,
  formatDue,
  fromInputs,
  inputFromDraft,
  parseTimeInput,
  toDateInput,
  type ReminderDraft,
  type RepeatChoice,
} from '@cairn/ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useActions } from '../state/actions'
import { radius, space, useColors } from '../theme'
import { Glyph, TrashIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, sheetIn, sheetOut, Tap } from '../ui/motion'

const REPEATS: { value: RepeatChoice; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
]
const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
]
const TIMES = ['09:00', '12:00', '18:00', '21:00']
const ALERT_SHORT: Record<number, string> = { 0: 'On time', 10: '10 min before', 60: '1 hour before', [24 * 60]: '1 day before' }

/**
 * A task, full page, laid out like the note editor: the title large at the
 * top, then when it is due — typed in plain words or picked from a few
 * likely choices — then everything else, and the details underneath.
 *
 * Leaving saves, the way leaving a note does. A new task with nothing typed
 * leaves nothing behind; one that cannot be saved says why and stays open.
 */
export function TaskEditorScreen({
  reminder,
  text,
  now,
  onClose,
}: {
  reminder?: Reminder
  /** What was typed in quick add before asking for more. */
  text?: string
  now: number
  onClose: () => void
}) {
  const c = useColors()
  const actions = useActions()
  const [draft, setDraft] = useState<ReminderDraft>(() =>
    reminder ? draftFromReminder(reminder) : text?.trim() ? draftFromText(text, now) : emptyDraft(now),
  )
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [repeatSheet, setRepeatSheet] = useState(false)
  const [time, setTime] = useState(draft.time)
  const leaving = useRef(false)
  const set = (patch: Partial<ReminderDraft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setError(null)
  }

  const applyWhenText = (text = when) => {
    if (!text.trim()) return
    const next = applyWhen(draft, text, Date.now())
    if (next) {
      setDraft({ ...next, title: draft.title, body: draft.body })
      setTime(next.time)
      setWhen('')
      setError(null)
    } else {
      setError(`Couldn't find a date in “${text}”`)
    }
  }

  const close = async () => {
    if (leaving.current) return
    Keyboard.dismiss()
    // Plain words typed but not yet applied count as the schedule.
    const current = when.trim() ? (applyWhen(draft, when, Date.now()) ?? draft) : draft
    if (!reminder && !current.title.trim() && !current.body.trim()) return onClose()
    const save = reminder
      ? (() => {
          const result = changesFromDraft(reminder, current)
          return result.ok ? () => actions.saveReminder(reminder, result.value) : result.error
        })()
      : (() => {
          const result = inputFromDraft(current)
          return result.ok ? () => actions.addReminder(result.value) : result.error
        })()
    if (typeof save === 'string') return setError(save)
    leaving.current = true
    try {
      await save()
    } finally {
      onClose()
    }
  }
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (repeatSheet) setRepeatSheet(false)
      else void closeRef.current()
      return true
    })
    return () => sub.remove()
  }, [repeatSheet])

  const dueAt = fromInputs(draft.date, draft.time, 9)
  const customLabel = draft.customRule && dueAt !== null ? describeRecurrence(buildRecurrence(draft.customRule, dueAt)) : null
  const repeatLabel = draft.repeat === 'custom' ? (customLabel ?? 'Custom') : REPEATS.find((r) => r.value === draft.repeat)?.label ?? 'Never'
  const schedule = dueAt === null ? 'Pick a day' : formatDue(dueAt, draft.time.trim() === '', Date.now())
  const days: [string, number][] = [
    ['Today', 0],
    ['Tomorrow', 1],
    ['Next week', 7],
  ]

  const keyboard = useAnimatedKeyboard()
  const insets = useSafeAreaInsets()
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.value - insets.bottom) }))

  return (
    <Animated.View style={[styles.flex, lift]}>
      <View style={styles.bar}>
        <IconTap label="Back" onPress={() => void close()}>
          <Glyph char="←" color={c.fg} />
        </IconTap>
        <View style={styles.flex} />
        {reminder && (
          <IconTap
            label="Delete task"
            onPress={async () => {
              leaving.current = true
              await actions.removeReminder(reminder)
              onClose()
            }}
          >
            <TrashIcon color={c.fg} />
          </IconTap>
        )}
        <IconTap label="Save" onPress={() => void close()}>
          <Glyph char="✓" color={c.fg} weight="600" />
        </IconTap>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TextInput
          value={draft.title}
          onChangeText={(title) => set({ title })}
          placeholder="Task"
          placeholderTextColor={c.faint}
          style={[styles.title, { color: c.fg }]}
          autoFocus={!reminder}
          multiline
          submitBehavior="blurAndSubmit"
          returnKeyType="next"
          accessibilityLabel="Title"
        />

        <Animated.View key={schedule + repeatLabel} entering={fadeIn} style={styles.scheduleRow}>
          <Text style={[styles.schedule, { color: dueAt === null ? c.danger : c.accent }]} accessibilityLiveRegion="polite">
            {schedule}
          </Text>
          {draft.repeat !== 'none' && <Text style={[styles.scheduleRepeat, { color: c.muted }]}>· {repeatLabel}</Text>}
        </Animated.View>

        <TextInput
          value={when}
          onChangeText={setWhen}
          onSubmitEditing={() => applyWhenText()}
          onBlur={() => applyWhenText()}
          placeholder="Type when: fri 6pm, in 3 days, every weekday 9am"
          placeholderTextColor={c.faint}
          style={[styles.when, { color: c.fg, backgroundColor: c.surface }]}
          returnKeyType="done"
          accessibilityLabel="When, in words"
        />

        <Group title="Day">
          {days.map(([label, n]) => {
            const date = toDateInput(addLocalDays(Date.now(), n))
            return <Choice key={label} label={label} on={draft.date === date} onPress={() => set({ date })} />
          })}
        </Group>

        <Group title="Time">
          <Choice
            label="All day"
            on={draft.time.trim() === ''}
            onPress={() => {
              set({ time: '' })
              setTime('')
            }}
          />
          {TIMES.map((t) => (
            <Choice
              key={t}
              label={t}
              on={draft.time === t}
              onPress={() => {
                set({ time: t })
                setTime(t)
              }}
            />
          ))}
          <TextInput
            value={time}
            onChangeText={(text) => {
              setTime(text)
              if (!text.trim() || parseTimeInput(text)) set({ time: text.trim() })
            }}
            placeholder="hh:mm"
            placeholderTextColor={c.faint}
            keyboardType="numbers-and-punctuation"
            style={[styles.timeInput, { color: c.fg, borderColor: time && !parseTimeInput(time) ? c.danger : c.line }]}
            accessibilityLabel="Exact time"
          />
        </Group>

        <Tap onPress={() => setRepeatSheet(true)} scaleTo={0.985} style={[styles.row, { borderColor: c.line }]} accessibilityRole="button" accessibilityLabel={`Repeat, ${repeatLabel}`}>
          <Text style={[styles.rowTitle, { color: c.fg }]}>Repeat</Text>
          <Text style={[styles.rowValue, { color: c.muted }]} numberOfLines={1}>
            {repeatLabel}
          </Text>
          <Glyph char="›" color={c.muted} size={24} />
        </Tap>

        <Group title="Priority">
          {PRIORITIES.map((p) => (
            <Choice key={p.value} label={p.label} on={draft.priority === p.value} tone={p.value === 'high' ? 'danger' : undefined} onPress={() => set({ priority: p.value })} />
          ))}
        </Group>

        <Group title="Alerts">
          {ALERT_CHOICES.map((a) => {
            const on = draft.alerts.includes(a.minutes)
            return (
              <Choice
                key={a.minutes}
                label={ALERT_SHORT[a.minutes] ?? a.label}
                on={on}
                onPress={() => set({ alerts: on ? draft.alerts.filter((m) => m !== a.minutes) : [...draft.alerts, a.minutes] })}
              />
            )
          })}
        </Group>
        {draft.alerts.length === 0 && <Text style={[styles.hint, { color: c.muted }]}>No alerts. It still shows in Tasks.</Text>}

        <Group title="Folder">
          <TextInput
            value={draft.tags}
            onChangeText={(tags) => set({ tags })}
            placeholder="None yet. Type one, like study"
            placeholderTextColor={c.faint}
            autoCapitalize="none"
            style={[styles.tags, { color: c.fg, backgroundColor: c.surface }]}
            accessibilityLabel="Folders, separated by spaces"
          />
        </Group>

        <Text style={[styles.groupTitle, { color: c.muted }]}>Details</Text>
        <TextInput
          value={draft.body}
          onChangeText={(body) => set({ body })}
          placeholder="Notes, links, what it's for"
          placeholderTextColor={c.faint}
          style={[styles.details, { color: c.fg }]}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          accessibilityLabel="Details"
        />

        {error && (
          <Animated.Text entering={appear} style={[styles.error, { color: c.danger }]} accessibilityRole="alert">
            {error}
          </Animated.Text>
        )}

        {reminder && reminder.status !== 'done' && (
          <Tap
            onPress={async () => {
              leaving.current = true
              await actions.complete(reminder)
              onClose()
            }}
            scaleTo={0.96}
            haptic="medium"
            style={[styles.done, { borderColor: c.accent }]}
            accessibilityRole="button"
          >
            <Glyph char="✓" color={c.accent} size={18} weight="700" />
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 16 }}>Mark done</Text>
          </Tap>
        )}
      </ScrollView>

      {repeatSheet && (
        <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Tap onPress={() => setRepeatSheet(false)} scaleTo={1} haptic="none" style={styles.flex} accessibilityLabel="Close">
            <View />
          </Tap>
          <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }]}>
            <Text style={[styles.sheetTitle, { color: c.fg }]}>Repeat</Text>
            {[...REPEATS, ...(customLabel ? [{ value: 'custom' as const, label: customLabel }] : [])].map((r) => (
              <Tap
                key={r.value}
                onPress={() => {
                  set({ repeat: r.value })
                  setRepeatSheet(false)
                }}
                scaleTo={0.98}
                style={styles.sheetRow}
              >
                <Text style={{ color: draft.repeat === r.value ? c.accent : c.fg, fontSize: 17, flex: 1, fontWeight: draft.repeat === r.value ? '600' : '400' }}>{r.label}</Text>
                {draft.repeat === r.value && <Glyph char="✓" color={c.accent} size={18} />}
              </Tap>
            ))}
            <Text style={[styles.hint, { color: c.muted }]}>For anything else, type it above: “every other week”, “every mon and thu 7pm”.</Text>
          </Animated.View>
        </Animated.View>
      )}
    </Animated.View>
  )
}

function IconTap({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Tap onPress={onPress} scaleTo={0.92} hitSlop={6} style={styles.icon} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Tap>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const c = useColors()
  return (
    <View style={styles.group}>
      <Text style={[styles.groupTitle, { color: c.muted }]}>{title}</Text>
      <View style={styles.choices}>{children}</View>
    </View>
  )
}

function Choice({ label, on, onPress, tone }: { label: string; on: boolean; onPress: () => void; tone?: 'danger' }) {
  const c = useColors()
  const color = tone === 'danger' ? c.danger : c.accent
  return (
    <Tap
      onPress={onPress}
      scaleTo={0.94}
      style={[styles.choice, { backgroundColor: on ? color + '26' : c.surface, borderColor: on ? color : 'transparent' }]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={{ color: on ? color : c.fg, fontWeight: on ? '700' : '400', fontSize: 15 }}>{label}</Text>
    </Tap>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.xs, gap: space.xs },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  page: { paddingHorizontal: space.xl, paddingBottom: 80, gap: space.md },
  title: { fontSize: 30, fontWeight: '700', paddingVertical: space.sm },
  scheduleRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 6, marginTop: -space.sm },
  schedule: { fontSize: 18, fontWeight: '700' },
  scheduleRepeat: { fontSize: 16 },
  when: { borderRadius: radius.chip, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  group: { gap: space.sm },
  groupTitle: { fontSize: 14, paddingTop: space.xs },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'center' },
  choice: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space.lg, paddingVertical: 8 },
  timeInput: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space.md, paddingVertical: 6, minWidth: 76, fontSize: 15, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  rowValue: { flex: 1, textAlign: 'right', fontSize: 16 },
  tags: { flex: 1, borderRadius: radius.chip, paddingHorizontal: space.lg, paddingVertical: space.sm, fontSize: 16 },
  details: { fontSize: 17, lineHeight: 25, minHeight: 140, padding: 0 },
  hint: { fontSize: 13, lineHeight: 18 },
  error: { fontSize: 15 },
  done: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, borderWidth: 1.5, borderRadius: 24, height: 48, marginTop: space.md },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.lg, paddingBottom: space.xl, gap: 2 },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: space.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
})
