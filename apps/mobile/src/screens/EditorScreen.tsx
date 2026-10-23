import {
  insertMedia,
  joinBlocks,
  parseCapture,
  removeMedia,
  splitBody,
  type Attachment,
  type CaptureResult,
  type Note,
  type NoteBlock,
} from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import {
  canRedo,
  canUndo,
  createHistory,
  createNoteSaveQueue,
  edit as recordEdit,
  formatDue,
  noteCharacterCount,
  noteTimestamp,
  redo,
  undo,
  type History,
} from '@cairn/ui'
import { RecordingPresets, useAudioRecorder } from 'expo-audio'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, BackHandler, Image, Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedKeyboard, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AudioBlock, ImageBlock } from '../components/MediaBlocks'
import { formatDuration, keepRecording, pickImage, prepareToRecord } from '../platform/media'
import { useActions } from '../state/actions'
import { useCairn } from '../state/context'
import { foldersOf, folderTag, isRealFolder, usePinnedFolders } from '../state/folders'
import { useObserved } from '../state/hooks'
import { FONT_SCALE, usePreferences } from '../state/preferences'
import { useToast } from '../state/toast'
import { radius, space, useColors } from '../theme'
import { CameraIcon, FolderIcon, Glyph, ImageIcon, MicIcon, TrashIcon } from '../ui/icons'
import { appear, duration, fadeIn, fadeOut, feel, sheetIn, sheetOut, Tap } from '../ui/motion'

const AUTOSAVE_MS = 700
const ALL: NoteQuery = {}

/** What undo and redo step through. The body is the serialized form, markers and all. */
interface Writing {
  title: string
  body: string
}

/** The line Cairn reads for a date: the title, or the first line typed when there is none. */
function headOf(title: string, text: string): { head: string; rest: string; fromTitle: boolean } {
  if (title.trim()) return { head: title.trim(), rest: text, fromTitle: true }
  const lines = text.split('\n')
  const first = lines.findIndex((l) => l.trim())
  if (first < 0) return { head: '', rest: '', fromTitle: false }
  return { head: lines[first]!.trim(), rest: lines.slice(first + 1).join('\n'), fromTitle: false }
}

/**
 * The one place things are written.
 *
 * The body is drawn as alternating text and media. Each run of text is its
 * own field, so a photo or recording can sit between paragraphs; which run
 * holds the caret, and where in it, is tracked so an insert lands exactly at
 * the cursor on a line of its own, and typing carries on underneath.
 *
 * Whether this becomes a note or a task is decided by the writing itself: a
 * date in the title (or the first line, with no title) makes a task, and the
 * rest becomes its detail. The decision is shown while typing and can be
 * overruled, so nothing is filed somewhere unexpected.
 */
