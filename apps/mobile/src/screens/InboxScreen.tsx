import { inboxTaskId } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatDue } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { openMessage } from '../platform/mail'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { dueOf, isImportant, tagsOf, useInbox, type InboxEntry } from '../state/inbox'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { MailIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, reflow, settle, Tap } from '../ui/motion'

const EVERY_TASK: ReminderQuery = {}

/** The chips across the top. Folders come from the mail itself, so they appear as mail arrives. */
type Filter = { kind: 'important' } | { kind: 'folder'; name: string } | { kind: 'rest' }

function sender(from: string): string {
  return from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || from
}

function ago(t: number, now: number): string {
  const minutes = Math.round((now - t) / 60000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function same(a: Filter, b: Filter): boolean {
  return a.kind === b.kind && (a.kind !== 'folder' || a.name === (b as { name: string }).name)
}

/**
 * Mail and Classroom, sorted. With an AI key, every new email, assignment
 * and announcement is read whole and filed: Important collects what needs
 * attention, folders such as Hackathons or Jobs gather what belongs
 * together, and the rest waits under Everything else rather than vanishing.
 * A deadline or a set time waits for a tap on Add as task, which puts it in
 * Tasks at that time, with the model's tags.
 */
export function InboxScreen({ onSettings }: { onSettings: () => void }) {
  const c = useColors()
  const toast = useToast()
  const { auth, accounts, reminders } = useCairn()
  const inbox = useInbox()
  const tasks = useObserved(reminders, EVERY_TASK)
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const [filter, setFilter] = useState<Filter>({ kind: 'important' })
  const now = Date.now()

  // Opening the Inbox is seeing what is in it.
  const { markSeen } = inbox
  useEffect(() => markSeen(), [markSeen, inbox.found.length])

  const visible = inbox.found.filter((e) => !inbox.dismissed.has(e.message.id))
  const important = visible.filter(isImportant)
  const rest = visible.filter((e) => !isImportant(e))
  const folders = inbox.folders.filter((f) => visible.some((e) => e.triage?.folder === f))
  const current = filter.kind === 'folder' && !folders.includes(filter.name) ? ({ kind: 'important' } as Filter) : filter
  const shown = current.kind === 'important' ? important : current.kind === 'rest' ? rest : visible.filter((e) => e.triage?.folder === current.name)

  const mark = (entry: InboxEntry, rule: 'important' | 'unimportant') => {
    inbox.mark(entry, rule)
    toast({
      message: rule === 'unimportant' ? `Mail from ${sender(entry.message.from)} will skip Important` : `Mail from ${sender(entry.message.from)} will stay in Important`,
      action: { label: 'Undo', run: () => inbox.mark(entry, rule === 'important' ? 'unimportant' : 'important') },
    })
  }

  const empty = (title: string, detail: string, action?: { label: string; run: () => void }) => (
    <Animated.View entering={fadeIn} style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: c.surface }]}>
        <MailIcon color={c.faint} size={40} />
      </View>
      <Text style={[styles.emptyTitle, { color: c.fg }]}>{title}</Text>
      <Text style={[styles.emptyDetail, { color: c.muted }]}>{detail}</Text>
      {action && (
        <Tap onPress={action.run} scaleTo={0.94} haptic="light" style={[styles.cta, { backgroundColor: c.accent }]}>
          <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 16 }}>{action.label}</Text>
        </Tap>
      )}
    </Animated.View>
  )

  if (accounts.length === 0 || inbox.readable.length === 0) {
    return (
      <View style={styles.screen}>
        <View style={styles.bar} />
        <Text style={[styles.heading, { color: c.fg }]}>Inbox</Text>
        {accounts.length === 0
          ? empty('Your mail, sorted', 'Sign in with Google, then let Cairn read Gmail and Classroom. Important mail is picked out, grouped into folders, and due dates become tasks.', {
              label: 'Set up in Settings',
              run: onSettings,
            })
          : empty('Nothing connected yet', 'Turn on Gmail or Google Classroom for an account in Settings.', { label: 'Open Settings', run: onSettings })}
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      <View style={styles.bar} />
      <Text style={[styles.heading, { color: c.fg }]}>Inbox</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chips}>
        <FilterChip label="Important" count={important.length} on={current.kind === 'important'} onPress={() => setFilter({ kind: 'important' })} />
        {folders.map((name) => (
          <FilterChip
            key={name}
            label={name}
            count={visible.filter((e) => e.triage?.folder === name).length}
            on={same(current, { kind: 'folder', name })}
            onPress={() => setFilter({ kind: 'folder', name })}
          />
        ))}
        {rest.length > 0 && <FilterChip label="Everything else" count={rest.length} on={current.kind === 'rest'} onPress={() => setFilter({ kind: 'rest' })} />}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={() => void inbox.refresh(true)} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}
      >
        {inbox.error && (
          <Animated.View entering={appear} style={[styles.notice, { backgroundColor: c.danger + '22', borderColor: c.danger }]}>
            <Text style={{ color: c.danger }}>{inbox.error}</Text>
          </Animated.View>
        )}
        {inbox.ai.on && inbox.ai.error && (
          <Animated.View entering={appear} style={[styles.notice, { backgroundColor: c.surface, borderColor: c.line }]}>
            <Text style={{ color: c.muted }}>AI sorting paused: {inbox.ai.error} New mail is still checked for deadlines.</Text>
          </Animated.View>
        )}
        {!inbox.ai.on && (
          <Tap onPress={onSettings} scaleTo={0.98} style={[styles.notice, { backgroundColor: c.surface, borderColor: c.line }]} accessibilityRole="button">
            <Text style={{ color: c.fg, fontWeight: '600' }}>Sort mail into folders with AI</Text>
            <Text style={{ color: c.muted, marginTop: 2 }}>Add an NVIDIA API key in Settings and Cairn reads each new email to pick out what matters.</Text>
          </Tap>
        )}
        {auth.status === 'error' && <Text style={[styles.hint, { color: c.danger }]}>{auth.message}</Text>}

        <LayoutAnimationConfig skipEntering>
          {shown.map((entry) => (
            <MailCard
              key={entry.message.id}
              entry={entry}
              showFolder={current.kind !== 'folder'}
              added={taskIds.has(inboxTaskId(entry.message))}
              now={now}
              onAdd={() => {
                void inbox.addAsTask(entry).then(() => toast({ message: 'Added to Tasks' }))
              }}
              onMark={(rule) => mark(entry, rule)}
              onHide={() => inbox.dismiss(entry)}
            />
          ))}
        </LayoutAnimationConfig>

        {!inbox.refreshing && shown.length === 0 && (
          <Text style={[styles.hint, { color: c.muted }]}>
            {current.kind === 'important'
              ? 'Nothing important yet. Cairn reads new mail and Classroom work from the moment you switched them on, and lets you know when something turns up.'
              : 'Nothing here right now.'}
          </Text>
        )}
        {inbox.lastRun && (
          <Text style={[styles.hint, { color: c.faint }]}>
            Checked {ago(inbox.lastRun, now)} ago{inbox.ai.model ? ` · sorted by ${inbox.ai.model}` : ''}
          </Text>
        )}
      </ScrollView>
    </View>
  )
}

