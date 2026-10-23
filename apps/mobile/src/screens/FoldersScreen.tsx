import { nextStamp, type Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { noteHeading } from '@cairn/ui'
import { useEffect, useMemo, useState } from 'react'
import { BackHandler, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { useCairn } from '../state/context'
import { deleteFolder, folderTag, foldersOf, isRealFolder, renameFolder, usePinnedFolders } from '../state/folders'
import { useObserved } from '../state/hooks'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { Glyph, PinIcon, TrashIcon } from '../ui/icons'
import { appear, fadeIn, fadeOut, reflow, sheetIn, sheetOut, Tap } from '../ui/motion'

const ALL: NoteQuery = {}
const WITH_DELETED: NoteQuery = { includeDeleted: true }

/**
 * Folders are tags, so a new folder exists by being pinned until something is
 * filed in it; renaming retags every note in it; deleting one unfiles its
 * notes rather than deleting them.
 */
export function FoldersScreen({ current, onBack, onPick }: { current: string; onBack: () => void; onPick: (folderId: string) => void }) {
  const c = useColors()
  const toast = useToast()
  const { notes } = useCairn()
  const all = useObserved(notes, ALL)
  const { pinned, toggle } = usePinnedFolders()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [naming, setNaming] = useState<{ from: string | null; text: string } | null>(null)
  const [trash, setTrash] = useState(false)
  const selecting = selected.size > 0
  const folders = useMemo(() => foldersOf(all, pinned), [all, pinned])
  const chosen = [...selected]

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (naming) setNaming(null)
      else if (trash) setTrash(false)
      else if (selecting) setSelected(new Set())
      else onBack()
      return true
    })
    return () => sub.remove()
  }, [naming, trash, selecting, onBack])

  const toggleSelected = (id: string) =>
    setSelected((now) => {
      const next = new Set(now)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const commitName = async () => {
    if (!naming) return
    const tag = folderTag(naming.text)
    setNaming(null)
    if (!tag) return
    if (naming.from) {
      await renameFolder(notes, all, naming.from, tag)
      if (pinned.includes(naming.from)) {
        toggle(naming.from)
        if (!pinned.includes(tag)) toggle(tag)
      }
      setSelected(new Set())
    } else {
      // A brand-new folder is held open by pinning it until it has notes.
      if (!pinned.includes(tag)) toggle(tag)
      onPick(tag)
    }
  }

  if (trash) return <RecentlyDeleted onBack={() => setTrash(false)} />

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      {selecting ? (
        <Animated.View entering={fadeIn} style={styles.bar}>
          <Tap onPress={() => setSelected(new Set())} scaleTo={0.92} style={styles.icon} accessibilityLabel="Cancel selection">
            <Glyph char="✕" color={c.fg} />
          </Tap>
          <Text style={[styles.title, { color: c.fg }]}>
            {selected.size} {selected.size === 1 ? 'item' : 'items'} selected
          </Text>
          <View style={styles.icon} />
        </Animated.View>
      ) : (
        <View style={styles.bar}>
          <Tap onPress={onBack} scaleTo={0.92} style={styles.icon} accessibilityLabel="Back to notes">
            <Glyph char="←" color={c.fg} />
          </Tap>
          <Text style={[styles.title, { color: c.fg }]}>Folders</Text>
          <Tap onPress={() => setTrash(true)} scaleTo={0.92} style={styles.icon} accessibilityLabel="Recently deleted">
            <TrashIcon color={c.fg} />
          </Tap>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.body}>
        {/* Lists appear at once; only items added while it is open animate in. */}
        <LayoutAnimationConfig skipEntering>
        {folders.map((f, i) => {
          const real = isRealFolder(f.id)
          const isOn = selected.has(f.id)
          return (
            <Animated.View key={f.id} entering={appear} layout={reflow}>
              <Tap
                onPress={() => (selecting ? real && toggleSelected(f.id) : onPick(f.id))}
                onLongPress={real ? () => toggleSelected(f.id) : undefined}
                scaleTo={0.98}
                style={[styles.row, { backgroundColor: isOn ? c.surfaceHigh : c.surface }, isOn && styles.rowLifted]}
                accessibilityLabel={`${f.name}, ${f.count} notes`}
              >
                <View style={styles.tick}>{f.id === current && !selecting && <Glyph char="✓" color={c.accent} weight="700" />}</View>
                <Text style={[styles.name, { color: c.fg, fontWeight: f.id === current ? '700' : '400' }]}>{f.name}</Text>
                {f.pinned && <PinIcon color={c.accent} size={18} />}
                {selecting && real ? (
                  <View style={[styles.circle, { backgroundColor: isOn ? c.accent : c.faint }]}>
                    {isOn && <Glyph char="✓" color={c.onAccent} size={14} weight="700" />}
                  </View>
                ) : (
                  <Text style={[styles.count, { color: c.muted, fontWeight: f.id === current ? '700' : '400' }]}>{f.count}</Text>
                )}
              </Tap>
            </Animated.View>
          )
        })}

        {!selecting &&
          (naming && naming.from === null ? (
            <Animated.View entering={appear} style={[styles.row, { backgroundColor: c.surface }]}>
              <TextInput
                value={naming.text}
                onChangeText={(text) => setNaming({ from: null, text })}
                placeholder="Folder name"
                placeholderTextColor={c.faint}
                autoFocus
                autoCapitalize="characters"
                style={[styles.input, { color: c.fg }]}
                onSubmitEditing={() => void commitName()}
                onBlur={() => setNaming(null)}
              />
            </Animated.View>
          ) : (
            <Tap onPress={() => setNaming({ from: null, text: '' })} scaleTo={0.97} style={[styles.newFolder, { backgroundColor: c.surface }]}>
              <View style={[styles.plus, { backgroundColor: c.accent }]}>
                <Glyph char="+" color={c.onAccent} size={20} weight="700" />
              </View>
              <Text style={{ color: c.fg, fontSize: 16 }}>New folder</Text>
            </Tap>
          ))}
        </LayoutAnimationConfig>
      </ScrollView>

      {naming && naming.from !== null && (
        <Animated.View entering={fadeIn} style={[StyleSheet.absoluteFill, styles.scrim]}>
          <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.dialog, { backgroundColor: c.surface }]}>
            <Text style={[styles.dialogTitle, { color: c.fg }]}>Rename folder</Text>
            <TextInput
              value={naming.text}
              onChangeText={(text) => setNaming({ ...naming, text })}
              autoFocus
              autoCapitalize="characters"
              style={[styles.dialogInput, { color: c.fg, backgroundColor: c.surfaceHigh }]}
              onSubmitEditing={() => void commitName()}
            />
            <View style={styles.dialogButtons}>
              <Tap onPress={() => setNaming(null)} style={styles.dialogButton}>
                <Text style={{ color: c.muted, fontSize: 16 }}>Cancel</Text>
              </Tap>
              <Tap onPress={() => void commitName()} style={styles.dialogButton}>
                <Text style={{ color: c.accent, fontSize: 16, fontWeight: '700' }}>OK</Text>
              </Tap>
            </View>
          </Animated.View>
        </Animated.View>
      )}

      {selecting && (
        <Animated.View entering={appear} style={[styles.actions, { borderTopColor: c.line }]}>
          <Action
            label={chosen.every((t) => pinned.includes(t)) ? 'Unpin' : 'Pin'}
            icon={<PinIcon color={c.fg} size={22} />}
            onPress={() => {
              const pin = !chosen.every((t) => pinned.includes(t))
              for (const tag of chosen) if (pinned.includes(tag) !== pin) toggle(tag)
              setSelected(new Set())
            }}
          />
          <Action
            label="Delete"
            icon={<TrashIcon color={c.fg} size={22} />}
            onPress={async () => {
              for (const tag of chosen) {
                await deleteFolder(notes, all, tag)
                if (pinned.includes(tag)) toggle(tag)
              }
              toast({ message: chosen.length === 1 ? 'Folder deleted. Its notes are in Uncategorised.' : 'Folders deleted. Their notes are in Uncategorised.' })
              setSelected(new Set())
            }}
          />
          <Action
            label="Edit"
            icon={<Glyph char="✎" color={selected.size === 1 ? c.fg : c.faint} size={22} />}
            disabled={selected.size !== 1}
            onPress={() => setNaming({ from: chosen[0]!, text: chosen[0]!.toUpperCase() })}
          />
        </Animated.View>
      )}
    </View>
  )
}

