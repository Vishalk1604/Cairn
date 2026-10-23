import type { Attachment } from '@cairn/core'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { useMemo } from 'react'
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { attachmentFile, formatDuration, hasLocalCopy } from '../platform/media'
import { useMediaVersion } from '../state/media'
import { space, useColors } from '../theme'
import { Glyph, ResizeIcon, TrashIcon } from '../ui/icons'
import { fadeIn, fadeOut, reflow, Tap } from '../ui/motion'

/** Shown while a file another device added is still on its way from Drive. */
function Arriving({ label }: { label: string }) {
  const c = useColors()
  return (
    <View style={[styles.arriving, { backgroundColor: c.surface }]}>
      <ActivityIndicator color={c.muted} />
      <Text style={{ color: c.muted }}>{label}</Text>
    </View>
  )
}

/**
 * A photo in the writing. Tapping it selects it — an amber outline and a
 * small bar to make it smaller or larger, or remove it — the way Xiaomi Notes
 * does; tapping it again while selected opens it full screen.
 */
export function ImageBlock({
  attachment,
  selected,
  onSelect,
  onResize,
  onRemove,
  onOpen,
}: {
  attachment?: Attachment
  selected: boolean
  onSelect: () => void
  onResize: () => void
  onRemove: () => void
  onOpen: (uri: string) => void
}) {
  const c = useColors()
  // Re-render when a download lands, so the placeholder turns into the photo.
  useMediaVersion()
  if (!attachment) return <Arriving label="Photo from another device" />
  if (!hasLocalCopy(attachment)) return <Arriving label="Downloading photo…" />
  const uri = attachmentFile(attachment).uri
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3
  const small = attachment.size === 'small'

  return (
    <Animated.View entering={fadeIn} layout={reflow} style={styles.block}>
      <Tap
        onPress={() => (selected ? onOpen(uri) : onSelect())}
        onLongPress={onSelect}
        scaleTo={0.985}
        style={[styles.frame, small && styles.small, { borderColor: selected ? c.accent : 'transparent' }]}
        accessibilityRole="imagebutton"
        accessibilityLabel={selected ? 'Photo, selected. Tap to open.' : 'Photo. Tap to select.'}
        accessibilityState={{ selected }}
      >
        <Image source={{ uri }} style={[styles.image, { aspectRatio: ratio, backgroundColor: c.surface }]} resizeMode="cover" />
      </Tap>
      {selected && (
        <Animated.View entering={fadeIn} exiting={fadeOut} style={[styles.photoBar, { backgroundColor: c.surfaceHigh }]}>
          <Tap onPress={onResize} scaleTo={0.92} hitSlop={6} style={styles.photoAction} accessibilityLabel={small ? 'Make larger' : 'Make smaller'}>
            <ResizeIcon color={c.fg} />
          </Tap>
          <Tap onPress={onRemove} scaleTo={0.92} hitSlop={6} style={styles.photoAction} accessibilityLabel="Remove photo">
            <TrashIcon color={c.fg} />
          </Tap>
        </Animated.View>
      )}
    </Animated.View>
  )
}

/** Bar heights that look like a recording but are stable for a given id. */
function waveform(id: string, bars: number): number[] {
  let seed = 0
  for (const ch of id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  return Array.from({ length: bars }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return 0.18 + ((seed >>> 16) % 1000) / 1250
  })
}

export function AudioBlock({ attachment, onRemove }: { attachment?: Attachment; onRemove: () => void }) {
  useMediaVersion()
  if (!attachment) return <Arriving label="Recording from another device" />
  if (!hasLocalCopy(attachment)) return <Arriving label="Downloading recording…" />
  return <AudioPlayer attachment={attachment} onRemove={onRemove} />
}

function AudioPlayer({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  const c = useColors()
  const player = useAudioPlayer(attachmentFile(attachment).uri)
  const status = useAudioPlayerStatus(player)
  const bars = useMemo(() => waveform(attachment.id, 28), [attachment.id])
  const total = (status.duration || (attachment.durationMs ?? 0) / 1000) * 1000
  const played = total > 0 ? (status.currentTime * 1000) / total : 0
  const shown = status.playing || status.currentTime > 0 ? status.currentTime * 1000 : total

  const toggle = () => {
    if (status.playing) player.pause()
    else {
      // Finished recordings rewind, so a second tap plays it again rather than nothing.
      if (status.didJustFinish || (total > 0 && status.currentTime * 1000 >= total - 50)) void player.seekTo(0)
      player.play()
    }
  }

  return (
    <Animated.View entering={fadeIn} style={[styles.block, styles.audio, { backgroundColor: c.surfaceHigh }]}>
      <Tap onPress={toggle} scaleTo={0.92} haptic="light" style={[styles.play, { backgroundColor: c.muted }]} accessibilityLabel={status.playing ? 'Pause' : 'Play'}>
        <Glyph char={status.playing ? '❚❚' : '▶'} color={c.surfaceHigh} size={status.playing ? 11 : 13} weight="700" />
      </Tap>
      <Text style={[styles.time, { color: c.fg }]}>{formatDuration(shown)}</Text>
      <View style={styles.wave}>
        {bars.map((h, i) => (
          <View key={i} style={[styles.bar, { height: 4 + h * 22, backgroundColor: i / bars.length <= played ? c.accent : c.muted }]} />
        ))}
      </View>
      <Tap onPress={onRemove} scaleTo={0.92} hitSlop={8} accessibilityLabel="Remove recording">
        <TrashIcon color={c.fg} size={20} />
      </Tap>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  block: { marginVertical: space.sm },
  /** The outline sits outside the photo, so selecting never shifts the picture. */
  frame: { borderWidth: 2, borderRadius: 14, padding: 2 },
  small: { width: '48%' },
  image: { width: '100%', borderRadius: 11, maxHeight: 520 },
  photoBar: {
    position: 'absolute',
    top: space.md,
    left: space.md,
    flexDirection: 'row',
    gap: space.xs,
    borderRadius: 14,
    paddingHorizontal: space.xs,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  photoAction: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  arriving: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: 12, marginVertical: space.sm },
  audio: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: 16, paddingHorizontal: space.lg, paddingVertical: space.md },
  play: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  time: { fontVariant: ['tabular-nums'], fontSize: 16, minWidth: 48 },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 28 },
  bar: { flex: 1, borderRadius: 1 },
})
