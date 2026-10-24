import { normalizeTags, type Note } from '@cairn/core'
import type { KeyValueStore, NoteRepository } from '@cairn/sync'
import type { Actions } from './actions'
import { createNoteSaveQueue, type NoteFormValues } from './noteSaveQueue'

/**
 * Writing that has not been saved yet, kept on the device only.
 *
 * Editors save a note once, on the way out, so typing costs the cloud one
 * write instead of one every pause. Until then the words live here, so an app
 * that is killed or crashes mid-note loses nothing.
 */
export interface NoteDraft {
  /** The note being edited; absent for one never saved. */
  noteId?: string
  values: NoteFormValues
  /** When it was written down. */
  at: number
}

export const NOTE_DRAFT_KEY = 'cairn.editor.draft'

export function readNoteDraft(raw: string | null): NoteDraft | null {
  if (!raw) return null
  try {
    const draft = JSON.parse(raw) as NoteDraft
    return draft && typeof draft.values?.title === 'string' && typeof draft.values.body === 'string' ? draft : null
  } catch {
    return null
  }
}

/** Whether saving these values would change nothing, so the write can be skipped. */
function sameAsNote(note: Note, values: NoteFormValues): boolean {
  const tags = normalizeTags(values.tags.split(/[\s,]+/).filter(Boolean))
  return (
    note.title === values.title.replace(/\s+/g, ' ').trim() &&
    (note.body ?? '') === (values.body.trim() ? values.body : '') &&
    note.pinned === values.pinned &&
    note.tags.length === tags.length &&
    note.tags.every((t, i) => t === tags[i]) &&
    (!values.attachments || JSON.stringify(values.attachments) === JSON.stringify(note.attachments ?? []))
  )
}

export function keepNoteDraft(store: KeyValueStore, draft: NoteDraft | null): Promise<void> {
  // The store has no delete; an empty value reads as no draft.
  return store.set(NOTE_DRAFT_KEY, draft ? JSON.stringify(draft) : '').catch(() => {})
}

/**
 * Saves what an editor left behind when it never reached its way out. A draft
 * older than the note as it now stands lost to a later edit, and one for a
 * deleted note stays deleted.
 */
export async function recoverNoteDraft(
  store: KeyValueStore,
  notes: Pick<NoteRepository, 'get'>,
  actions: Pick<Actions, 'addNote' | 'saveNote'>,
): Promise<Note | undefined> {
  const draft = readNoteDraft(await store.get(NOTE_DRAFT_KEY).catch(() => null))
  if (!draft) return undefined
  const note = draft.noteId ? await notes.get(draft.noteId) : undefined
  const stale =
    draft.noteId !== undefined && (!note || note.deletedAt !== undefined || note.updatedAt > draft.at || sameAsNote(note, draft.values))
  let saved: Note | undefined
  if (!stale) {
    const queue = createNoteSaveQueue(actions, note)
    queue.change(draft.values)
    await queue.save()
    saved = queue.saved
  }
  await keepNoteDraft(store, null)
  return saved
}