export function EditorScreen({ note, folder, onClose }: { note?: Note; folder?: string; onClose: () => void }) {
  const c = useColors()
  const actions = useActions()
  const toast = useToast()
  const { notes } = useCairn()
  const { preferences } = usePreferences()
  const { pinned: pinnedFolders } = usePinnedFolders()
  const allNotes = useObserved(notes, ALL)

  const [queue] = useState(() => createNoteSaveQueue(actions, note))
  const [history, setHistory] = useState<History<Writing>>(() =>
    createHistory({ title: note?.title ?? '', body: note?.body ?? '' }, Date.now()),
  )
  // Every attachment ever added this session stays here, so undoing a removal
  // can bring the photo back; the save drops whatever the body no longer uses.
  const [attachments, setAttachments] = useState<Attachment[]>(note?.attachments ?? [])
  const [tags, setTags] = useState<string[]>(note?.tags ?? (folder && isRealFolder(folder) ? [folder] : []))
  const [literal, setLiteral] = useState(false)
  const [recording, setRecording] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  /** The photo showing its outline and resize/delete bar, if any. */
  const [selected, setSelected] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState(note?.updatedAt ?? Date.now())
  const leaving = useRef(false)

  const runs = useRef(new Map<number, TextInput>())
  const titleRef = useRef<TextInput>(null)
  const focus = useRef<{ run: number; caret: number } | null>(null)
  const pendingFocus = useRef<{ run: number; caret: number } | null>(null)

  const writing = history.present
  const blocks = useMemo(() => splitBody(writing.body, attachments), [writing.body, attachments])
  const text = useMemo(
    () => blocks.filter((b): b is Extract<NoteBlock, { kind: 'text' }> => b.kind === 'text').map((b) => b.text).join('\n'),
    [blocks],
  )
  const hasMedia = blocks.some((b) => b.kind === 'media')
  const { head, rest, fromTitle } = headOf(writing.title, text)
  const now = Date.now()
  const parsed: CaptureResult | null = head ? parseCapture(head, now) : null
  const isNew = !note
  const dated = parsed?.kind === 'reminder'
  const willBeTask = isNew && dated && !literal && !hasMedia

  /** The note this would be saved as, with any #tags and !priority lifted out of the title. */
  const values = useCallback(() => {
    const fromCapture = fromTitle && parsed ? parsed.tags : []
    return {
      title: fromTitle && parsed && parsed.kind === 'note' ? parsed.title : writing.title,
      body: writing.body,
      tags: [...new Set([...tags, ...fromCapture])].join(' '),
      pinned: note?.pinned ?? false,
      attachments,
    }
  }, [fromTitle, parsed, writing, tags, note, attachments])

  const push = (next: History<Writing>) => setHistory(next)
  const change = (patch: Partial<Writing>) => push(recordEdit(history, { ...writing, ...patch }, Date.now()))

  /**
   * Hands the queue the current values only if they differ from what it last
   * got. Without the comparison, every save re-renders this screen (the notes
   * list it watches changes), which stages the same values again, which saves
   * again — so merely opening a note rewrote it every few hundred milliseconds
   * and floated it to the top of the grid.
   */
  const staged = useRef<string | null>(null)
  const stage = useCallback((): boolean => {
    const v = values()
    const key = JSON.stringify(v)
    if (staged.current === null) {
      // The first look is the note as it was opened: nothing to save yet.
      staged.current = key
      return false
    }
    if (key === staged.current) return false
    staged.current = key
    queue.change(v)
    return true
  }, [values, queue])

  // Drafts autosave as notes. A draft that has turned into a task waits for
  // the way out instead, so it never flickers into the notes grid first.
  useEffect(() => {
    if (willBeTask || !stage()) return
    const timer = setTimeout(() => {
      void queue.save().then(() => queue.saved && setSavedAt(queue.saved.updatedAt))
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [stage, willBeTask, queue])

  // Leaving the app is as good as leaving the note: the person may never come back to it.
  const latest = useRef({ stage, willBeTask })
  latest.current = { stage, willBeTask }
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' || latest.current.willBeTask) return
      latest.current.stage()
      void queue.save()
    })
    return () => {
      sub.remove()
      // Closed some other way than the buttons, mid-autosave: write what is pending.
      if (!leaving.current && queue.dirty) void queue.save()
    }
  }, [queue])

  // The system back gesture goes the same way as the back arrow, so it saves,
  // and a dated draft still becomes its task.
  const leaveRef = useRef<() => void>(() => {})
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedRef.current) setSelected(null)
      else leaveRef.current()
      return true
    })
    return () => sub.remove()
  }, [])

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const input = runs.current.get(target.run)
    // A frame later, once the new run exists to receive focus.
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelection(target.caret, target.caret)
    })
  }, [blocks])

  const leave = useCallback(async () => {
    if (leaving.current) return
    leaving.current = true
    Keyboard.dismiss()
    try {
      if (willBeTask) {
        // A draft saved before the date was typed becomes the task, not a twin of it.
        if (queue.saved) await notes.remove(queue.saved.id, Date.now())
        await actions.capture({ title: head, body: rest.trim() ? rest : undefined })
      } else {
        stage()
        await queue.save()
      }
    } finally {
      onClose()
    }
  }, [willBeTask, queue, notes, actions, head, rest, stage, onClose])
  leaveRef.current = () => void leave()

  const setRun = (index: number, value: string) => {
    const next = blocks.map((b, i) => (i === index && b.kind === 'text' ? { kind: 'text' as const, text: value } : b))
    change({ body: joinBlocks(next) })
  }

  const insert = (attachment: Attachment) => {
    const lastText = blocks.length - 1
    const at = focus.current && blocks[focus.current.run]?.kind === 'text' ? focus.current : { run: lastText, caret: Infinity }
    const target = blocks[at.run]
    const caret = target?.kind === 'text' ? Math.min(at.caret, target.text.length) : 0
    setAttachments((list) => [...list, attachment])
    const next = insertMedia(blocks, at.run, caret, attachment)
    change({ body: joinBlocks(next) })
    // Writing carries on under the new photo, the way it would on paper.
    pendingFocus.current = { run: at.run + 2, caret: 0 }
    feel('light')
  }

  /** Toggles a photo between full width and small. Its size is part of the note, so it saves with it. */
  const resize = (id: string) => {
    setAttachments((list) =>
      list.map((a) => {
        if (a.id !== id) return a
        if (a.size === 'small') {
          const { size: _full, ...rest } = a
          return rest
        }
        return { ...a, size: 'small' }
      }),
    )
    feel('light')
  }

  const remove = (id: string) => {
    setSelected(null)
    change({ body: joinBlocks(removeMedia(blocks, id)) })
    feel('medium')
    toast({ message: 'Removed', action: { label: 'Undo', run: () => setHistory((h) => undo(h, Date.now())) } })
  }

  // The picker takes a moment to open; a second tap in that moment used to
  // open a second picker and put the same photo in twice.
  const picking = useRef(false)
  const addImage = async (source: 'library' | 'camera') => {
    if (picking.current) return
    picking.current = true
    try {
      const picked = await pickImage(source)
      if (picked) insert(picked)
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : String(error), tone: 'error' })
    } finally {
      picking.current = false
    }
  }

  const fontSize = 17 * FONT_SCALE[preferences.fontSize]
  const folderName = tags[0]?.toUpperCase()

  // Android 15 draws edge to edge and no longer shrinks the window for the
  // keyboard, so the editor makes room itself — tracking the keyboard frame
  // by frame, which also lets the toolbar ride up with it instead of jumping.
  const keyboard = useAnimatedKeyboard()
  const insets = useSafeAreaInsets()
  const lift = useAnimatedStyle(() => ({ paddingBottom: Math.max(0, keyboard.height.value - insets.bottom) }))

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: c.bg }]} edges={['top', 'bottom', 'left', 'right']}>
      <Animated.View style={[styles.flex, lift]}>
      <View style={styles.bar}>
        <IconTap label="Back" onPress={() => void leave()}>
          <Glyph char="←" color={c.fg} />
        </IconTap>
        <View style={styles.spacer} />
        <IconTap label="Undo" disabled={!canUndo(history)} onPress={() => push(undo(history, Date.now()))}>
          <Glyph char="↶" color={c.fg} />
        </IconTap>
        <IconTap label="Redo" disabled={!canRedo(history)} onPress={() => push(redo(history, Date.now()))}>
          <Glyph char="↷" color={c.fg} />
        </IconTap>
        {note && (
          <IconTap label="Delete note" onPress={async () => {
            leaving.current = true
            await actions.removeNote(queue.saved ?? note)
            onClose()
          }}>
            <TrashIcon color={c.fg} />
          </IconTap>
        )}
        <IconTap label="Done" onPress={() => void leave()}>
          <Glyph char="✓" color={c.fg} weight="600" />
        </IconTap>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <TextInput
          ref={titleRef}
          value={writing.title}
          onChangeText={(title) => change({ title })}
          onSubmitEditing={() => runs.current.get(0)?.focus()}
          onFocus={() => setSelected(null)}
          placeholder="Title"
          placeholderTextColor={c.faint}
          style={[styles.title, { color: c.fg }]}
          submitBehavior="submit"
          returnKeyType="next"
          accessibilityLabel="Title"
          autoFocus={isNew}
          multiline
        />

        <View style={styles.meta}>
          <Text style={[styles.metaText, { color: c.faint }]}>{noteTimestamp(savedAt)}</Text>
          <View style={[styles.rule, { backgroundColor: c.faint }]} />
          <Text style={[styles.metaText, { color: c.faint }]}>{noteCharacterCount(writing.title, text)}</Text>
        </View>

        <View style={styles.pills}>
          {willBeTask && parsed?.dueAt !== undefined && (
            <Animated.View entering={appear} exiting={fadeOut}>
              <Tap onPress={() => setLiteral(true)} scaleTo={0.95} style={[styles.pill, { borderColor: c.accent, backgroundColor: c.accent + '22' }]} accessibilityLabel="This will be a task. Tap to keep it as a note.">
                <Text style={{ color: c.accent, fontWeight: '600' }}>Task · {formatDue(parsed.dueAt, parsed.allDay, now)}</Text>
                <Text style={{ color: c.muted }}>  Keep as note</Text>
              </Tap>
            </Animated.View>
          )}
          {isNew && dated && literal && (
            <Animated.View entering={fadeIn}>
              <Tap onPress={() => setLiteral(false)} scaleTo={0.95} style={[styles.pill, { borderColor: c.line }]}>
                <Text style={{ color: c.muted }}>Kept as a note · </Text>
                <Text style={{ color: c.accent }}>Make it a task</Text>
              </Tap>
            </Animated.View>
          )}
          {!willBeTask && (
            <Tap onPress={() => setSheet(true)} scaleTo={0.95} style={[styles.pill, { borderColor: c.line }]} accessibilityLabel="Choose folder">
              <FolderIcon color={folderName ? c.accent : c.muted} size={16} />
              <Text style={{ color: folderName ? c.fg : c.muted }}>  {folderName ?? 'No folder'}</Text>
            </Tap>
          )}
        </View>

        {blocks.map((block, index) =>
          block.kind === 'text' ? (
            <TextInput
              key={`run-${index}`}
              ref={(input) => {
                if (input) runs.current.set(index, input)
                else runs.current.delete(index)
              }}
              value={block.text}
              onChangeText={(value) => setRun(index, value)}
              onFocus={() => {
                setSelected(null)
                focus.current = { run: index, caret: focus.current?.run === index ? focus.current.caret : block.text.length }
              }}
              onSelectionChange={(e) => (focus.current = { run: index, caret: e.nativeEvent.selection.start })}
              placeholder={index === 0 && blocks.length === 1 ? 'Start typing' : undefined}
              placeholderTextColor={c.faint}
              style={[styles.body, { color: c.fg, fontSize, lineHeight: fontSize * 1.5 }, index === blocks.length - 1 && styles.lastRun]}
              multiline
              scrollEnabled={false}
              textAlignVertical="top"
              accessibilityLabel="Note"
            />
          ) : block.attachment?.kind === 'audio' ? (
            <AudioBlock key={block.id} attachment={block.attachment} onRemove={() => remove(block.id)} />
          ) : (
            <ImageBlock
              key={block.id}
              attachment={block.attachment}
              selected={selected === block.id}
              onSelect={() => {
                Keyboard.dismiss()
                setSelected(block.id)
              }}
              onResize={() => resize(block.id)}
              onRemove={() => remove(block.id)}
              onOpen={setViewing}
            />
          ),
        )}
      </ScrollView>

      {recording ? (
        <Recorder
          onDone={(attachment) => {
            setRecording(false)
            insert(attachment)
          }}
          onCancel={(message) => {
            setRecording(false)
            if (message) toast({ message, tone: 'error' })
          }}
        />
      ) : (
        <View style={[styles.tools, { borderTopColor: c.line, backgroundColor: c.bg }]}>
          <ToolTap label="Record audio" onPress={() => !picking.current && setRecording(true)}>
            <MicIcon color={c.fg} />
          </ToolTap>
          <ToolTap label="Add a photo" onPress={() => void addImage('library')}>
            <ImageIcon color={c.fg} />
          </ToolTap>
          <ToolTap label="Take a photo" onPress={() => void addImage('camera')}>
            <CameraIcon color={c.fg} />
          </ToolTap>
        </View>
      )}
      </Animated.View>

      {sheet && (
        <FolderSheet
          folders={foldersOf(allNotes, pinnedFolders).filter((f) => isRealFolder(f.id)).map((f) => f.id)}
          current={tags[0]}
          onPick={(tag) => {
            setTags(tag ? [tag] : [])
            setSheet(false)
          }}
          onClose={() => setSheet(false)}
        />
      )}

      {viewing && (
        <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.viewer]}>
          <Tap onPress={() => setViewing(null)} scaleTo={1} haptic="none" style={styles.flex} accessibilityLabel="Close photo">
            <Image source={{ uri: viewing }} style={styles.flex} resizeMode="contain" />
          </Tap>
        </Animated.View>
      )}
    </SafeAreaView>
  )
}

