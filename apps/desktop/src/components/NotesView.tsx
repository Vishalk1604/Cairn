import type { Note } from '@cairn/core'
import { ALL_FOLDER, noteHeading, noteLines, notesInFolder, noteTimestamp, type Folder } from '@cairn/ui'
import { memo, useMemo, useState, type ReactNode } from 'react'
import { useActions } from '../app/actions'
import { useMediaUrl } from '../app/media'
import { NotesIcon, PinIcon, PlusIcon, SearchIcon, TrashIcon } from './icons'

interface Props {
  notes: readonly Note[]
  folders: readonly Folder[]
  folder: string
  wide: boolean
  /** The capture box, shown under the heading. */
  capture: ReactNode
  onFolder: (folder: string) => void
  onOpen: (note: Note) => void
  onNew: () => void
}

/**
 * Notes as cards, the way the phone shows them: a grid across the full app,
 * a single column in the widget. Pinned notes first, then the newest.
 */
export function NotesView({ notes, folders, folder, wide, capture, onFolder, onOpen, onNew }: Props) {
  const [search, setSearch] = useState('')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notesInFolder(notes, folder)
      .filter((n) => !q || [n.title, n.body ?? '', ...n.tags].some((field) => field.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  }, [notes, folder, search])

  const title = folder === ALL_FOLDER ? 'Notes' : (folders.find((f) => f.id === folder)?.name ?? 'Notes')

  return (
    <section className="view" aria-label={title}>
      <header className="view-head">
        <h1 className="view-title">{title}</h1>
        <span className="view-sub">{shown.length === 1 ? '1 note' : `${shown.length} notes`}</span>
        <span className="spacer" />
        <label className="search-box">
          <SearchIcon size={16} />
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes" aria-label="Search notes" />
        </label>
        <button type="button" className="accent-button" onClick={onNew}>
          <PlusIcon size={16} />
          <span>New note</span>
        </button>
      </header>

      {capture}

      {!wide && folders.length > 1 && (
        <div className="chips" role="tablist" aria-label="Folders">
          {folders.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={folder === f.id} className="chip" onClick={() => onFolder(f.id)}>
              {f.name}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <NotesIcon size={30} />
          </span>
          <p>{notes.length === 0 ? 'No notes yet. Anything you capture without a date becomes a note.' : search ? 'No notes match.' : 'Nothing in this folder yet.'}</p>
        </div>
      ) : (
        <div className="note-grid">
          {shown.map((n) => (
            <NoteCard key={n.id} note={n} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  )
}

const NoteCard = memo(function NoteCard({ note, onOpen }: { note: Note; onOpen: (note: Note) => void }) {
  const actions = useActions()
  const cover = useMediaUrl(note.attachments?.find((a) => a.kind === 'image'))
  const heading = noteHeading(note)
  const preview = useMemo(() => {
    const lines = noteLines(note)
    // Without a title the heading is the first line, so it is not said twice.
    const at = note.title ? -1 : lines.indexOf(heading)
    if (at >= 0) lines.splice(at, 1)
    return lines.join('\n')
  }, [note, heading])

  return (
    <article className="note-card">
      <button type="button" className="note-card-open" onClick={() => onOpen(note)}>
        {cover && <img className="note-cover" src={cover} alt="" />}
        <h3 className="note-card-title">{heading}</h3>
        {preview && <p className="note-card-preview">{preview}</p>}
        <span className="note-card-meta">
          {noteTimestamp(note.updatedAt)}
          {note.pinned && (
            <span className="note-card-pin" aria-label="Pinned">
              <PinIcon size={13} filled />
            </span>
          )}
        </span>
      </button>
      <div className="card-tools">
        <button type="button" className="tool" aria-label={note.pinned ? `Unpin ${heading}` : `Pin ${heading}`} title={note.pinned ? 'Unpin' : 'Pin'} onClick={() => void actions.togglePin(note)}>
          <PinIcon size={15} filled={note.pinned} />
        </button>
        <button type="button" className="tool" aria-label={`Delete ${heading}`} title="Delete" onClick={() => void actions.removeNote(note)}>
          <TrashIcon size={15} />
        </button>
      </div>
    </article>
  )
})
