import { describe, expect, it } from 'vitest'
import { canRedo, canUndo, createHistory, edit, redo, undo, type History } from '../src'

type Draft = { title: string; body: string }
const draft = (title: string, body = ''): Draft => ({ title, body })
const at = (h: History<Draft>) => h.present.title

describe('note history', () => {
  it('starts with nothing to undo', () => {
    const h = createHistory(draft(''), 0)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
  })

  it('groups a burst of typing into one step', () => {
    let h = createHistory(draft(''), 0)
    h = edit(h, draft('H'), 100)
    h = edit(h, draft('He'), 200)
    h = edit(h, draft('Hel'), 300)
    expect(h.past).toHaveLength(1)
    expect(at(undo(h))).toBe('')
  })

  it('starts a new step after a pause', () => {
    let h = createHistory(draft(''), 0)
    h = edit(h, draft('first'), 100)
    h = edit(h, draft('first second'), 5_000)
    expect(at(undo(h))).toBe('first')
    expect(at(undo(undo(h)))).toBe('')
  })

  it('redoes what was undone, and typing clears the redo stack', () => {
    let h = createHistory(draft(''), 0)
    h = edit(h, draft('one'), 100)
    h = edit(h, draft('two'), 5_000)
    const back = undo(h)
    expect(canRedo(back)).toBe(true)
    expect(at(redo(back))).toBe('two')

    const diverged = edit(back, draft('other'), 10_000)
    expect(canRedo(diverged)).toBe(false)
  })

  it('does not spend a step on an identical value', () => {
    let h = createHistory(draft('same'), 0)
    h = edit(h, draft('same'), 5_000)
    expect(h.past).toHaveLength(0)
    expect(canUndo(h)).toBe(false)
  })

  it('tracks the title and the body together', () => {
    let h = createHistory(draft('', ''), 0)
    h = edit(h, draft('Lecture', ''), 100)
    h = edit(h, draft('Lecture', 'Deadlocks'), 5_000)
    expect(undo(h).present).toEqual({ title: 'Lecture', body: '' })
  })

  it('undoing immediately after typing does not merge into the next burst', () => {
    let h = createHistory(draft(''), 0)
    h = edit(h, draft('a'), 100)
    h = edit(h, draft('ab'), 5_000)
    const back = undo(h, 5_100)
    const next = edit(back, draft('az'), 5_150)
    expect(at(undo(next))).toBe('a')
  })

  it('forgets the oldest steps past the limit', () => {
    let limited = createHistory(draft('0'), 0)
    for (let i = 1; i <= 10; i++) limited = edit(limited, draft(String(i)), i * 5_000, { limit: 3 })
    expect(limited.past).toHaveLength(3)
    expect(limited.past.map((d) => d.title)).toEqual(['7', '8', '9'])
  })
})