function IconTap({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tap onPress={onPress} disabled={disabled} scaleTo={0.92} hitSlop={6} style={styles.icon} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Tap>
  )
}

function ToolTap({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Tap onPress={onPress} scaleTo={0.92} haptic="light" style={styles.tool} accessibilityRole="button" accessibilityLabel={label}>
      {children}
    </Tap>
  )
}

/** Records until stopped, with a live timer and a beating dot so it is obvious the microphone is open. */
function Recorder({ onDone, onCancel }: { onDone: (a: Attachment) => void; onCancel: (message?: string) => void }) {
  const c = useColors()
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const pulse = useSharedValue(1)
  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }))
  // The callbacks change on every render of the editor. Starting the
  // recorder must not depend on them, or each render re-prepared a recorder
  // that was already recording — which threw, or quietly started over.
  const handlers = useRef({ onDone, onCancel })
  handlers.current = { onDone, onCancel }
  const state = useRef<'starting' | 'recording' | 'finishing' | 'done'>('starting')

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await prepareToRecord()
        await recorder.prepareToRecordAsync()
        if (!alive) return
        recorder.record()
        state.current = 'recording'
        setStartedAt(Date.now())
        feel('medium')
      } catch (error) {
        state.current = 'done'
        if (alive) handlers.current.onCancel(error instanceof Error ? error.message : String(error))
      }
    })()
    pulse.value = withRepeat(withTiming(0.25, { duration: 650 }), -1, true)
    return () => {
      alive = false
      // Leaving the note mid-recording stops the microphone rather than leaving it open.
      if (state.current === 'recording') void recorder.stop().catch(() => {})
      state.current = 'done'
    }
  }, [recorder, pulse])

  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setElapsed(Date.now() - startedAt), 200)
    return () => clearInterval(timer)
  }, [startedAt])

  const finish = async (keep: boolean) => {
    if (state.current !== 'recording') {
      if (!keep) handlers.current.onCancel()
      return
    }
    state.current = 'finishing'
    try {
      const measured = recorder.getStatus().durationMillis
      await recorder.stop()
      state.current = 'done'
      if (!keep || !recorder.uri) return handlers.current.onCancel()
      handlers.current.onDone(await keepRecording(recorder.uri, measured || elapsed))
    } catch (error) {
      state.current = 'done'
      handlers.current.onCancel(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <Animated.View entering={appear} style={[styles.recorder, { backgroundColor: c.surfaceHigh }]}>
      <Animated.View style={[styles.recDot, dot]} />
      <Text style={[styles.recTime, { color: c.fg }]}>{formatDuration(elapsed)}</Text>
      <View style={styles.spacer} />
      <Tap onPress={() => void finish(false)} scaleTo={0.94} style={styles.recButton} accessibilityLabel="Discard recording">
        <Text style={{ color: c.muted }}>Cancel</Text>
      </Tap>
      <Tap
        onPress={() => void finish(true)}
        disabled={startedAt === null}
        scaleTo={0.94}
        haptic="medium"
        style={[styles.recButton, { backgroundColor: c.accent }]}
        accessibilityLabel="Stop and add recording"
      >
        <Text style={{ color: c.onAccent, fontWeight: '700' }}>Done</Text>
      </Tap>
    </Animated.View>
  )
}

function FolderSheet({
  folders,
  current,
  onPick,
  onClose,
}: {
  folders: string[]
  current?: string
  onPick: (tag: string | null) => void
  onClose: () => void
}) {
  const c = useColors()
  const [name, setName] = useState('')
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Tap onPress={onClose} scaleTo={1} haptic="none" style={styles.flex} accessibilityLabel="Close">
        <View />
      </Tap>
      <Animated.View entering={sheetIn} exiting={sheetOut} style={[styles.sheet, { backgroundColor: c.surface }]}>
        <Text style={[styles.sheetTitle, { color: c.fg }]}>Move to folder</Text>
        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {[null, ...folders].map((tag) => (
            <Tap key={tag ?? 'none'} onPress={() => onPick(tag)} scaleTo={0.98} style={styles.sheetRow}>
              <Text style={{ color: c.fg, fontSize: 16, flex: 1 }}>{tag ? tag.toUpperCase() : 'No folder'}</Text>
              {(tag ?? undefined) === current && <Glyph char="✓" color={c.accent} size={18} />}
            </Tap>
          ))}
        </ScrollView>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New folder"
          placeholderTextColor={c.faint}
          style={[styles.sheetInput, { color: c.fg, backgroundColor: c.surfaceHigh }]}
          autoCapitalize="characters"
          returnKeyType="done"
          onSubmitEditing={() => {
            const tag = folderTag(name)
            if (tag) onPick(tag)
          }}
        />
      </Animated.View>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  flex: { flex: 1 },
  spacer: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.sm, paddingTop: space.xs, gap: space.xs },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  page: { paddingHorizontal: space.xl, paddingBottom: 120 },
  title: { fontSize: 30, fontWeight: '700', paddingVertical: space.sm },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md },
  metaText: { fontSize: 13 },
  rule: { width: StyleSheet.hairlineWidth * 2, height: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  pill: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: space.md, paddingVertical: 6 },
  body: { padding: 0, minHeight: 28 },
  lastRun: { minHeight: 240 },
  tools: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: space.sm },
  tool: { width: 56, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  recorder: { flexDirection: 'row', alignItems: 'center', gap: space.md, margin: space.md, padding: space.md, paddingLeft: space.lg, borderRadius: 28 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#ff453a' },
  recTime: { fontSize: 18, fontVariant: ['tabular-nums'] },
  recButton: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: 20 },
  viewer: { backgroundColor: '#000' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: space.lg, paddingBottom: space.xl, gap: space.sm },
  sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: space.sm },
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md },
  sheetInput: { borderRadius: 12, paddingHorizontal: space.lg, paddingVertical: space.md, marginTop: space.sm },
})
