import type { Note } from '@cairn/core'
import { noteHeading, noteLines, noteTimestamp } from '@cairn/ui'
import { memo, useMemo, useRef } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import { attachmentFile, hasLocalCopy } from '../platform/media'
import { useMediaVersion } from '../state/media'
import { radius, space, useColors } from '../theme'
import type { Rect } from '../ui/Reveal'
import { Glyph, PinIcon } from '../ui/icons'
import { Tap } from '../ui/motion'

/** The card's preview: the writing, with media as short labels rather than thumbnails. */
export function previewOf(note: Pick<Note, 'body' | 'attachments'>): string {
  return noteLines(note).join('\n')
}

/** The first photo, if this phone has it, for the card's thumbnail. */
function coverOf(note: Note): string | null {
  const photo = note.attachments?.find((a) => a.kind === 'image')
  return photo && hasLocalCopy(photo) ? attachmentFile(photo).uri : null
}

/**
 * One card in the grid. Opening reports where the card sits, so the editor
 * can grow out of it and shrink back into it.
 */
export const NoteCard = memo(function NoteCard({
  note,
  scale,
  selecting,
  selected,
  lines,
  onOpen,
  onSelect,
}: {
  note: Note
  /** The font size setting, as a multiplier. */
  scale: number
  selecting: boolean
  selected: boolean
  lines: number
  onOpen: (note: Note, from: Rect) => void
  onSelect: (note: Note) => void
}) {
  const c = useColors()
  const ref = useRef<View>(null)
  const preview = useMemo(() => previewOf(note), [note])
  const media = useMediaVersion()
  const cover = useMemo(() => coverOf(note), [note, media])
  const heading = noteHeading(note)

  const open = () => {
    if (selecting) return onSelect(note)
    ref.current?.measureInWindow((x, y, width, height) =>
      onOpen(note, { x, y, width, height, radius: radius.card + 4, color: c.surface }),
    )
  }

  return (
    <Tap
      ref={ref}
      onPress={open}
      onLongPress={() => onSelect(note)}
      scaleTo={0.97}
      accessibilityRole="button"
      accessibilityLabel={heading}
      accessibilityState={{ selected }}
      style={[styles.card, { backgroundColor: selected ? c.surfaceHigh : c.surface, borderColor: selected ? c.accent : 'transparent' }]}
    >
      {cover && <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />}
      <Text style={[styles.title, { color: c.fg, fontSize: 17 * scale }]} numberOfLines={2}>
        {heading}
      </Text>
      <Text style={[styles.preview, { color: c.muted, fontSize: 15 * scale, lineHeight: 22 * scale }]} numberOfLines={lines}>
        {preview || 'No text'}
      </Text>
      <View style={styles.foot}>
        <Text style={[styles.date, { color: c.faint }]}>{noteTimestamp(note.updatedAt)}</Text>
        {note.pinned && <PinIcon color={c.accent} size={14} />}
        <View style={styles.spacer} />
        {selecting && (
          <View style={[styles.check, { backgroundColor: selected ? c.accent : c.surfaceHigh }]}>
            {selected && <Glyph char="✓" color={c.onAccent} size={13} weight="700" />}
          </View>
        )}
      </View>
    </Tap>
  )
})

const styles = StyleSheet.create({
  card: { borderRadius: radius.card + 4, padding: space.lg + 2, gap: space.sm, borderWidth: 1.5, overflow: 'hidden' },
  cover: { height: 110, marginHorizontal: -(space.lg + 2), marginTop: -(space.lg + 2), marginBottom: space.xs },
  title: { fontWeight: '700' },
  preview: {},
  foot: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  date: { fontSize: 13 },
  spacer: { flex: 1 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
})
