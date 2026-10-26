import { dueOf, inboxTaskId, type InboxRecord } from '@cairn/core'
import type { ReminderQuery } from '@cairn/sync'
import { formatAgo, formatDue, readerStatus } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { RefreshControl, ScrollView, Text, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { AccountChips, FilterChip } from '../components/Chips'
import { Switch } from '../components/Switch'
import { SyncButton } from '../components/SyncButton'
import { openMessage } from '../platform/mail'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { useInbox } from '../state/inbox'
import { useToast } from '../state/toast'
import { space, useColors } from '../theme'
import { ClassIcon, GearIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, reflow, Tap } from '../ui/motion'
import { styles } from './InboxScreen'

const EVERY_TASK: ReminderQuery = {}

type Tab = 'work' | 'announcement'

/**
 * New coursework and announcements from every connected account, apart from
 * the mail. Each can become a task with a tap — coursework at Classroom's own
 * due date, ticking itself off on hand-in — or all of them can, on their own,
 * with Automatically add tasks.
 */
export function ClassroomScreen({ onSettings }: { onSettings: () => void }) {
  const c = useColors()
  const toast = useToast()
  const { accounts, reminders } = useCairn()
  const inbox = useInbox()
  const tasks = useObserved(reminders, EVERY_TASK)
  const taskIds = useMemo(() => new Set(tasks.map((t) => t.id)), [tasks])
  const [tab, setTab] = useState<Tab>('work')
  const [account, setAccount] = useState<string | null>(null)
  const now = Date.now()

  const { markSeen } = inbox
  useEffect(() => markSeen('classroom'), [markSeen, inbox.classroom.length])

  const picked = account && inbox.classroomAccounts.accounts.includes(account) ? account : null
  const visible = picked ? inbox.classroom.filter((r) => r.account === picked) : inbox.classroom
  const work = visible.filter((r) => r.classroom?.kind === 'work')
  const announcements = visible.filter((r) => r.classroom?.kind === 'announcement')
  const shown = tab === 'work' ? work : announcements
  const gaps = inbox.gaps.filter((g) => g.missing.some((s) => s === 'classroom' || s === 'announcements'))

  const bar = (
    <View style={styles.bar}>
      {inbox.signedIn && <SyncButton busy={inbox.refreshing} at={inbox.checkedAt} onPress={() => void inbox.refresh(true)} label="Check Classroom now" caption="after" />}
      <View style={styles.spacer} />
      <Tap onPress={onSettings} scaleTo={0.92} style={styles.icon} accessibilityLabel="Settings">
        <GearIcon color={c.fg} />
      </Tap>
    </View>
  )

  if (accounts.length === 0 || (inbox.classroomReadable.length === 0 && inbox.classroom.length === 0 && gaps.length === 0)) {
    return (
      <View style={styles.screen}>
        {bar}
        <Text style={[styles.heading, { color: c.fg }]}>Classroom</Text>
        <Animated.View entering={fadeIn} style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.surface }]}>
            <ClassIcon color={c.faint} size={40} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.fg }]}>{accounts.length === 0 ? 'Your classes, in one place' : 'Classroom isn’t on yet'}</Text>
          <Text style={[styles.emptyDetail, { color: c.muted }]}>
            {accounts.length === 0
              ? 'Sign in with Google, then let Cairn read Google Classroom. New coursework and announcements from every account show here.'
              : 'Turn on Google Classroom for an account in Settings, such as your university’s.'}
          </Text>
          <Tap onPress={onSettings} scaleTo={0.94} haptic="light" style={[styles.cta, { backgroundColor: c.accent }]}>
            <Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 16 }}>Open Settings</Text>
          </Tap>
        </Animated.View>
      </View>
    )
  }

  return (
    <View style={styles.screen}>
      {bar}
      <Text style={[styles.heading, { color: c.fg }]}>Classroom</Text>
      <AccountChips chips={inbox.classroomAccounts} current={picked} onPick={setAccount} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chips}>
        <FilterChip label="Coursework" count={work.filter((r) => !r.classroom?.submitted).length} on={tab === 'work'} onPress={() => setTab('work')} />
        <FilterChip label="Announcements" count={announcements.length} on={tab === 'announcement'} onPress={() => setTab('announcement')} />
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={inbox.refreshing} onRefresh={() => void inbox.refresh(true)} tintColor={c.accent} colors={[c.accent]} progressBackgroundColor={c.surface} />}
      >
        <Tap
          onPress={() => {
            const on = !inbox.autoTasks
            void inbox.setAutoTasks(on)
            toast({ message: on ? 'New coursework and announcements will become tasks on their own' : 'Classroom posts wait for a tap again' })
          }}
          scaleTo={0.98}
          style={[styles.notice, { backgroundColor: c.surface, borderColor: c.line, flexDirection: 'row', alignItems: 'center', gap: space.md }]}
          accessibilityRole="switch"
          accessibilityState={{ checked: inbox.autoTasks }}
          accessibilityLabel="Automatically add tasks"
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: c.fg, fontWeight: '600', fontSize: 16 }}>Automatically add tasks</Text>
            <Text style={{ color: c.muted, marginTop: 2 }}>Coursework at its due date, announcements at any date they give. On your computer too.</Text>
          </View>
          <Switch on={inbox.autoTasks} />
        </Tap>
        {gaps.map((gap) => (
          <Tap key={gap.sub} onPress={onSettings} scaleTo={0.98} style={[styles.notice, { backgroundColor: c.surface, borderColor: c.accent }]} accessibilityRole="button">
            <Text style={{ color: c.fg, fontWeight: '600' }}>Connect {gap.email} to match your computer</Text>
            <Text style={{ color: c.muted, marginTop: 2 }}>Your computer reads Classroom for it. Set it up in Settings.</Text>
          </Tap>
        ))}
        {inbox.error && (
          <Animated.View entering={appear} style={[styles.notice, { backgroundColor: c.danger + '22', borderColor: c.danger }]}>
            <Text style={{ color: c.danger }}>{inbox.error}</Text>
          </Animated.View>
        )}

        <LayoutAnimationConfig skipEntering>
          {shown.map((record) => (
            <PostCard
              key={record.id}
              record={record}
              showAccount={inbox.classroomAccounts.all && !picked}
              added={taskIds.has(inboxTaskId(record))}
              now={now}
              onOpen={() => {
                void inbox.markRead(record)
                void openMessage(record)
              }}
              onAdd={() => void inbox.addAsTask(record).then(() => toast({ message: 'Added to Tasks' }))}
              onHide={() => {
                void inbox.dismiss(record)
                toast({ message: 'Hidden on every device', action: { label: 'Undo', run: () => void inbox.dismiss(record, false) } })
              }}
            />
          ))}
        </LayoutAnimationConfig>

        {!inbox.refreshing && shown.length === 0 && (
          <Text style={[styles.hint, { color: c.muted }]}>
            {tab === 'work' ? 'No new coursework. It shows here as soon as a teacher posts it.' : 'No new announcements.'}
          </Text>
        )}
        <Text style={[styles.hint, { color: c.faint }]}>{readerStatus(inbox, 'phone', now)}</Text>
      </ScrollView>
    </View>
  )
}

