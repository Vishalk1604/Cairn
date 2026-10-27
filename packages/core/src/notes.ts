import { pruneAttachments } from './blocks'
import { clean, nextStamp, purge, tombstone } from './entity'
import { uuidv7 } from './ids'
import type { Attachment, CreateContext, Note, Source } from './model'
import { normalizeTags } from './reminders'

export interface NoteInput {
  title?: string
  body?: string
  attachments?: Attachment[]
  tags?: string[]
  courseId?: string
  pinned?: boolean
  source?: Source
  sourceRef?: string
}

export interface NoteChanges {
  title?: string
  body?: string
  attachments?: Attachment[]
  tags?: string[]
  courseId?: string | null
  pinned?: boolean
}

export function createNote(input: NoteInput, ctx: CreateContext): Note {
  const title = (input.title ?? '').replace(/\s+/g, ' ').trim()
  const body = input.body?.trim() ? input.body : undefined
  const attachments = pruneAttachments(body ?? '', input.attachments)
  // A photo or a recording is a note in its own right, with nothing typed.
  if (!title && !body && !attachments.length) throw new Error('A note needs a title, some text or an attachment')
  return clean<Note>({
    id: ctx.id ?? uuidv7(ctx.now),
    userId: ctx.userId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    title,
    body,
    attachments: attachments.length ? attachments : undefined,
    tags: normalizeTags(input.tags),
    courseId: input.courseId,
    pinned: input.pinned ?? false,
    source: input.source ?? 'manual',
    sourceRef: input.sourceRef,
  })
}

/** Keeps the previous body in bodyPrev whenever the body changes. */
export function updateNote(note: Note, changes: NoteChanges, now: number): Note {
  const next: Note = { ...note, updatedAt: nextStamp(note.updatedAt, now) }
  if (changes.title !== undefined) next.title = changes.title.replace(/\s+/g, ' ').trim()
  if (changes.body !== undefined) {
    const body = changes.body.trim() ? changes.body : undefined
    if (body !== note.body) {
      next.body = body
      next.bodyPrev = note.body
    }
  }
  if (changes.tags !== undefined) next.tags = normalizeTags(changes.tags)
  if (changes.courseId !== undefined) next.courseId = changes.courseId ?? undefined
  if (changes.pinned !== undefined) next.pinned = changes.pinned
  // Always against the body as it now stands: deleting a photo from the
  // writing is what drops the file, whether or not the caller said so.
  const attachments = pruneAttachments(next.body ?? '', changes.attachments ?? next.attachments)
  next.attachments = attachments.length ? attachments : undefined
  if (!next.title && !next.body && !attachments.length) {
    throw new Error('A note needs a title, some text or an attachment')
  }
  return clean(next)
}

export function deleteNote(note: Note, now: number): Note {
  return tombstone(note, now)
}

/**
 * Delete forever: the note's purge marker, with no title, writing,
 * attachments or tags left in it. Its photos and recordings stay in Drive's
 * trash, where the recycle bin already put them, for Drive to empty.
 */
export function purgeNote(note: Note, now: number): Note {
  return purge<Note>(note, now, { title: '', tags: [], pinned: false, source: note.source })
}
