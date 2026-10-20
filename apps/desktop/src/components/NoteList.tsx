import type { Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { noteTimestamp } from '@cairn/ui'
import { useMemo, useState } from 'react'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'

const ALL: NoteQuery = {}

export function noteHeading(n: Pick<Note, 'title' | 'body'>): string {
  return n.title || firstLines(n.body)[0] || 'Untitled'
}

/** The line shown under the heading, skipping whatever the heading already used. */
function notePreview(n: Pick<Note, 'title' | 'body'>): string {
  const lines = firstLines(n.body)
  return (n.title ? lines[0] : lines[1]) ?? ''
}

function firstLines(body: string | undefined): string[] {
  return (body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function NoteList({ onOpen }: { onOpen: (note: Note) => void }) {
  const { notes } = useCairn()
  const actions = useActions()
  const all = useObserved(notes, ALL)
  const [search, setSearch] = useState('')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((n) => !q || [n.title, n.body ?? '', ...n.tags].some((field) => field.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [all, search])

  return (
    <>
      <input
        type="search"
        className="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search notes"
        aria-label="Search notes"
      />
      {shown.length === 0 ? (
        <p className="empty">
          {all.length === 0 ? 'No notes yet. Anything you type above without a date becomes a note.' : 'No notes match.'}
        </p>
      ) : (
        <ul className="rows">
          {shown.map((n) => (
            <li key={n.id} className="note-card">
              <button type="button" className="note-open" onClick={() => onOpen(n)}>
                <span className="note-card-title">
                  {n.pinned && <span aria-label="Pinned">★ </span>}
                  {noteHeading(n)}
                </span>
                {notePreview(n) && <span className="note-card-preview">{notePreview(n)}</span>}
                <span className="note-card-meta">
                  {noteTimestamp(n.updatedAt)}
                  {n.tags.map((tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ))}
                </span>
              </button>
              <div className="note-card-actions">
                <button type="button" className="quiet" aria-pressed={n.pinned} onClick={() => void actions.togglePin(n)}>
                  {n.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Delete ${noteHeading(n)}`}
                  onClick={() => void actions.removeNote(n)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
