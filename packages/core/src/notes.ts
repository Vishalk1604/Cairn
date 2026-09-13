import { clean, nextStamp, tombstone } from './entity'
import { uuidv7 } from './ids'
import type { CreateContext, Note, Source } from './model'
import { normalizeTags } from './reminders'

export interface NoteInput {
  title?: string
  body?: string
  tags?: string[]
  courseId?: string
  pinned?: boolean
  source?: Source
  sourceRef?: string
}

export interface NoteChanges {
  title?: string
  body?: string
  tags?: string[]
  courseId?: string | null
  pinned?: boolean
}

export function createNote(input: NoteInput, ctx: CreateContext): Note {
  const title = (input.title ?? '').replace(/\s+/g, ' ').trim()
  const body = input.body?.trim() ? input.body : undefined
  if (!title && !body) throw new Error('A note needs a title or some text')
  return clean<Note>({
    id: ctx.id ?? uuidv7(ctx.now),
    userId: ctx.userId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    title,
    body,
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
  if (!next.title && !next.body) throw new Error('A note needs a title or some text')
  return clean(next)
}

export function deleteNote(note: Note, now: number): Note {
  return tombstone(note, now)
}
