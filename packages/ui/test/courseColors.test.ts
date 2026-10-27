import { describe, expect, it } from 'vitest'
import { COURSE_COLOR_KEYS, COURSE_COLORS, courseColor, courseColorKey, coursesIn, defaultCourseColor } from '../src'

describe('course colours', () => {
  it('gives a course the same colour every time, from its id alone', () => {
    expect(defaultCourseColor('NjQ3MDk0NjE1MDk1')).toBe(defaultCourseColor('NjQ3MDk0NjE1MDk1'))
    expect(COURSE_COLOR_KEYS).toContain(defaultCourseColor('anything'))
  })

  it('spreads courses across the palette', () => {
    const used = new Set(Array.from({ length: 60 }, (_, i) => defaultCourseColor(`course-${i * 7919}`)))
    expect(used.size).toBe(COURSE_COLOR_KEYS.length)
  })

  it('uses the colour a person picked, and goes back to its own on auto', () => {
    const id = 'c1'
    const other = COURSE_COLOR_KEYS.find((k) => k !== defaultCourseColor(id))!
    expect(courseColorKey(id, { c1: other })).toBe(other)
    expect(courseColorKey(id, { c1: 'auto' })).toBe(defaultCourseColor(id))
    // A colour from a newer version of Cairn this one does not know.
    expect(courseColorKey(id, { c1: 'teal' as never })).toBe(defaultCourseColor(id))
  })

  it('has a shade for each theme, and nothing for a task not from a course', () => {
    const key = defaultCourseColor('c2')
    expect(courseColor('c2', {}, 'dark')).toBe(COURSE_COLORS[key].dark)
    expect(courseColor('c2', {}, 'light')).toBe(COURSE_COLORS[key].light)
    expect(courseColor(undefined)).toBeUndefined()
  })

  it('keeps every shade readable against its own theme', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi! + 0.05) / (lo! + 0.05)
    }
    for (const token of Object.values(COURSE_COLORS)) {
      // Non-text graphics need 3:1 (WCAG 1.4.11) against the card behind them.
      expect(contrast(token.dark, '#1c1c1e')).toBeGreaterThanOrEqual(3)
      expect(contrast(token.light, '#ffffff')).toBeGreaterThanOrEqual(3)
    }
  })

  it('lists the courses the inbox knows, by their latest name', () => {
    const post = (courseId: string, course: string, receivedAt: number) => ({ receivedAt, classroom: { kind: 'work' as const, courseId, course } })
    expect(coursesIn([post('a', 'DBMS', 1), post('b', 'OS', 3), post('a', 'DBMS (CS301)', 2), { receivedAt: 4 }])).toEqual([
      { courseId: 'b', course: 'OS' },
      { courseId: 'a', course: 'DBMS (CS301)' },
    ])
  })
})