function FilterChip({ label, count, on, onPress }: { label: string; count: number; on: boolean; onPress: () => void }) {
  const c = useColors()
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, settle)
  }, [on, fill])
  const pill = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.85 + fill.value * 0.15 }] }))
  return (
    <Tap onPress={onPress} scaleTo={0.92} style={styles.chip} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}, ${count}`}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.chipFill, { backgroundColor: c.surfaceHigh }, pill]} />
      <Text style={[styles.chipText, { color: on ? c.fg : c.muted, fontWeight: on ? '700' : '400' }]}>{label}</Text>
      {count > 0 && <Text style={[styles.chipCount, { color: on ? c.accent : c.faint }]}>{count}</Text>}
    </Tap>
  )
}

function MailCard({
  entry,
  showFolder,
  added,
  now,
  onAdd,
  onMark,
  onHide,
}: {
  entry: InboxEntry
  showFolder: boolean
  added: boolean
  now: number
  onAdd: () => void
  onMark: (rule: 'important' | 'unimportant') => void
  onHide: () => void
}) {
  const c = useColors()
  const { message, triage } = entry
  const important = isImportant(entry)
  const due = dueOf(entry)
  const post = message.classroom
  const summary = triage?.summary ?? message.snippet
  const tags = triage ? tagsOf(entry) : []
  return (
    <Animated.View entering={appear} exiting={fadeOut} layout={reflow}>
      <Tap
        onPress={() => void openMessage(message)}
        onLongPress={onHide}
        scaleTo={0.985}
        haptic="none"
        style={[styles.card, { backgroundColor: c.surface }]}
        accessibilityHint={`Opens in ${post ? 'Classroom' : 'Gmail'}. Long-press to hide.`}
      >
        <View style={styles.cardHead}>
          {showFolder && triage?.folder && (
            <View style={[styles.folder, { backgroundColor: c.accent + '22' }]}>
              <Text style={[styles.folderText, { color: c.accent }]}>{triage.folder}</Text>
            </View>
          )}
          <Text style={[styles.cardMeta, styles.flex, { color: c.muted }]} numberOfLines={1}>
            {post ? `${post.kind === 'work' ? 'Classroom work' : 'Classroom'} · ${post.course}` : sender(message.from)} · {ago(message.receivedAt, now)}
          </Text>
        </View>
        <Text style={[styles.cardTitle, { color: c.fg }]} numberOfLines={2}>
          {message.subject || '(no subject)'}
        </Text>
        {!!summary && (
          <Text style={[styles.summary, { color: c.muted }]} numberOfLines={3}>
            {summary}
          </Text>
        )}
        {important && triage?.why && <Text style={[styles.why, { color: c.fg }]}>{triage.why}</Text>}
        {tags.length > 0 && (
          <Text style={[styles.tags, { color: c.faint }]} numberOfLines={1}>
            {tags.map((t) => `#${t}`).join('  ')}
          </Text>
        )}
        {due && (
          <View style={[styles.due, { borderColor: c.accent }]}>
            <Text style={{ color: c.accent, fontWeight: '600' }} numberOfLines={1}>
              {due.title} · {formatDue(due.dueAt, due.allDay, now)}
            </Text>
          </View>
        )}
        <View style={[styles.cardFoot, { marginTop: space.xs }]}>
          <Tap onPress={() => onMark(important ? 'unimportant' : 'important')} scaleTo={0.92} style={styles.link}>
            <Text style={{ color: c.muted }}>{important ? 'Not important' : 'Important'}</Text>
          </Tap>
          <View style={styles.spacer} />
          {added ? (
            <Text style={{ color: c.faint }}>✓ In Tasks</Text>
          ) : (
            due && (
              <Tap onPress={onAdd} scaleTo={0.92} haptic="medium" style={[styles.add, { backgroundColor: c.accent }]}>
                <Text style={{ color: c.onAccent, fontWeight: '700' }}>Add as task</Text>
              </Tap>
            )
          )}
        </View>
      </Tap>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  bar: { height: 56 },
  heading: { fontSize: 40, fontWeight: '300', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
  chipsRow: { flexGrow: 0, height: 48, marginBottom: space.sm },
  chips: { paddingHorizontal: space.lg, gap: space.xs, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: space.lg, gap: 6 },
  chipText: { fontSize: 16, lineHeight: 22, includeFontPadding: false },
  chipCount: { fontSize: 13, lineHeight: 18, includeFontPadding: false, fontVariant: ['tabular-nums'] },
  chipFill: { borderRadius: 16 },
  body: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md },
  card: { borderRadius: radius.card + 4, padding: space.lg, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardMeta: { fontSize: 13 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  summary: { fontSize: 15, lineHeight: 21 },
  why: { fontSize: 13, fontWeight: '600' },
  tags: { fontSize: 13 },
  folder: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  folderText: { fontSize: 12, fontWeight: '700' },
  due: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space.md, paddingVertical: 4, marginTop: 2, maxWidth: '100%' },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  link: { paddingVertical: 6, paddingRight: space.sm },
  add: { paddingVertical: 8, paddingHorizontal: space.lg, borderRadius: 18 },
  notice: { borderWidth: 1, borderRadius: 12, padding: space.md },
  hint: { textAlign: 'center', fontSize: 13, paddingVertical: space.lg },
  empty: { alignItems: 'center', paddingHorizontal: space.xl, paddingTop: 100, gap: space.md },
  emptyIcon: { width: 88, height: 88, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  emptyTitle: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  emptyDetail: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  cta: { marginTop: space.md, paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: 24 },
})
