import type { FormatOptions } from './format'

/** "20 October 10:22 pm" — the date line under a note's title. */
export function noteTimestamp(t: number, options: FormatOptions = {}): string {
  const date = new Date(t)
  const day = date.toLocaleDateString(options.locale, { day: 'numeric', month: 'long' })
  const time = date.toLocaleTimeString(options.locale, { hour: 'numeric', minute: '2-digit' })
  return `${day} ${time}`
}

/** "0 characters" / "1 character". Counts the note itself, title included. */
export function noteCharacterCount(title: string, body: string): string {
  const count = [...`${title}${body}`].length
  return `${count} ${count === 1 ? 'character' : 'characters'}`
}
