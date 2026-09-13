import { describe, expect, it } from 'vitest'
import { snoozeChoices } from '../src'

const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()

describe('snoozeChoices', () => {
  it('offers evening, tomorrow and next Monday on a weekday morning', () => {
    const choices = snoozeChoices(at(2026, 9, 14, 10))
    expect(choices.map((c) => c.label)).toEqual(['15 minutes', '1 hour', '3 hours', 'This evening', 'Tomorrow morning', 'Next week'])
    expect(choices.at(-2)!.until).toBe(at(2026, 9, 15, 9))
    expect(choices.at(-1)!.until).toBe(at(2026, 9, 21, 9))
  })

  it('offers this morning in the small hours and drops a passed evening', () => {
    expect(snoozeChoices(at(2026, 9, 14, 2)).map((c) => c.label)).toContain('This morning')
    expect(snoozeChoices(at(2026, 9, 14, 17, 30)).map((c) => c.label)).not.toContain('This evening')
  })

  it('goes to the following Monday when it is already Monday, and to tomorrow from Sunday', () => {
    expect(snoozeChoices(at(2026, 9, 14, 10)).at(-1)!.until).toBe(at(2026, 9, 21, 9))
    expect(snoozeChoices(at(2026, 9, 20, 10)).at(-1)!.until).toBe(at(2026, 9, 21, 9))
  })
})
