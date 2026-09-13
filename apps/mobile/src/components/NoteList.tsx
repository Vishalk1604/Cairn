import type { Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { useObserved } from '../state/hooks'
import { colors } from '../theme'
import { inputStyle } from './controls'

const ALL: NoteQuery = {}

export function noteHeading(n: Pick<Note, 'title' | 'body'>): string {
  return n.title || n.body?.trim().split('\n')[0] || 'Untitled'
}

export function NoteList({ onOpen }: { onOpen: (note: Note) => void }) {
  const { notes } = useCairn()
  const actions = useActions()
  const all = useObserved(notes, ALL)
  const [search, setSearch] = useState('')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((n) => !q || [n.title, n.body ?? '', ...n.tags].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [all, search])

  return (
    <FlatList
      data={shown}
      keyExtractor={(n) => n.id}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search notes"
          placeholderTextColor={colors.muted}
          style={[inputStyle, styles.search]}
          accessibilityLabel="Search notes"
        />
      }
      ListEmptyComponent={
        <Text style={styles.empty}>{all.length === 0 ? 'No notes yet. Anything you type above without a date becomes a note.' : 'No notes match.'}</Text>
      }
      renderItem={({ item: n }) => (
        <View style={styles.row}>
          <Pressable style={styles.main} onPress={() => onOpen(n)} accessibilityRole="button" accessibilityLabel={`Open ${noteHeading(n)}`}>
            <Text style={styles.title}>
              {n.pinned ? '📌 ' : ''}
              {noteHeading(n)}
            </Text>
            {(n.title && n.body) || n.tags.length > 0 ? (
              <Text style={styles.meta} numberOfLines={1}>
                {[n.title && n.body ? n.body.trim().split('\n')[0] : null, ...n.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </Pressable>
          <Pressable onPress={() => void actions.togglePin(n)} accessibilityRole="button" accessibilityState={{ selected: n.pinned }} hitSlop={8}>
            <Text style={styles.action}>{n.pinned ? 'Unpin' : 'Pin'}</Text>
          </Pressable>
        </View>
      )}
    />
  )
}

const styles = StyleSheet.create({
  content: { paddingBottom: 96 },
  search: { marginVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginBottom: 4, backgroundColor: colors.surface },
  main: { flex: 1 },
  title: { fontWeight: '600', color: colors.fg },
  meta: { color: colors.muted, fontSize: 13 },
  action: { color: colors.muted },
  empty: { color: colors.muted, paddingVertical: 24 },
})
