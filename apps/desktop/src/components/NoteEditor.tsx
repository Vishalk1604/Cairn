import type { Note } from '@cairn/core'
import { createNoteSaveQueue, type NoteFormValues } from '@cairn/ui'
import { useEffect, useState } from 'react'
import { useActions } from '../app/actions'
import { useModal } from '../app/useModal'

const AUTOSAVE_MS = 800

/** Saves on a debounce while typing and once more on close, never per keystroke. */
export function NoteEditor({ note, onClose }: { note?: Note; onClose: () => void }) {
  const actions = useActions()
  const [queue] = useState(() => createNoteSaveQueue(actions, note))
  const [values, setValues] = useState<NoteFormValues>(() => ({
    title: note?.title ?? '',
    body: note?.body ?? '',
    tags: note?.tags.join(' ') ?? '',
    pinned: note?.pinned ?? false,
  }))
  const [status, setStatus] = useState<'saved' | 'unsaved'>('saved')

  const edit = (patch: Partial<NoteFormValues>) => {
    const next = { ...values, ...patch }
    setValues(next)
    queue.change(next)
    setStatus('unsaved')
  }

  useEffect(() => {
    if (!queue.dirty) return
    const timer = setTimeout(() => {
      void queue.save().then(() => {
        if (!queue.dirty) setStatus('saved')
      })
    }, AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [values, queue])

  const modal = useModal(() => void queue.save().then(onClose))

  return (
    <dialog ref={modal.ref} className="editor" onKeyDown={modal.onKeyDown} aria-label={note ? 'Edit note' : 'New note'}>
      <input className="note-title" value={values.title} onChange={(e) => edit({ title: e.target.value })} placeholder="Title" aria-label="Title" autoFocus />
      <textarea value={values.body} onChange={(e) => edit({ body: e.target.value })} placeholder="Write anything" aria-label="Note text" rows={12} />
      <div className="field-row">
        <label>
          Tags
          <input value={values.tags} onChange={(e) => edit({ tags: e.target.value })} placeholder="os lecture" />
        </label>
        <label className="inline">
          <input type="checkbox" checked={values.pinned} onChange={(e) => edit({ pinned: e.target.checked })} />
          Pinned
        </label>
      </div>
      <div className="editor-actions">
        <span className="hint" aria-live="polite">
          {status === 'saved' ? (queue.saved ? 'Saved' : '') : 'Saving…'}
        </span>
        <span className="spacer" />
        <button type="button" className="primary" onClick={modal.close}>
          Done
        </button>
      </div>
    </dialog>
  )
}
