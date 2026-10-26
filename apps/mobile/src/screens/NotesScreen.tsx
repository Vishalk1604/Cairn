import type { Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { LayoutAnimationConfig, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { NoteCard, previewOf } from '../components/NoteCard'
import { SyncButton } from '../components/SyncButton'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { ALL_FOLDER, foldersOf, isRealFolder, moveToFolder, notesInFolder, usePinnedFolders, type Folder } from '../state/folders'
import { useObserved } from '../state/hooks'
import { FONT_SCALE, usePreferences } from '../state/preferences'
import { radius, space, useColors } from '../theme'
import type { Rect } from '../ui/Reveal'
import { FolderIcon, GearIcon, Glyph, PinIcon, TrashIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, reflow, settle, sheetIn, sheetOut, Tap } from '../ui/motion'

const ALL: NoteQuery = {}

/**
 * Two columns filled by whichever is currently shorter, from a cheap height
 * estimate. Measuring would cost a second layout pass on every keystroke in
 * search; being a few pixels out costs nothing.
 */
function columns(notes: readonly Note[]): [Note[], Note[]] {
  const left: Note[] = []
  const right: Note[] = []
  let leftH = 0
  let rightH = 0
  for (const note of notes) {
    const lines = Math.min(4, previewOf(note).split('\n').length)
    const height = 96 + lines * 22 + (note.attachments?.some((a) => a.kind === 'image') ? 110 : 0)
    if (leftH <= rightH) {
      left.push(note)
      leftH += height
    } else {
      right.push(note)
      rightH += height
    }
  }
  return [left, right]
}

export interface NotesScreenProps {
  onOpen: (note: Note, from: Rect) => void
  onNew: (from: Rect, folder: string) => void
  onFolders: () => void
  onSettings: () => void
  /** Whether multi-select is on, so the shell can swap the tab bar for actions. */
  onSelectingChange: (selecting: boolean) => void
  folder: string
  onFolderChange: (folder: string) => void
}

export function NotesScreen({ onOpen, onNew, onFolders, onSettings, onSelectingChange, folder, onFolderChange }: NotesScreenProps) {
  const c = useColors()
  const { notes, auth, sync } = useCairn()
  const actions = useActions()
  const all = useObserved(notes, ALL)
  const { preferences } = usePreferences()
  const { pinned } = usePinnedFolders()
  const [search, setSearch] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moving, setMoving] = useState(false)
  const fab = useRef<View>(null)
  const selecting = selected.size > 0

  useEffect(() => onSelectingChange(selecting), [selecting, onSelectingChange])

  useEffect(() => {
    if (!selecting && search === null) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selecting) setSelected(new Set())
      else setSearch(null)
      return true
    })
    return () => sub.remove()
  }, [selecting, search])

  const folders = useMemo(() => foldersOf(all, pinned), [all, pinned])
  const current = folders.some((f) => f.id === folder) ? folder : ALL_FOLDER
  const shown = useMemo(() => {
    const q = (search ?? '').trim().toLowerCase()
    const key = preferences.sort === 'created' ? 'createdAt' : 'updatedAt'
    return notesInFolder(all, current)
      .filter((n) => !q || [n.title, n.body ?? '', ...n.tags].some((f) => f.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b[key] - a[key])
  }, [all, current, search, preferences.sort])
  const [left, right] = useMemo(() => columns(shown), [shown])
  const scale = FONT_SCALE[preferences.fontSize]
  const chosen = shown.filter((n) => selected.has(n.id))

  const toggle = (note: Note) =>
    setSelected((now) => {
      const next = new Set(now)
      if (next.has(note.id)) next.delete(note.id)
      else next.add(note.id)
      return next
    })

  const card = (note: Note, index: number) => (
    <Animated.View
      key={note.id}
      entering={appear}
      exiting={fadeOut}
      layout={reflow}
    >
      <NoteCard
        note={note}
        scale={scale}
        lines={preferences.layout === 'list' ? 2 : 4}
        selecting={selecting}
        selected={selected.has(note.id)}
        onOpen={onOpen}
        onSelect={toggle}
      />
    </Animated.View>
  )

  return (
    <View style={styles.screen}>
      {selecting ? (
        <Animated.View entering={fadeIn} style={styles.bar}>
          <Tap onPress={() => setSelected(new Set())} scaleTo={0.92} style={styles.icon} accessibilityLabel="Cancel selection">
            <Glyph char="✕" color={c.fg} />
          </Tap>
          <Text style={[styles.selectedTitle, { color: c.fg }]}>
            {selected.size} {selected.size === 1 ? 'item' : 'items'} selected
          </Text>
          <Tap
            onPress={() => setSelected(selected.size === shown.length ? new Set() : new Set(shown.map((n) => n.id)))}
            scaleTo={0.92}
            style={styles.icon}
            accessibilityLabel="Select all"
          >
            <Glyph char="☑" color={c.fg} />
          </Tap>
        </Animated.View>
      ) : (
        <View style={styles.bar}>
          {auth.status === 'synced' || auth.status === 'connecting' ? <SyncButton busy={sync.busy} at={sync.at} onPress={() => void sync.run()} label="Sync notes and tasks" caption="after" /> : null}
          <View style={styles.spacer} />
          <Tap onPress={() => setSearch(search === null ? '' : null)} scaleTo={0.92} style={styles.icon} accessibilityLabel="Search notes">
            <Glyph char="⌕" color={c.fg} size={24} />
          </Tap>
          <Tap onPress={onFolders} scaleTo={0.92} style={styles.icon} accessibilityLabel="Folders">
            <FolderIcon color={c.fg} />
          </Tap>
          <Tap onPress={onSettings} scaleTo={0.92} style={styles.icon} accessibilityLabel="Settings">
            <GearIcon color={c.fg} />
          </Tap>
        </View>
      )}

      <Text style={[styles.heading, { color: c.fg }]}>Notes</Text>

      {search !== null && (
        <Animated.View entering={appear} exiting={fadeOut} style={styles.searchBox}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            autoFocus
            placeholder="Search notes"
            placeholderTextColor={c.faint}
            style={[styles.search, { backgroundColor: c.surface, color: c.fg }]}
            accessibilityLabel="Search notes"
          />
        </Animated.View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} contentContainerStyle={styles.chips}>
        {folders.map((f) => (
          <Chip key={f.id} folder={f} on={f.id === current} onPress={() => onFolderChange(f.id)} />
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Lists appear at once; only items added while it is open animate in. */}
        <LayoutAnimationConfig skipEntering>
        {shown.length === 0 ? (
          <Animated.Text entering={fadeIn} style={[styles.empty, { color: c.muted }]}>
            {all.length === 0 ? 'Nothing here yet.\nTap + and start writing.' : search ? 'No notes match.' : 'This folder is empty.'}
          </Animated.Text>
        ) : preferences.layout === 'list' ? (
          <View style={styles.column}>{shown.map(card)}</View>
        ) : (
          <View style={styles.grid}>
            <View style={styles.column}>{left.map(card)}</View>
            <View style={styles.column}>{right.map(card)}</View>
          </View>
        )}
        </LayoutAnimationConfig>
      </ScrollView>

      {selecting ? (
        <Animated.View entering={appear} style={[styles.actions, { backgroundColor: c.bg, borderTopColor: c.line }]}>
          <Action
            label={chosen.every((n) => n.pinned) ? 'Unpin' : 'Pin'}
            icon={<PinIcon color={c.fg} size={20} />}
            onPress={async () => {
              const pin = !chosen.every((n) => n.pinned)
              for (const n of chosen) if (n.pinned !== pin) await actions.togglePin(n)
              setSelected(new Set())
            }}
          />
          <Action label="Move" icon={<FolderIcon color={c.fg} size={20} />} onPress={() => setMoving(true)} />
          <Action
            label="Delete"
            icon={<TrashIcon color={c.danger} size={20} />}
            danger
            onPress={async () => {
              for (const n of chosen) await actions.removeNote(n)
              setSelected(new Set())
            }}
          />
        </Animated.View>
      ) : (
        <Tap
          ref={fab}
          onPress={() =>
            fab.current?.measureInWindow((x, y, width, height) => onNew({ x, y, width, height, radius: 30, color: c.accent }, current))
          }
          scaleTo={0.92}
          haptic="light"
          style={[styles.fab, { backgroundColor: c.accent }]}
          accessibilityLabel="New note"
        >
          <Glyph char="+" color={c.onAccent} size={34} weight="400" />
        </Tap>
      )}

      {moving && (
        <MoveSheet
          folders={folders.filter((f) => isRealFolder(f.id)).map((f) => f.id)}
          onPick={async (tag) => {
            setMoving(false)
            await moveToFolder(notes, chosen, tag)
            setSelected(new Set())
          }}
          onClose={() => setMoving(false)}
        />
      )}
    </View>
  )
}

function Chip({ folder, on, onPress }: { folder: Folder; on: boolean; onPress: () => void }) {
  const c = useColors()
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    fill.value = withTiming(on ? 1 : 0, settle)
  }, [on, fill])
  const pill = useAnimatedStyle(() => ({ opacity: fill.value, transform: [{ scale: 0.85 + fill.value * 0.15 }] }))

  return (
    <Tap onPress={onPress} scaleTo={0.92} style={styles.chip} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.chipFill, { backgroundColor: c.surfaceHigh }, pill]} />
      <Text style={[styles.chipText, { color: on ? c.fg : c.muted, fontWeight: on ? '700' : '400' }]}>{folder.name}</Text>
      {folder.pinned && (
        <View style={styles.chipPin}>
          <PinIcon color={c.accent} size={14} />
        </View>
      )}
    </Tap>
  )
}