function PostCard({
  record,
  showAccount,
  added,
  now,
  onOpen,
  onAdd,
  onHide,
}: {
  record: InboxRecord
  showAccount: boolean
  added: boolean
  now: number
  onOpen: () => void
  onAdd: () => void
  onHide: () => void
}) {
  const c = useColors()
  const post = record.classroom!
  const due = dueOf(record)
  const summary = record.triage?.summary ?? record.snippet
  return (
    <Animated.View entering={appear} exiting={fadeOut} layout={reflow}>
      <Tap
        onPress={onOpen}
        onLongPress={onHide}
        scaleTo={0.985}
        haptic="none"
        style={[styles.card, { backgroundColor: c.surface, opacity: post.submitted ? 0.6 : 1 }]}
        accessibilityHint="Opens in Classroom. Long-press to hide."
      >
        <View style={styles.cardHead}>
          {!record.read && <View style={[styles.unread, { backgroundColor: c.accent }]} accessibilityLabel="New" />}
          <Text style={[styles.cardMeta, styles.flex, { color: c.muted }]} numberOfLines={1}>
            {post.course} · {formatAgo(record.receivedAt, now).replace(' ago', '')}
            {showAccount ? ` · ${record.account}` : ''}
          </Text>
        </View>
        <Text style={[styles.cardTitle, { color: c.fg }]} numberOfLines={2}>
          {record.subject}
        </Text>
        {!!summary && summary !== record.subject && (
          <Text style={[styles.summary, { color: c.muted }]} numberOfLines={3}>
            {summary}
          </Text>
        )}
        {due && (
          <View style={[styles.due, { borderColor: c.accent }]}>
            <Text style={{ color: c.accent, fontWeight: '600' }} numberOfLines={1}>
              Due {formatDue(due.dueAt, due.allDay, now)}
            </Text>
          </View>
        )}
        <View style={[styles.cardFoot, { marginTop: space.xs }]}>
          {post.submitted && <Text style={{ color: c.muted }}>Handed in</Text>}
          <View style={styles.spacer} />
          {added ? (
            <Text style={{ color: c.faint }}>✓ In Tasks</Text>
          ) : (
            !post.submitted && (
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
