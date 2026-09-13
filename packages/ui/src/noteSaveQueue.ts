import type { Note } from '@cairn/core'
import type { Actions } from './actions'

/** A note editor's form values. Tags are the raw text of the tags field. */
export interface NoteFormValues {
  title: string
  body: string
  tags: string
  pinned: boolean
}

/**
 * Saves a note while it's being edited. Editors record every change and call
 * save() on a debounce and once more on close. Saves run one at a time, so a
 * new note is created exactly once, the latest values always win, and a
 * failed save stays pending for the next attempt.
 */
export function createNoteSaveQueue(actions: Pick<Actions, 'addNote' | 'saveNote'>, initial?: Note) {
  let saved = initial
  let pending: NoteFormValues | null = null
  let queue: Promise<void> = Promise.resolve()

  const save = (): Promise<void> => {
    queue = queue.then(async () => {
      const values = pending
      if (!values || (!values.title.trim() && !values.body.trim())) return
      pending = null
      const input = { title: values.title, body: values.body, tags: values.tags.split(/[\s,]+/).filter(Boolean), pinned: values.pinned }
      const result = saved ? await actions.saveNote(saved, input) : await actions.addNote(input)
      if (result) saved = result
      else pending ??= values
    })
    return queue
  }

  return {
    change(values: NoteFormValues) {
      pending = values
    },
    save,
    /** True while there are changes that haven't been written. */
    get dirty() {
      return pending !== null
    },
    get saved() {
      return saved
    },
  }
}
