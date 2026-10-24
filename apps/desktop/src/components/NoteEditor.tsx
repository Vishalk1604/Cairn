import { joinBlocks, splitBody, type Attachment, type Note } from '@cairn/core'
import {
  canRedo,
  canUndo,
  createHistory,
  createNoteSaveQueue,
  edit as recordEdit,
  keepNoteDraft,
  noteCharacterCount,
  noteTimestamp,
  redo,
  undo,
  type History,
  type NoteFormValues,
} from '@cairn/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useMediaFolder, useMediaUrl } from '../app/media'
import { BackIcon, CheckIcon, PinIcon, RedoIcon, UndoIcon } from './icons'

/** How long typing pauses before the words are written down on this computer. */
const DRAFT_MS = 800

/** The text under undo/redo. Tags and pinning are settings, not writing. */
interface Text {
  title: string
  body: string
}

/**
 * A full-window writing surface: title, a date and length line, then the note
 * itself filling everything that is left. Saves on the way out — leaving the
 * note, Ctrl+S, or switching away from the window — so there is no save
 * button to forget, and a long note costs the cloud one write rather than one
 * every pause. Until then the words are kept on this computer.
 */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
  const { platform } = useCairn()
  const [queue] = useState(() => createNoteSaveQueue(actions, note))
  const [history, setHistory] = useState<History<Text>>(() =>
    createHistory({ title: note?.title ?? '', body: note?.body ?? '' }, Date.now()),
  )
  const [tags, setTags] = useState(note?.tags.join(' ') ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [status, setStatus] = useState<'saved' | 'unsaved'>('saved')
  const [showTags, setShowTags] = useState(Boolean(note?.tags.length))
  // Only steal the caret when the field is opened by hand; a note that
  // already has tags should still put the caret in the note itself.
  const [tagsJustOpened, setTagsJustOpened] = useState(false)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const blocksRef = useRef<HTMLDivElement>(null)
  const text = history.present
  // Photos and recordings are lines in the body that only the phone can show.
  // Each run of writing between them gets its own field, so nothing typed
  // here can delete one by accident.
  const attachments = note?.attachments
  const blocks = useMemo(() => splitBody(text.body, attachments), [text.body, attachments])
  const hasMedia = blocks.length > 1

  const latest = useRef<NoteFormValues | null>(null)
  const push = useCallback(
    (next: History<Text>, extra?: { tags?: string; pinned?: boolean }) => {
      setHistory(next)
      const values = {
        title: next.present.title,
        body: next.present.body,
        tags: extra?.tags ?? tags,
        pinned: extra?.pinned ?? pinned,
      }
      latest.current = values
      queue.change(values)
      setStatus('unsaved')
    },
    [queue, tags, pinned],
  )

  const change = (patch: Partial<Text>) => push(recordEdit(history, { ...text, ...patch }, Date.now()))
  const changeRun = (index: number, value: string) =>
    change({ body: joinBlocks(blocks.map((b, i) => (i === index && b.kind === 'text' ? { ...b, text: value } : b))) })
  const stepBack = () => push(undo(history, Date.now()))
  const stepForward = () => push(redo(history, Date.now()))

  /** Writes the note, once, and forgets the draft it no longer needs. */
  const saveNow = useCallback(async () => {
    await queue.save()
    if (queue.dirty) return
    setStatus('saved')
    latest.current = null
    void keepNoteDraft(platform.storage, null)
  }, [queue, platform])

  useEffect(() => {
    if (!queue.dirty) return
    const timer = setTimeout(() => {
      const values = latest.current
      if (values) void keepNoteDraft(platform.storage, { noteId: queue.saved?.id ?? note?.id, values, at: Date.now() })
    }, DRAFT_MS)
    return () => clearTimeout(timer)
  }, [history, tags, pinned, queue, note, platform])

  // Switching to another window, hiding Cairn to the tray, or quitting is as
  // good as leaving the note: the person may not come back to it for a while.
  useEffect(() => {
    const away = () => {
      if (queue.dirty) void saveNow()
    }
    const hidden = () => document.visibilityState === 'hidden' && away()
    window.addEventListener('blur', away)
    window.addEventListener('pagehide', away)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      window.removeEventListener('blur', away)
      window.removeEventListener('pagehide', away)
      document.removeEventListener('visibilitychange', hidden)
      // Closed some other way than the buttons: write what is pending.
      away()
    }
  }, [queue, saveNow])

  // Opening an existing note should let you carry on writing, so the caret
  // goes to the end rather than sitting in front of what you already wrote.
  useEffect(() => {
    if (!note) return
    const field = bodyRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
    field.scrollTop = field.scrollHeight
    if (blocksRef.current) blocksRef.current.scrollTop = blocksRef.current.scrollHeight
  }, [note])

  const leave = useCallback(() => void saveNow().then(onClose), [saveNow, onClose])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') {
      event.preventDefault()
      leave()
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void saveNow()
    } else if (mod && !event.shiftKey && event.key.toLowerCase() === 'z') {
      // The browser's own undo cannot see a controlled input's history.
      event.preventDefault()
      stepBack()
    } else if (mod && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault()
      stepForward()
    }
  }

  const savedAt = queue.saved?.updatedAt ?? note?.updatedAt ?? Date.now()

  return (
    <section className="note-editor" onKeyDown={onKeyDown} aria-label={note ? 'Edit note' : 'New note'}>
      <header className="note-bar">
        <button type="button" className="icon" onClick={leave} aria-label="Back to notes" title="Back (Esc)">
          <BackIcon />
        </button>
        <span className="spacer" />
        <button type="button" className="icon" onClick={stepBack} disabled={!canUndo(history)} aria-label="Undo" title="Undo (Ctrl+Z)">
          <UndoIcon />
        </button>
        <button type="button" className="icon" onClick={stepForward} disabled={!canRedo(history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          <RedoIcon />
        </button>
        <button
          type="button"
          className="icon"
          aria-pressed={pinned}
          aria-label={pinned ? 'Unpin note' : 'Pin note'}
          title={pinned ? 'Unpin' : 'Pin to the top'}
          onClick={() => {
            const next = !pinned
            setPinned(next)
            push(history, { pinned: next })
          }}
        >
          <PinIcon filled={pinned} />
        </button>
        <button type="button" className="icon" onClick={leave} aria-label="Done" title="Done (Esc)">
          <CheckIcon />
        </button>
      </header>

      <div className="note-sheet">
        <input
          className="note-title"
          value={text.title}
          onChange={(e) => change({ title: e.target.value })}
          onKeyDown={(e) => {
            // Enter in the title belongs in the body, not as a newline.
            if (e.key === 'Enter') {
              e.preventDefault()
              bodyRef.current?.focus()
            }
          }}
          placeholder="Title"
          aria-label="Title"
          autoFocus={!note}
        />

        <p className="note-meta">
          <span>{noteTimestamp(savedAt)}</span>
          <span aria-hidden="true">|</span>
          <span>{noteCharacterCount(text.title, text.body)}</span>
          <span className="note-status" aria-live="polite">
            {status === 'unsaved' ? 'Saves when you leave' : queue.saved ? 'Saved' : ''}
          </span>
        </p>

        <div ref={blocksRef} className={hasMedia ? 'note-blocks with-media' : 'note-blocks'}>
          {blocks.map((b, i) =>
            b.kind === 'media' ? (
              <MediaCard key={b.id} attachment={b.attachment} />
            ) : (
              <textarea
                // A run is known by its place: the media around it never move here.
                key={i}
                ref={i === blocks.length - 1 ? bodyRef : undefined}
                className={i === blocks.length - 1 ? 'note-body' : 'note-body note-run'}
                rows={i === blocks.length - 1 ? undefined : Math.max(1, b.text.split('\n').length)}
                value={b.text}
                onChange={(e) => changeRun(i, e.target.value)}
                placeholder={hasMedia ? undefined : 'Start typing'}
                aria-label="Note"
                spellCheck
              />
            ),
          )}
        </div>

        <footer className="note-foot">
          {showTags ? (
            <input
              className="note-tags"
              value={tags}
              onChange={(e) => {
                setTags(e.target.value)
                push(history, { tags: e.target.value })
              }}
              placeholder="Tags, separated by spaces"
              aria-label="Tags"
              autoFocus={tagsJustOpened}
            />
          ) : (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setTagsJustOpened(true)
                setShowTags(true)
              }}
            >
              Add tags
            </button>
          )}
          <span className="spacer" />
          {queue.saved && (
            <button
              type="button"
              className="quiet"
              onClick={async () => {
                void keepNoteDraft(platform.storage, null)
                await actions.removeNote(queue.saved!)
                onClose()
              }}
            >
              Delete
            </button>
          )}
        </footer>
      </div>
    </section>
  )
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * A photo or recording, once it is in the media folder. Until then, a card
 * that says why it is not here yet.
 */
