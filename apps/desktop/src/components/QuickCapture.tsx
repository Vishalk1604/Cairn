import { describeRecurrence, parseCapture } from '@cairn/core'
import { formatDue } from '@cairn/ui'
import { useMemo, useRef, useState, type RefObject } from 'react'
import { useActions } from '../app/actions'

/**
 * The way most things get into Cairn: a title line and a body under it.
 * The title is read for a date, a repeat, tags and priority, and Cairn
 * decides from that whether what you wrote is a reminder, a note, or both.
 */
export function QuickCapture({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const actions = useActions()

  const preview = useMemo(() => (title.trim() ? parseCapture(title, Date.now()) : null), [title])
  const empty = !title.trim() && !body.trim()

  const submit = async (literal = false) => {
    if (empty) return
    const result = await actions.capture({ title, body }, literal)
    if (result !== undefined) {
      setTitle('')
      setBody('')
      inputRef.current?.focus()
    }
  }

  return (
    <form
      className="capture"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <input
        ref={inputRef}
        className="capture-title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            // Alt keeps the text exactly as typed, dates and all.
            if (event.altKey) void submit(true)
            // A one-liner is the common case, so Enter files it straight away;
            // Shift+Enter is for when there is more to say.
            else if (event.shiftKey) bodyRef.current?.focus()
            else void submit()
          } else if (event.key === 'Escape') {
            setTitle('')
            setBody('')
          }
        }}
        placeholder="What do you need to remember?"
        aria-label="Title"
        aria-describedby="capture-preview"
        autoFocus
      />

      <textarea
        ref={bodyRef}
        className="capture-body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            void submit()
          } else if (event.key === 'Escape') {
            setTitle('')
            setBody('')
            inputRef.current?.focus()
          }
        }}
        placeholder="Notes (optional)"
        aria-label="Notes"
        rows={3}
      />

      <div className="capture-foot">
        <p id="capture-preview" className="capture-preview" aria-live="polite">
          {preview ? (
            <>
              {preview.kind === 'reminder' ? 'Reminder' : 'Note'}: <strong>{preview.title}</strong>
              {preview.dueAt !== undefined && <> · {formatDue(preview.dueAt, preview.allDay, Date.now())}</>}
              {preview.rrule && <> · {describeRecurrence(preview.rrule)}</>}
              {preview.priority !== 'normal' && <> · {preview.priority} priority</>}
              {preview.tags.map((tag) => (
                <span key={tag} className="tag">
                  #{tag}
                </span>
              ))}
              {preview.kind === 'reminder' && body.trim() && <> · with your note</>}
            </>
          ) : (
            <span className="hint">
              Add a date to make it a reminder · #tag · !high · “quotes” are never read as dates
            </span>
          )}
        </p>
        <button type="submit" disabled={empty}>
          Add
        </button>
      </div>
    </form>
  )
}
