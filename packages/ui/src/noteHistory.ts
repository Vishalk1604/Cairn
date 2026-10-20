/**
 * Undo and redo for the note editor.
 *
 * Typing is grouped into bursts so one undo takes back a phrase rather than a
 * single keystroke, the way a text editor behaves. A burst ends when the user
 * pauses, so the caller passes the current time with every edit rather than
 * keeping timers of its own.
 */
export interface History<T> {
  readonly past: readonly T[]
  readonly present: T
  readonly future: readonly T[]
  /** When the present value was last changed, used to group a burst of typing. */
  readonly editedAt: number
}

export interface HistoryOptions {
  /** A pause longer than this starts a new undo step. */
  burstMs?: number
  /** How many steps to keep. */
  limit?: number
}

const BURST_MS = 600
const LIMIT = 200

export function createHistory<T>(present: T, now = 0): History<T> {
  return { past: [], present, future: [], editedAt: now }
}

/** Records a change. Identical values are ignored so a no-op cannot cost an undo step. */
export function edit<T>(history: History<T>, present: T, now: number, options: HistoryOptions = {}): History<T> {
  if (Object.is(present, history.present) || shallowEqual(present, history.present)) return history
  const { burstMs = BURST_MS, limit = LIMIT } = options
  const continuing = now - history.editedAt < burstMs && history.past.length > 0
  // Within a burst the present is overwritten; a new burst keeps what was there.
  const past = continuing ? history.past : [...history.past, history.present].slice(-limit)
  return { past, present, future: [], editedAt: now }
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0
}

export function undo<T>(history: History<T>, now = history.editedAt): History<T> {
  if (!canUndo(history)) return history
  const past = history.past.slice(0, -1)
  const present = history.past[history.past.length - 1]!
  // Stepping back ends the burst, so the next keystroke starts a fresh step.
  return { past, present, future: [history.present, ...history.future], editedAt: now - BURST_MS }
}

export function redo<T>(history: History<T>, now = history.editedAt): History<T> {
  if (!canRedo(history)) return history
  const [present, ...future] = history.future
  return { past: [...history.past, history.present], present: present!, future, editedAt: now - BURST_MS }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
  )
}
