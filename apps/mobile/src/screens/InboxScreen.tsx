import { dueOf, inboxTaskId, isImportant, tagsOf, type InboxRecord, type SenderRule } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatAgo, formatDue, readerStatus } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { AccountChips, FilterChip } from '../components/Chips'
import { PausedNotice } from '../components/PausedNotice'
import { SyncButton } from '../components/SyncButton'
import { openMessage } from '../platform/mail'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { useInbox } from '../state/inbox'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { GearIcon, MailIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, reflow, Tap } from '../ui/motion'

const EVERY_TASK: ReminderQuery = {}

/** The chips across the top. Folders come from the mail itself, so they appear as mail arrives. */
type Filter = { kind: 'important' } | { kind: 'folder'; name: string } | { kind: 'rest' }

export function sender(from: string): string {
  return from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || from
}

function same(a: Filter, b: Filter): boolean {
  return a.kind === b.kind && (a.kind !== 'folder' || a.name === (b as { name: string }).name)
}

/**
 * Gmail, sorted. Cairn's server reads new mail every ten minutes and, with
 * an AI key, files it: Important collects what needs attention, folders such
 * as Hackathons or Jobs gather what belongs together, and the rest waits
 * under Everything else rather than vanishing. The computer shows the same.
 */
export function InboxScreen({ onSettings }: { onSettings: () => void }) {
  const c = useColors()
  const toast = useToast()
  const { auth, reminders } = useCairn()
  const inbox = useInbox()
  const tasks = useObserved(reminders, EVERY_TASK)
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const [filter, setFilter] = useState<Filter>({ kind: 'important' })
  const [account, setAccount] = useState<string | null>(null)
  const now = Date.now()

  // Opening the Inbox is seeing what is in it.
  const { markSeen } = inbox
  useEffect(() => markSeen('inbox'), [markSeen, inbox.mail.length])

  const picked = account && inbox.mailAccounts.accounts.includes(account) ? account : null
  const visible = picked ? inbox.mail.filter((r) => r.account === picked) : inbox.mail
  const important = visible.filter((r) => isImportant(r, inbox.senders))
  const rest = visible.filter((r) => !isImportant(r, inbox.senders))
  const folders = inbox.folders.filter((f) => visible.some((r) => r.triage?.folder === f))
  const current = filter.kind === 'folder' && !folders.includes(filter.name) ? ({ kind: 'important' } as Filter) : filter
  const shown = current.kind === 'important' ? important : current.kind === 'rest' ? rest : visible.filter((r) => r.triage?.folder === current.name)

  const mark = (record: InboxRecord, rule: SenderRule) => {
    void inbox.mark(record, rule)
    toast({
      message: rule === 'unimportant' ? `Mail from ${sender(record.from)} will skip Important` : `Mail from ${sender(record.from)} will stay in Important`,
      action: { label: 'Undo', run: () => void inbox.mark(record, rule === 'important' ? 'unimportant' : 'important') },
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

  const bar = (
    <View style={styles.bar}>
      {inbox.signedIn && <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onPress={() => void inbox.refresh()} label="Check mail now" caption="after" />}
      <View style={styles.spacer} />
      <Tap onPress={onSettings} scaleTo={0.92} style={styles.icon} accessibilityLabel="Settings">
        <GearIcon color={c.fg} />
      </Tap>
    </View>
  )

  // Accounts with Gmail on, and any whose mail is already here.
  const reading = inbox.mailAccounts.accounts.length > 0
  if (!inbox.signedIn || !reading) {
    return (
      <View style={styles.screen}>
        {bar}
        <Text style={[styles.heading, { color: c.fg }]}>Inbox</Text>
        {!inbox.signedIn
          ? empty('Your mail, sorted', 'Sign in with Google and choose Gmail. Cairn checks it every ten minutes, picks out what is important, groups it into folders, and due dates become tasks.', {
              label: 'Set up in Settings',
              run: onSettings,
            })
          : empty('Gmail isn’t on yet', 'Choose Gmail for an account in Settings. Classroom posts have their own tab.', { label: 'Open Settings', run: onSettings })}
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      {bar}
      <Text style={[styles.heading, { color: c.fg }]}>Inbox</Text>

      <AccountChips chips={inbox.mailAccounts} current={picked} onPick={setAccount} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chips}>
        <FilterChip label="Important" count={important.length} on={current.kind === 'important'} onPress={() => setFilter({ kind: 'important' })} />
        {folders.map((name) => (
          <FilterChip
            key={name}
            label={name}
            count={visible.filter((r) => r.triage?.folder === name).length}
            on={same(current, { kind: 'folder', name })}
            onPress={() => setFilter({ kind: 'folder', name })}
          />
        ))}
        {rest.length > 0 && <FilterChip label="Everything else" count={rest.length} on={current.kind === 'rest'} onPress={() => setFilter({ kind: 'rest' })} />}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={() => void inbox.refresh()} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}
      >
        <PausedNotice />
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
            <Text style={{ color: c.muted, marginTop: 2 }}>Add an NVIDIA API key in Settings and each new email is read to pick out what matters.</Text>
          </Tap>
        )}
        {auth.status === 'error' && <Text style={[styles.hint, { color: c.danger }]}>{auth.message}</Text>}

        <LayoutAnimationConfig skipEntering>
          {shown.map((record) => (
            <MailCard
              key={record.id}
              record={record}
              senders={inbox.senders}
              showFolder={current.kind !== 'folder'}
              showAccount={inbox.mailAccounts.all && !picked}
              added={taskIds.has(inboxTaskId(record))}
              now={now}
              onOpen={() => {
                void inbox.markRead(record)
                void openMessage(record)
              }}
              onAdd={() => {
                void inbox.addAsTask(record).then(() => toast({ message: 'Added to Tasks' }))
              }}
              onMark={(rule) => mark(record, rule)}
              onHide={() => {
                void inbox.dismiss(record)
                toast({ message: 'Hidden on every device', action: { label: 'Undo', run: () => void inbox.dismiss(record, false) } })
              }}
            />
          ))}
        </LayoutAnimationConfig>

        {!inbox.refreshing && shown.length === 0 && (
          <Text style={[styles.hint, { color: c.muted }]}>
            {current.kind === 'important'
              ? 'Nothing important yet. Cairn checks new mail every ten minutes from the moment you chose Gmail, and lets you know when something turns up.'
              : 'Nothing here right now.'}
          </Text>
        )}
        <Text style={[styles.hint, { color: c.faint }]}>
          {readerStatus(inbox, now)}
          {inbox.ai.model ? ` · sorted by ${inbox.ai.model}` : ''}
        </Text>
      </ScrollView>
    </View>
  )
}

