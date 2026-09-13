import type { Note } from '@cairn/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useActions } from '../app/actions'
import { useModal } from '../app/useModal'

const AUTOSAVE_MS = 800

/**
 * Saves on a debounce while typing and once more on close, never per
 * keystroke. Saves run one at a time, so a new note is created exactly once.
 */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
  const [title, setTitle] = useState(note?.title ?? '')
  const [body, setBody] = useState(note?.body ?? '')
  const [tags, setTags] = useState(note?.tags.join(' ') ?? '')
  const [pinned, setPinned] = useState(note?.pinned ?? false)
  const [status, setStatus] = useState<'saved' | 'unsaved'>('saved')

  const saved = useRef<Note | undefined>(note)
  const values = useRef({ title, body, tags, pinned })
  values.current = { title, body, tags, pinned }
  const dirty = useRef(false)
  const queue = useRef<Promise<void>>(Promise.resolve())

  const persist = useCallback(() => {
    queue.current = queue.current.then(async () => {
      const v = values.current
      if (!dirty.current || (!v.title.trim() && !v.body.trim())) return
      dirty.current = false
      const input = { title: v.title, body: v.body, tags: v.tags.split(/[\s,]+/).filter(Boolean), pinned: v.pinned }
      const result = saved.current ? await actions.saveNote(saved.current, input) : await actions.addNote(input)
      if (result) {
        saved.current = result
        if (!dirty.current) setStatus('saved')
      } else {
        dirty.current = true
      }
    })
    return queue.current
  }, [actions])

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    dirty.current = true
    setStatus('unsaved')
  }

  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => void persist(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [title, body, tags, pinned, persist])

  const modal = useModal(() => void persist().then(onClose))

  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-label={note ? 'Edit note' : 'New note'}>
      <input className="note-title" value={title} onChange={(e) => edit(setTitle)(e.target.value)} placeholder="Title" aria-label="Title" autoFocus />
      <textarea value={body} onChange={(e) => edit(setBody)(e.target.value)} placeholder="Write anything" aria-label="Note text" rows={12} />
      <div className="field-row">
        <label>
          Tags
          <input value={tags} onChange={(e) => edit(setTags)(e.target.value)} placeholder="os lecture" />
        </label>
        <label className="inline">
          <input type="checkbox" checked={pinned} onChange={(e) => edit(setPinned)(e.target.checked)} />
          Pinned
        </label>
      </div>
      <div className="editor-actions">
        <span className="hint" aria-live="polite">
          {status === 'saved' ? (saved.current ? 'Saved' : '') : 'Saving…'}
        </span>
        <span className="spacer" />
        <button type="button" className="primary" onClick={modal.close}>
          Done
        </button>
      </div>
    </dialog>
  )
}