function MediaCard({ attachment }: { attachment?: Attachment }) {
  const folder = useMediaFolder()
  const url = useMediaUrl(attachment)
  const audio = attachment?.kind === 'audio'
  const label = audio ? 'Recording' : 'Photo'
  const length = audio && attachment.durationMs ? ` · ${duration(attachment.durationMs)}` : ''

  if (url && attachment?.kind === 'image') {
    return (
      <figure className="note-photo">
        <img src={url} alt="" width={attachment.width} height={attachment.height} />
      </figure>
    )
  }
  if (url && audio) {
    return (
      <div className="note-media">
        <span className="note-media-glyph" aria-hidden="true">
          ♪
        </span>
        <span className="note-media-label">
          {label}
          {length}
        </span>
        <audio className="note-audio" controls src={url} preload="metadata" />
      </div>
    )
  }

  const hint = !attachment
    ? 'Still on its way from your phone'
    : !folder
      ? `Open this note in the Cairn app to ${audio ? 'play' : 'see'} it`
      : !folder.signedIn
        ? 'Sign in to fetch it from your Drive'
        : !attachment.driveFileId
          ? 'Waiting for your phone to upload it'
          : 'Fetching it from your Drive…'
  return (
    <div className="note-media" role="img" aria-label={`${label}${length}. ${hint}`}>
      <span className="note-media-glyph" aria-hidden="true">
        {audio ? '♪' : '▣'}
      </span>
      <span className="note-media-label">
        {label}
        {length}
      </span>
      <span className="note-media-hint">{hint}</span>
    </div>
  )
}
