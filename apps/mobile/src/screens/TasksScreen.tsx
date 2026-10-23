import { parseCapture, type Reminder } from '@cairn/core'
import { formatDue } from '@cairn/ui'
import { useEffect, useRef, useState } from 'react'
import { BackHandler, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated'
import { DoneList } from '../components/DoneList'
import { ReminderList } from '../components/ReminderList'
import { useActions } from '../state/actions'
import { radius, space, useColors } from '../theme'
import { Glyph } from '../ui/icons'
import { appear, fadeIn, fadeOut, sheetIn, sheetOut, Tap } from '../ui/motion'

/** With no date written, a task is for today: due by the end of it, alerting in the morning. */
function today(now: number): number {
  const d = new Date(now)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

export function TasksScreen({
  active,
  now,
  onEdit,
  onSnooze,
  onMore,
}: {
  active: Reminder[]
  now: number
  onEdit: (reminder: Reminder) => void
  onSnooze: (reminder: Reminder) => void
  /** The full form, for repeats and alert times. */
  /** Opens the full editor with whatever quick add had typed. */
  onMore: (text: string) => void
}) {
  const c = useColors()
  const [done, setDone] = useState(false)
  const [adding, setAdding] = useState(false)

  return (
    <View style={styles.screen}>
      <View style={styles.bar}>
        <View style={styles.spacer} />
        <Tap onPress={() => setDone((d) => !d)} scaleTo={0.94} style={[styles.toggle, { backgroundColor: done ? c.surfaceHigh : 'transparent' }]} accessibilityState={{ selected: done }}>
          <Text style={{ color: done ? c.fg : c.muted, fontWeight: done ? '700' : '400' }}>Completed</Text>
        </Tap>
      </View>
      <Text style={[styles.heading, { color: c.fg }]}>Tasks</Text>

      <View style={styles.body}>
        {done ? (
          <DoneList now={now} />
        ) : active.length === 0 ? (
          <Animated.View entering={fadeIn} style={styles.empty}>
            <View style={[styles.emptyIcon, { backgroundColor: c.surface }]}>
              <View style={[styles.emptyBack, { backgroundColor: c.surfaceHigh }]} />
              <Glyph char="☑" color={c.faint} size={34} />
            </View>
            <Text style={[styles.emptyText, { color: c.muted }]}>No tasks here yet</Text>
          </Animated.View>
        ) : (
          <ReminderList reminders={active} now={now} onEdit={onEdit} onSnooze={onSnooze} />
        )}
      </View>

      {!adding && (
        <Tap onPress={() => setAdding(true)} scaleTo={0.92} haptic="light" style={[styles.fab, { backgroundColor: c.accent }]} accessibilityLabel="New task">
          <Glyph char="+" color={c.onAccent} size={34} />
        </Tap>
      )}

      {adding && <QuickAdd now={now} onClose={() => setAdding(false)} onMore={onMore} />}
    </View>
  )
}

/**
 * One line, read as it is typed. Whatever date Cairn found is shown before
 * anything is saved, so a misread "may" is caught on screen, not at 9am.
 */
function QuickAdd({ now, onClose, onMore }: { now: number; onClose: () => void; onMore: (text: string) => void }) {
  const c = useColors()
  const actions = useActions()
  const [text, setText] = useState('')
  const input = useRef<TextInput>(null)
  const parsed = text.trim() ? parseCapture(text, now) : null
  const dueAt = parsed?.dueAt ?? today(now)
  const allDay = parsed?.dueAt !== undefined ? parsed.allDay : true
  // The sheet sits on top of the keyboard and moves with it.
  const keyboard = useAnimatedKeyboard()
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -keyboard.height.value }] }))

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose()
      return true
    })
    return () => sub.remove()
  }, [onClose])

  const add = async (keepOpen: boolean) => {
    if (!parsed) return
    const created = await actions.addReminder({
      title: parsed.title || text.trim(),
      dueAt,
      allDay,
      rrule: parsed.rrule,
      priority: parsed.priority,
      tags: parsed.tags,
    })
    if (!created) return
    setText('')
    if (keepOpen) input.current?.focus()
    else onClose()
  }

  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Tap onPress={onClose} scaleTo={1} haptic="none" style={styles.flex}>
        <View />
      </Tap>
      <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }, lift]}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          autoFocus
          placeholder="e.g. Submit lab report friday 5pm"
          placeholderTextColor={c.faint}
          style={[styles.input, { color: c.fg }]}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={() => void add(true)}
          accessibilityLabel="New task"
        />
        <View style={styles.sheetFoot}>
          <Animated.View key={`${dueAt}-${allDay}`} entering={appear} style={[styles.when, { backgroundColor: c.accent + '22', borderColor: c.accent }]}>
            <Text style={{ color: c.accent, fontWeight: '600' }}>{formatDue(dueAt, allDay, now)}</Text>
            {parsed?.priority === 'high' && <Text style={{ color: c.accent }}> · High</Text>}
            {parsed?.rrule && <Text style={{ color: c.accent }}> · Repeats</Text>}
          </Animated.View>
          <View style={styles.spacer} />
          <Tap
            onPress={() => {
              onClose()
              onMore(text)
            }}
            scaleTo={0.94}
            style={styles.more}
          >
            <Text style={{ color: c.muted }}>More</Text>
          </Tap>
          <Tap onPress={() => void add(false)} disabled={!parsed} scaleTo={0.94} haptic="medium" style={[styles.addButton, { backgroundColor: c.accent }]}>
            <Text style={{ color: c.onAccent, fontWeight: '700' }}>Add</Text>
          </Tap>
        </View>
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, height: 56 },
  toggle: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: 16 },
  heading: { fontSize: 40, fontWeight: '300', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.sm },
  body: { flex: 1, paddingHorizontal: space.lg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingBottom: 120 },
  emptyIcon: { width: 92, height: 92, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  emptyBack: { position: 'absolute', right: -14, bottom: -14, width: 80, height: 80, borderRadius: 16, zIndex: -1 },
  emptyText: { fontSize: 18 },
  fab: {
    position: 'absolute',
    right: space.xl,
    bottom: space.xl,
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  scrim: { backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.lg, paddingBottom: space.lg, gap: space.md },
  input: { fontSize: 18, paddingVertical: space.sm },
  sheetFoot: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  when: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space.md, paddingVertical: 6 },
  more: { paddingHorizontal: space.md, paddingVertical: space.sm },
  addButton: { paddingHorizontal: space.xl, paddingVertical: space.sm + 2, borderRadius: 20 },
})
