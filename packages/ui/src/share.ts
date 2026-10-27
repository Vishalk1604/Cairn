import { markerLine, type Attachment, type NoteInput } from '@cairn/core'

/** What another app handed Cairn through Android's share sheet. */
export interface Shared {
  text?: string | null
  /** The first web address in the text, if any. */
  webUrl?: string | null
  /** The page's title, when the sharing app sent one (Chrome and most browsers do). */
  title?: string | null
}

const URL_ONLY = /^\s*(https?:\/\/\S+)\s*$/i

/**
 * The note a share becomes. A link keeps its title as the note's, when the
 * sharing app said what it was; otherwise it is named by the text it came
 * with, and the link goes underneath. Plain text is the note's writing, as
 * it would be typed. Shared photos are attachments, each on a line of its
 * own after anything written, the way the editor places them.
 */
export function noteFromShare(shared: Shared, images: readonly Attachment[] = []): NoteInput | null {
  const text = shared.text?.trim() ?? ''
  const url = shared.webUrl?.trim() || URL_ONLY.exec(text)?.[1] || ''
  const title = shared.title?.replace(/\s+/g, ' ').trim() ?? ''
  const media = images.map((a) => markerLine(a.id))
  let note: { title: string; lines: string[] }
  if (url) {
    // Whatever came with the link besides the link itself: "Read this https://…" or "Page title\nhttps://…".
    const said = text.replace(url, '').replace(/\s+/g, ' ').trim().replace(/[:\-–—]$/, '').trim()
    note = { title: title && title !== url ? title : said || url, lines: [url] }
    if (said && said !== note.title) note.lines.unshift(said)
  } else {
    note = { title: title && !text.startsWith(title) ? title : '', lines: text ? [text] : [] }
  }
  const body = [...note.lines, ...media].join('\n')
  if (!note.title && !body) return null
  return { title: note.title.slice(0, 200), ...(body ? { body } : {}), ...(images.length ? { attachments: [...images] } : {}) }
}
