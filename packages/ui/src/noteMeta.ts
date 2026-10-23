import { attachmentIdIn, splitBody, type Note } from '@cairn/core'
import type { FormatOptions } from './format'

/** "20 October 10:22 pm" — the date line under a note's title. */
export function noteTimestamp(t: number, options: FormatOptions = {}): string {
  const date = new Date(t)
  const day = date.toLocaleDateString(options.locale, { day: 'numeric', month: 'long' })
  const time = date.toLocaleTimeString(options.locale, { hour: 'numeric', minute: '2-digit' })
  return `${day} ${time}`
}

/**
 * "0 characters" / "1 character". Counts the note itself, title included. A
 * photo or recording is not writing, so its line in the body is not counted.
 */
export function noteCharacterCount(title: string, body: string): string {
  const writing = body
    .split('\n')
    .filter((line) => attachmentIdIn(line) === null)
    .join('\n')
  const count = [...`${title}${writing}`].length
  return `${count} ${count === 1 ? 'character' : 'characters'}`
}

/** What a list says for media, since the marker in the body means nothing to read. */
const MEDIA_LABEL = { image: '[Photo]', audio: '[Recording]' } as const

/**
 * A note's writing as non-empty lines, each photo or recording standing in its
 * place as a short label. For lists and cards, never for editing.
 */
export function noteLines(note: Pick<Note, 'body' | 'attachments'>): string[] {
  return splitBody(note.body ?? '', note.attachments)
    .flatMap((b) => (b.kind === 'text' ? b.text.split('\n') : [MEDIA_LABEL[b.attachment?.kind ?? 'image']]))
    .map((line) => line.trim())
    .filter(Boolean)
}

/** The title, or else the first written line. A photo is not a heading. */
export function noteHeading(note: Pick<Note, 'title' | 'body'>): string {
  if (note.title) return note.title
  const first = (note.body ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && attachmentIdIn(line) === null)
  return first ?? 'Untitled'
}