function Action({ label, icon, onPress, disabled }: { label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean }) {
  const c = useColors()
  return (
    <Tap onPress={onPress} disabled={disabled} scaleTo={0.92} haptic="light" style={styles.action} accessibilityLabel={label}>
      {icon}
      <Text style={{ color: c.fg, fontSize: 13 }}>{label}</Text>
    </Tap>
  )
}

/**
 * Deleted notes are tombstones for thirty days before they are purged, so
 * this list costs nothing extra: it is the same records, still on the phone.
 */
function RecentlyDeleted({ onBack }: { onBack: () => void }) {
  const c = useColors()
  const toast = useToast()
  const { notes } = useCairn()
  const everything = useObserved(notes, WITH_DELETED)
  const deleted = everything.filter((n) => n.deletedAt !== undefined).sort((a, b) => b.deletedAt! - a.deletedAt!)

  const restore = async (n: Note) => {
    const { deletedAt: _gone, ...alive } = n
    await notes.upsert({ ...alive, updatedAt: nextStamp(n.updatedAt, Date.now()) })
    toast({ message: `Restored “${noteHeading(n)}”` })
  }

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <View style={styles.bar}>
        <Tap onPress={onBack} scaleTo={0.92} style={styles.icon} accessibilityLabel="Back to folders">
          <Glyph char="←" color={c.fg} />
        </Tap>
        <Text style={[styles.title, { color: c.fg }]}>Recently deleted</Text>
        <View style={styles.icon} />
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.hint, { color: c.faint }]}>Deleted notes are kept here for 30 days.</Text>
        {deleted.length === 0 && <Text style={[styles.hint, { color: c.muted, paddingTop: 60 }]}>Nothing deleted recently.</Text>}
        {deleted.map((n) => (
          <Animated.View key={n.id} exiting={fadeOut} layout={reflow}>
            <View style={[styles.row, { backgroundColor: c.surface }]}>
              <Text style={[styles.name, { color: c.fg }]} numberOfLines={1}>
                {noteHeading(n)}
              </Text>
              <Tap onPress={() => void restore(n)} scaleTo={0.94} style={[styles.restore, { borderColor: c.accent }]}>
                <Text style={{ color: c.accent, fontWeight: '600' }}>Restore</Text>
              </Tap>
            </View>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.sm, height: 60 },
  title: { flex: 1, textAlign: 'center', fontSize: 22, fontWeight: '600' },
  icon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 24 },
  body: { padding: space.lg, gap: space.md, paddingBottom: 120 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.card + 6, paddingHorizontal: space.lg, minHeight: 68 },
  rowLifted: { marginHorizontal: space.md },
  tick: { width: 28, alignItems: 'center' },
  name: { flex: 1, fontSize: 19 },
  count: { fontSize: 16, minWidth: 28, textAlign: 'right' },
  circle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, fontSize: 18 },
  newFolder: { borderRadius: radius.card + 6, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.lg + 4 },
  plus: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: space.md, borderTopWidth: StyleSheet.hairlineWidth },
  action: { alignItems: 'center', gap: 6, minWidth: 80 },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: space.xl },
  dialog: { borderRadius: radius.sheet, padding: space.xl, gap: space.lg },
  dialogTitle: { fontSize: 18, fontWeight: '700' },
  dialogInput: { borderRadius: 12, paddingHorizontal: space.lg, paddingVertical: space.md, fontSize: 17 },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.lg },
  dialogButton: { paddingHorizontal: space.md, paddingVertical: space.sm },
  restore: { borderWidth: 1, borderRadius: 16, paddingHorizontal: space.md, paddingVertical: 6 },
  hint: { textAlign: 'center', fontSize: 14 },
})
