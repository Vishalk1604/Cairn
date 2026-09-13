import type { Note } from '@cairn/core'
import type { NoteQuery } from '@cairn/sync'
import { useMemo, useState } from 'react'
import { useActions } from '../app/actions'
import { useCairn } from '../app/context'
import { useObserved } from '../app/hooks'

const ALL: NoteQuery = {}

export function noteHeading(n: Pick<Note, 'title' | 'body'>): string {
  return n.title || n.body?.trim().split('\n')[0] || 'Untitled'
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
        <p className="empty">{all.length === 0 ? 'No notes yet. Anything you type above without a date becomes a note.' : 'No notes match.'}</p>
      ) : (
        <ul className="rows">
          {shown.map((n) => (
            <li key={n.id} className="row note-row">
              <div className="row-main">
                <button type="button" className="row-title" onClick={() => onOpen(n)}>
                  {n.pinned && <span aria-label="Pinned">📌 </span>}
                  {noteHeading(n)}
                </button>
                <div className="row-meta">
                  {n.title && n.body && <span className="snippet">{n.body.trim().split('\n')[0]}</span>}
                  {n.tags.map((tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
              <div className="row-actions">
                <button type="button" aria-pressed={n.pinned} onClick={() => void actions.togglePin(n)}>
                  {n.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button type="button" aria-label={`Delete ${noteHeading(n)}`} onClick={() => void actions.removeNote(n)}>
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
