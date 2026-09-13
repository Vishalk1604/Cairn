import { describeRecurrence, parseCapture } from '@cairn/core'
import { formatDue } from '@cairn/ui'
import { useMemo, useState, type RefObject } from 'react'
import { useActions } from '../app/actions'

export function QuickCapture({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const [text, setText] = useState('')
  const actions = useActions()
  const preview = useMemo(() => (text.trim() ? parseCapture(text, Date.now()) : null), [text])

  const submit = async (literal: boolean) => {
    if (!text.trim()) return
    const result = await actions.capture(text, literal)
    if (result !== undefined) setText('')
  }

  return (
    <form
      className="capture"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(false)
      }}
    >
      <div className="capture-row">
        <input
          ref={inputRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              void submit(event.altKey)
            } else if (event.key === 'Escape') {
              setText('')
            }
          }}
          placeholder="Add a reminder or note, e.g. submit DBMS assignment friday 6pm #dbms"
          aria-label="Quick capture"
          aria-describedby="capture-preview"
          autoFocus
        />
        <button type="submit" disabled={!text.trim()}>
          Add
        </button>
      </div>
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
            <span className="hint"> Enter to add · Alt+Enter saves the text as-is</span>
          </>
        ) : (
          <span className="hint">Ctrl+Shift+Space jumps here from anywhere · #tag · !high · “quotes” are never read as dates</span>
        )}
      </p>
    </form>
  )
}