function MailCard({
  record,
  senders,
  showFolder,
  showAccount,
  added,
  now,
  onOpen,
  onAdd,
  onMark,
  onHide,
}: {
  record: InboxRecord
  senders: Record<string, SenderRule>
  showFolder: boolean
  showAccount: boolean
  added: boolean
  now: number
  onOpen: () => void
  onAdd: () => void
  onMark: (rule: SenderRule) => void
  onHide: () => void
}) {
  const c = useColors()
  const { triage } = record
  const important = isImportant(record, senders)
  const due = dueOf(record)
  const summary = triage?.summary ?? record.snippet
  const tags = triage ? tagsOf(record) : []
  return (
    <Animated.View entering={appear} exiting={fadeOut} layout={reflow}>
      <Tap
        onPress={onOpen}
        onLongPress={onHide}
        scaleTo={0.985}
        haptic="none"
        style={[styles.card, { backgroundColor: c.surface }]}
        accessibilityHint="Opens in Gmail. Long-press to hide."
      >
        <View style={styles.cardHead}>
          {!record.read && <View style={[styles.unread, { backgroundColor: c.accent }]} accessibilityLabel="Unread" />}
          {showFolder && triage?.folder && (
            <View style={[styles.folder, { backgroundColor: c.accent + '22' }]}>
              <Text style={[styles.folderText, { color: c.accent }]}>{triage.folder}</Text>
            </View>
          )}
          <Text style={[styles.cardMeta, styles.flex, { color: c.muted }]} numberOfLines={1}>
            {sender(record.from)} · {formatAgo(record.receivedAt, now).replace(' ago', '')}
            {showAccount ? ` · ${record.account}` : ''}
          </Text>
        </View>
        <Text style={[styles.cardTitle, { color: c.fg, fontWeight: record.read ? '600' : '700' }]} numberOfLines={2}>
          {record.subject || '(no subject)'}
        </Text>
        {!!summary && (
          <Text style={[styles.summary, { color: c.muted }]} numberOfLines={3}>
            {summary}
          </Text>
        )}
        {record.sorting && <Text style={[styles.tags, { color: c.faint }]}>Sorting…</Text>}
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

export const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm, height: 56 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  heading: { fontSize: 40, fontWeight: '300', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md },
  chipsRow: { flexGrow: 0, height: 48, marginBottom: space.sm },
  chips: { paddingHorizontal: space.lg, gap: space.xs, alignItems: 'center' },
  body: { paddingHorizontal: space.lg, paddingBottom: 120, gap: space.md },
  card: { borderRadius: radius.card + 4, padding: space.lg, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  cardMeta: { fontSize: 13 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  summary: { fontSize: 15, lineHeight: 21 },
  why: { fontSize: 13, fontWeight: '600' },
  tags: { fontSize: 13 },
  unread: { width: 8, height: 8, borderRadius: 4 },
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
