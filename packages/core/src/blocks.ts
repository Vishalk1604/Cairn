import type { Attachment } from './model'

/**
 * U+FFFC OBJECT REPLACEMENT CHARACTER — Unicode's own "something that is not
 * text belongs here". A note's body stays a plain string; an image or
 * recording is a line holding this marker and the attachment's id.
 *
 * Keeping the body a string is what lets undo/redo, the save queue, search and
 * the desktop renderer go on treating a note as text. Only the editor needs to
 * know these lines mean anything.
 */
export const ATTACHMENT_MARKER = '￼'

/** A marker owns its whole line, so nothing here can be confused with writing. */
const MARKER_LINE = /^￼([A-Za-z0-9-]+)$/

export type NoteBlock =
  | { kind: 'text'; text: string }
  /** `attachment` is absent when this device has the note but not yet its files. */
  | { kind: 'media'; id: string; attachment?: Attachment }

export function markerLine(attachmentId: string): string {
  return ATTACHMENT_MARKER + attachmentId
}

export function attachmentIdIn(line: string): string | null {
  return MARKER_LINE.exec(line)?.[1] ?? null
}

/**
 * The body as the editor shows it: text runs and media, always beginning and
 * ending with a text run and never two media in a row without one between.
 * That invariant is the point — it guarantees somewhere to put the caret above,
 * below and between every image, so no note can be written into a corner.
 */
export function splitBody(body: string, attachments: readonly Attachment[] = []): NoteBlock[] {
  const byId = new Map(attachments.map((a) => [a.id, a]))
  const placed = new Set<string>()
  const blocks: NoteBlock[] = []
  let run: string[] = []
  let previous: Attachment | undefined

  const flush = () => {
    blocks.push({ kind: 'text', text: run.join('\n') })
    run = []
  }

  for (const line of body.split('\n')) {
    const id = attachmentIdIn(line)
    if (id === null) {
      run.push(line)
      continue
    }
    // One file appears once. A second marker for it (a double tap, a merge)
    // is dropped here, and so disappears from the body at the next save.
    if (placed.has(id)) continue
    // The same photo twice in a row, with nothing written between, is a
    // double tap that picked it twice, not a choice. The copy goes too.
    const attachment = byId.get(id)
    if (run.every((line) => line.trim() === '') && isSamePhoto(previous, attachment)) {
      run = []
      continue
    }
    placed.add(id)
    flush()
    blocks.push({ kind: 'media', id, attachment })
    previous = attachment
  }
  flush()
  return blocks
}

/** Two copies of one picture: same type, same size to the byte, same shape. */
function isSamePhoto(a: Attachment | undefined, b: Attachment | undefined): boolean {
  return (
    a?.kind === 'image' &&
    b?.kind === 'image' &&
    a.bytes !== undefined &&
    a.bytes === b.bytes &&
    a.mime === b.mime &&
    a.width === b.width &&
    a.height === b.height
  )
}

/**
 * Blocks back to a body. Empty text runs vanish, so a note that is nothing but
 * a photo is exactly one marker rather than a marker padded with blank lines.
 * A deliberate gap between two images is therefore a line with a space in it.
 */
export function joinBlocks(blocks: readonly NoteBlock[]): string {
  return blocks
    .map((b) => (b.kind === 'text' ? b.text : markerLine(b.id)))
    .filter((piece) => piece !== '')
    .join('\n')
}

/**
 * Puts an attachment where the caret is: the run splits in two and the media
 * lands on its own line between the halves. Text either side of the caret is
 * kept, so inserting mid-sentence never eats what was typed.
 */
export function insertMedia(
  blocks: readonly NoteBlock[],
  runIndex: number,
  caret: number,
  attachment: Attachment,
): NoteBlock[] {
  const target = blocks[runIndex]
  if (target?.kind !== 'text') throw new Error('Media can only be inserted into a text run')
  const at = Math.max(0, Math.min(caret, target.text.length))
  const next = [...blocks]
  next.splice(
    runIndex,
    1,
    { kind: 'text', text: target.text.slice(0, at) },
    { kind: 'media', id: attachment.id, attachment },
    { kind: 'text', text: target.text.slice(at) },
  )
  return next
}

/** Drops a medium and closes the gap, so the text either side becomes one run again. */
export function removeMedia(blocks: readonly NoteBlock[], attachmentId: string): NoteBlock[] {
  const index = blocks.findIndex((b) => b.kind === 'media' && b.id === attachmentId)
  if (index < 0) return [...blocks]
  const before = blocks[index - 1]
  const after = blocks[index + 1]
  const next = [...blocks]
  if (before?.kind === 'text' && after?.kind === 'text') {
    const joined = [before.text, after.text].filter((t) => t !== '').join('\n')
    next.splice(index - 1, 3, { kind: 'text', text: joined })
  } else {
    next.splice(index, 1)
  }
  return next
}

export function referencedAttachmentIds(body: string): string[] {
  return body
    .split('\n')
    .map(attachmentIdIn)
    .filter((id): id is string => id !== null)
}

/**
 * The attachments a body still points at, in the order they appear. Anything
 * the writing no longer mentions is dropped, so deleting a photo from a note
 * stops Cairn syncing — and paying for — a file nobody can see.
 */
export function pruneAttachments(body: string, attachments: readonly Attachment[] | undefined): Attachment[] {
  if (!attachments?.length) return []
  const byId = new Map(attachments.map((a) => [a.id, a]))
  return referencedAttachmentIds(body)
    .map((id) => byId.get(id))
    .filter((a): a is Attachment => a !== undefined)
}
