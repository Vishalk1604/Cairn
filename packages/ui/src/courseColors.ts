import type { InboxRecord } from '@cairn/core'
import { COURSE_COLOR_KEYS, COURSE_COLORS, type CourseColorKey } from './tokens'

/**
 * settings/courses: the colours a person picked for their Classroom courses,
 * by course id. A course not listed, or set to 'auto', keeps the colour its
 * id gives it, so every device shows the same one without anything stored.
 */
export interface CourseSettings {
  colors?: Record<string, CourseColorKey | 'auto'>
  updatedAt?: number
}

export type CourseColorOverrides = Readonly<Record<string, CourseColorKey | 'auto'>>

export type Scheme = 'dark' | 'light'

/** FNV-1a: small, fast and the same in Hermes, WebView2 and Node. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** The colour a course has until someone picks another. */
export function defaultCourseColor(courseId: string): CourseColorKey {
  return COURSE_COLOR_KEYS[hash(courseId) % COURSE_COLOR_KEYS.length]!
}

export function courseColorKey(courseId: string, overrides: CourseColorOverrides = {}): CourseColorKey {
  const picked = overrides[courseId]
  return picked && picked !== 'auto' && picked in COURSE_COLORS ? picked : defaultCourseColor(courseId)
}

/** The course's colour as a hex value for this theme; undefined for anything not from a course. */
export function courseColor(courseId: string | undefined, overrides: CourseColorOverrides = {}, scheme: Scheme = 'dark'): string | undefined {
  if (!courseId) return undefined
  return COURSE_COLORS[courseColorKey(courseId, overrides)][scheme]
}

export interface CourseEntry {
  courseId: string
  /** The name Classroom gives it, as last seen. */
  course: string
}

/** Every course the inbox has heard of, newest post first, once each. */
export function coursesIn(records: readonly Pick<InboxRecord, 'classroom' | 'receivedAt'>[]): CourseEntry[] {
  const seen = new Map<string, CourseEntry>()
  for (const r of [...records].sort((a, b) => b.receivedAt - a.receivedAt)) {
    const post = r.classroom
    if (post && !seen.has(post.courseId)) seen.set(post.courseId, { courseId: post.courseId, course: post.course })
  }
  return [...seen.values()]
}