function Action({ label, icon, onPress, danger }: { label: string; icon: React.ReactNode; onPress: () => void; danger?: boolean }) {
  const c = useColors()
  return (
    <Tap onPress={onPress} scaleTo={0.92} haptic="light" style={styles.action} accessibilityLabel={label}>
      {icon}
      <Text style={{ color: danger ? c.danger : c.fg, fontSize: 12 }}>{label}</Text>
    </Tap>
  )
}

function MoveSheet({ folders, onPick, onClose }: { folders: string[]; onPick: (tag: string | null) => void; onClose: () => void }) {
  const c = useColors()
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Tap onPress={onClose} scaleTo={1} haptic="none" style={styles.flex}>
        <View />
      </Tap>
      <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <Text style={[styles.sheetTitle, { color: c.fg }]}>Move to folder</Text>
        {[null, ...folders].map((tag) => (
          <Tap key={tag ?? 'none'} onPress={() => onPick(tag)} scaleTo={0.98} style={styles.sheetRow}>
            <Text style={{ color: c.fg, fontSize: 16 }}>{tag ? tag.toUpperCase() : 'No folder'}</Text>
          </Tap>
        ))}
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingTop: space.sm, height: 56 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  selectedTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '600' },
  heading: { fontSize: 40, fontWeight: '300', paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
  searchBox: { paddingHorizontal: space.lg, paddingBottom: space.md },
  search: { borderRadius: radius.chip, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 16 },
  chipsRow: { flexGrow: 0, height: 48, marginBottom: space.md },
  chips: { paddingHorizontal: space.lg, gap: space.xs, alignItems: 'center' },
  // A fixed height rather than padding around the text: regular and bold
  // Roboto measure differently on Android, and the unselected chips were
  // coming out shorter than their own labels and clipping them.
  chip: { flexDirection: 'row', alignItems: 'center', height: 40, paddingHorizontal: space.lg },
  chipText: { fontSize: 16, lineHeight: 22, includeFontPadding: false },
  chipFill: { borderRadius: 16 },
  chipPin: { marginLeft: 4 },
  body: { paddingHorizontal: space.md + 2, paddingBottom: 140 },
  grid: { flexDirection: 'row', gap: space.md },
  column: { flex: 1, gap: space.md },
  empty: { padding: space.xl, paddingTop: 80, textAlign: 'center', fontSize: 16, lineHeight: 24 },
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
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: space.md, paddingBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  action: { alignItems: 'center', gap: 4, minWidth: 72, paddingVertical: space.xs },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.lg, paddingBottom: space.xl },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: space.sm },
  sheetRow: { paddingVertical: space.md },
})
