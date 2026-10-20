import type { Note } from '@cairn/core'
import {
  canRedo,
  canUndo,
  createHistory,
  createNoteSaveQueue,
  edit as recordEdit,
  noteCharacterCount,
  noteTimestamp,
  redo,
  undo,
  type History,
} from '@cairn/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActions } from '../app/actions'

const AUTOSAVE_MS = 800

/** The text under undo/redo. Tags and pinning are settings, not writing. */
interface Text {
  title: string
  body: string
}

/**
 * A full-window writing surface: title, a date and length line, then the note
 * itself filling everything that is left. Saves on a pause and again on the
 * way out, so there is no save button to forget.
 */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
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
  const text = history.present

  const push = useCallback(
    (next: History<Text>, extra?: { tags?: string; pinned?: boolean }) => {
      setHistory(next)
      queue.change({
        title: next.present.title,
        body: next.present.body,
        tags: extra?.tags ?? tags,
        pinned: extra?.pinned ?? pinned,
      })
      setStatus('unsaved')
    },
    [queue, tags, pinned],
  )

  const change = (patch: Partial<Text>) => push(recordEdit(history, { ...text, ...patch }, Date.now()))
  const stepBack = () => push(undo(history, Date.now()))
  const stepForward = () => push(redo(history, Date.now()))

  useEffect(() => {
    if (!queue.dirty) return
    const timer = setTimeout(() => {
      void queue.save().then(() => {
        if (!queue.dirty) setStatus('saved')
      })
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [history, tags, pinned, queue])

  // Opening an existing note should let you carry on writing, so the caret
  // goes to the end rather than sitting in front of what you already wrote.
  useEffect(() => {
    if (!note) return
    const field = bodyRef.current
    if (!field) return
    field.focus()
    field.setSelectionRange(field.value.length, field.value.length)
    field.scrollTop = field.scrollHeight
  }, [note])

  const leave = useCallback(() => void queue.save().then(onClose), [queue, onClose])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'Escape') {
      event.preventDefault()
      leave()
    } else if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void queue.save().then(() => setStatus('saved'))
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
          ←
        </button>
        <span className="spacer" />
        <button type="button" className="icon" onClick={stepBack} disabled={!canUndo(history)} aria-label="Undo" title="Undo (Ctrl+Z)">
          ↶
        </button>
        <button type="button" className="icon" onClick={stepForward} disabled={!canRedo(history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
          ↷
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
          {pinned ? '★' : '☆'}
        </button>
        <button type="button" className="icon" onClick={leave} aria-label="Done" title="Done (Esc)">
          ✓
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
            {status === 'unsaved' ? 'Saving…' : queue.saved ? 'Saved' : ''}
          </span>
        </p>

        <textarea
          ref={bodyRef}
          className="note-body"
          value={text.body}
          onChange={(e) => change({ body: e.target.value })}
          placeholder="Start typing"
          aria-label="Note"
          spellCheck
        />

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
