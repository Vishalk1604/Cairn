import { describe, expect, it } from 'vitest'
import { HOUR, parseCapture } from '../src'
import { at, NOW, show } from './helpers'

const parse = (text: string, options?: Parameters<typeof parseCapture>[2]) => parseCapture(text, NOW, options)

/** [input, title, due (local), allDay] with NOW = Monday 14 Sep 2026 10:00. */
const dated: [string, string, number, boolean][] = [
  ['submit DBMS assignment friday 6pm', 'submit DBMS assignment', at(2026, 9, 18, 18), false],
  ['submit DBMS assignment by friday 6pm', 'submit DBMS assignment', at(2026, 9, 18, 18), false],
  ['DBMS assignment due friday', 'DBMS assignment', at(2026, 9, 18, 9), true],
  ['call mom at 5', 'call mom', at(2026, 9, 14, 17), false],
  ['call mom at 9', 'call mom', at(2026, 9, 15, 9), false],
  ['call mom 6pm', 'call mom', at(2026, 9, 14, 18), false],
  ['meet at 2 on wed', 'meet', at(2026, 9, 16, 14), false],
  ['quiz on tuesday', 'quiz', at(2026, 9, 15, 9), true],
  ['lab report sat', 'lab report', at(2026, 9, 19, 9), true],
  ['SAT prep tomorrow', 'SAT prep', at(2026, 9, 15, 9), true],
  ['project demo sept 20 at 3pm', 'project demo', at(2026, 9, 20, 15), false],
  ['meeting in march', 'meeting', at(2027, 3, 1, 9), true],
  ['log in tomorrow', 'log in', at(2026, 9, 15, 9), true],
  ['pay rent on the 1st', 'pay rent', at(2026, 10, 1, 9), true],
  ['renew library card on the 31st', 'renew library card', at(2026, 10, 31, 9), true],
  ['pay fees the 14th', 'pay fees', at(2026, 9, 14, 9), true],
  ['remind me to call mom tomorrow at 7pm', 'call mom', at(2026, 9, 15, 19), false],
  ['dinner with Priya tonight', 'dinner with Priya', at(2026, 9, 14, 22), false],
  ['next friday: hand in lab', 'hand in lab', at(2026, 9, 25, 9), true],
  ['C# homework tomorrow', 'C# homework', at(2026, 9, 15, 9), true],
]

describe('parseCapture: dates', () => {
  it.each(dated)('%s', (input, title, due, allDay) => {
    const result = parse(input)
    expect(result.kind).toBe('reminder')
    expect(result.title).toBe(title)
    expect(show(result.dueAt)).toBe(show(due))
    expect(result.allDay).toBe(allDay)
    expect(result.rrule).toBeUndefined()
  })

  it('handles relative times', () => {
    const result = parse('check the oven in 2 hours')
    expect(result.title).toBe('check the oven')
    expect(result.dueAt).toBe(NOW + 2 * HOUR)
    expect(result.allDay).toBe(false)
  })

  it('uses the configured time for date-only reminders', () => {
    expect(show(parse('quiz on tuesday', { defaultHour: 8, defaultMinute: 30 }).dueAt)).toBe(show(at(2026, 9, 15, 8, 30)))
  })

  it('keeps the whole input as the title when it is only a date', () => {
    expect(parse('tomorrow at 6')).toMatchObject({ title: 'tomorrow at 6', dueAt: at(2026, 9, 15, 18) })
  })
})

describe('parseCapture: notes', () => {
  it.each(['buy milk', 'finish 3 problems', 'read chapter 5 of Sun Tzu', 'may i borrow the notes'])('%s', (input) => {
    const result = parse(input)
    expect(result).toMatchObject({ kind: 'note', title: input, allDay: false })
    expect(result.dueAt).toBeUndefined()
  })

  it('never interprets quoted text', () => {
    const result = parse('watch "Friday Night Lights" tomorrow')
    expect(result.title).toBe('watch Friday Night Lights')
    expect(show(result.dueAt)).toBe(show(at(2026, 9, 15, 9)))
  })
})

describe('parseCapture: recurrence', () => {
  it.each([
    ['water plants every day', 'water plants', 'FREQ=DAILY', at(2026, 9, 14, 9), true],
    ['review notes every other week', 'review notes', 'FREQ=WEEKLY;INTERVAL=2', at(2026, 9, 14, 9), true],
    ['gym every monday and wednesday 7am', 'gym', 'FREQ=WEEKLY;BYDAY=MO,WE', at(2026, 9, 16, 7), false],
    ['standup every weekday at 9:30', 'standup', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', at(2026, 9, 15, 9, 30), false],
    ['call grandma sundays', 'call grandma', 'FREQ=WEEKLY;BYDAY=SU', at(2026, 9, 20, 9), true],
    ['pay rent every month on the 1st', 'pay rent', 'FREQ=MONTHLY', at(2026, 10, 1, 9), true],
    ['backup laptop weekly on thursday 3pm', 'backup laptop', 'FREQ=WEEKLY', at(2026, 9, 17, 15), false],
    ['take meds daily at 8pm', 'take meds', 'FREQ=DAILY', at(2026, 9, 14, 20), false],
  ] as const)('%s', (input, title, rule, due, allDay) => {
    const result = parse(input)
    expect(result.kind).toBe('reminder')
    expect(result.title).toBe(title)
    expect(result.rrule).toContain(`RRULE:${rule}`)
    expect(show(result.dueAt)).toBe(show(due))
    expect(result.allDay).toBe(allDay)
  })

  it('anchors the rule at the first occurrence', () => {
    const result = parse('gym every monday and wednesday 7am')
    expect(result.rrule).toBe('DTSTART:20260916T070000\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE')
  })
})

describe('parseCapture: tags, priority and tokens', () => {
  it('pulls out tags and priority', () => {
    const result = parse('submit report friday 6pm #dbms #Uni !high')
    expect(result).toMatchObject({ title: 'submit report', tags: ['dbms', 'uni'], priority: 'high' })
  })

  it.each([
    ['!low clean desk', 'low'],
    ['clean desk !!', 'high'],
    ['clean desk !normal', 'normal'],
    ['clean desk', 'normal'],
  ] as const)('%s → %s priority', (input, priority) => {
    expect(parse(input)).toMatchObject({ title: 'clean desk', priority })
  })

  it('reports what it understood, in order', () => {
    const tokens = parse('submit report by friday 6pm #dbms').tokens
    expect(tokens.map(({ kind, text }) => [kind, text])).toEqual([
      ['date', 'by friday 6pm'],
      ['tag', '#dbms'],
    ])
  })
})
