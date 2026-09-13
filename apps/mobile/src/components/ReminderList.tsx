import { compareByUrgency, URGENCY_LEVELS, urgencyOf, type Reminder, type UrgencyLevel } from '@cairn/core'
import { formatReminderWhen, URGENCY } from '@cairn/ui'
import { useMemo } from 'react'
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { useActions } from '../state/actions'
import { colors } from '../theme'

interface Props {
  reminders: readonly Reminder[]
  now: number
  onEdit: (reminder: Reminder) => void
  onSnooze: (reminder: Reminder) => void
}

export function ReminderList({ reminders, now, onEdit, onSnooze }: Props) {
  const sections = useMemo(() => {
    const byLevel = new Map<UrgencyLevel, Reminder[]>()
    for (const r of [...reminders].sort(compareByUrgency(now))) {
      const level = urgencyOf(r, now)
      byLevel.set(level, [...(byLevel.get(level) ?? []), r])
    }
    return URGENCY_LEVELS.flatMap((level) => {
      const data = byLevel.get(level)
      return data ? [{ level, data }] : []
    })
  }, [reminders, now])

  return (
    <SectionList
      sections={sections}
      keyExtractor={(r) => r.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      renderSectionHeader={({ section }) => (
        <Text style={styles.header} accessibilityRole="header">
          {URGENCY[section.level].symbol} {URGENCY[section.level].label} <Text style={styles.count}>{section.data.length}</Text>
        </Text>
      )}
      renderItem={({ item, section }) => (
        <ReminderRow reminder={item} level={section.level} now={now} onEdit={onEdit} onSnooze={onSnooze} />
      )}
      ListEmptyComponent={<Text style={styles.empty}>Nothing coming up. Add something above.</Text>}
    />
  )
}

function ReminderRow({
  reminder: r,
  level,
  now,
  onEdit,
  onSnooze,
}: {
  reminder: Reminder
  level: UrgencyLevel
  now: number
  onEdit: (r: Reminder) => void
  onSnooze: (r: Reminder) => void
}) {
  const actions = useActions()
  const token = URGENCY[level]
  const snoozed = r.status === 'snoozed' && (r.snoozedUntil ?? 0) > now
  const meta = [formatReminderWhen(r, now), r.priority !== 'normal' ? r.priority : null, ...r.tags.map((t) => `#${t}`)]
    .filter(Boolean)
    .join(' · ')

  return (
    <View style={[styles.row, { borderLeftColor: token.color }]}>
      <Pressable
        onPress={() => void actions.complete(r)}
        accessibilityRole="button"
        accessibilityLabel={`Complete ${r.title}`}
        hitSlop={8}
        style={styles.check}
      >
        <Text>○</Text>
      </Pressable>
      <Pressable style={styles.main} onPress={() => onEdit(r)} accessibilityRole="button" accessibilityLabel={`Edit ${r.title}, ${token.label}`}>
        <Text style={styles.title}>{r.title}</Text>
        <Text style={styles.meta}>
          <Text style={{ color: token.color }}>{token.symbol}</Text> {meta}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => (snoozed ? void actions.unsnooze(r) : onSnooze(r))}
        accessibilityRole="button"
        accessibilityLabel={snoozed ? `Unsnooze ${r.title}` : `Snooze ${r.title}`}
        hitSlop={8}
      >
        <Text style={styles.action}>{snoozed ? 'Unsnooze' : 'Snooze'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 96 },
  header: { fontWeight: '700', marginTop: 16, marginBottom: 4, backgroundColor: colors.bg },
  count: { fontWeight: '400', color: colors.muted },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    marginBottom: 4,
    borderLeftWidth: 4,
    backgroundColor: colors.surface,
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: { flex: 1 },
  title: { fontWeight: '600', color: colors.fg },
  meta: { color: colors.muted, fontSize: 13 },
  action: { color: colors.muted },
  empty: { color: colors.muted, paddingVertical: 24 },
})
