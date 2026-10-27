import type { UrgencyLevel } from '@cairn/core'

export interface UrgencyToken {
  label: string
  /** Shape cue so urgency never depends on color alone. */
  symbol: string
  /** Placeholder palette until the visual design pass. */
  color: string
  /** Overdue items pulse on the desktop widget. */
  pulse: boolean
}

/**
 * The single source for urgency styling. The Kotlin widget and the Rust tray
 * will get generated copies of these values so every surface matches.
 */
export const URGENCY: Record<UrgencyLevel, UrgencyToken> = {
  overdue: { label: 'Overdue', symbol: '!', color: '#d93025', pulse: true },
  soon: { label: 'Due soon', symbol: '▲', color: '#f29900', pulse: false },
  today: { label: 'Today', symbol: '●', color: '#e3b505', pulse: false },
  week: { label: 'This week', symbol: '◆', color: '#1a73e8', pulse: false },
  later: { label: 'Later', symbol: '○', color: '#80868b', pulse: false },
  done: { label: 'Done', symbol: '✓', color: '#188038', pulse: false },
}

export type CourseColorKey = 'orange' | 'sky' | 'green' | 'yellow' | 'blue' | 'vermillion' | 'pink'

export interface CourseColorToken {
  name: string
  /** On the dark theme's surfaces. */
  dark: string
  /** On the light theme's, darker so a strip or chip still stands off white. */
  light: string
}

/**
 * A colour per Classroom course, from Okabe and Ito's palette, which stays
 * distinguishable with every common colour-vision deficiency. A course's
 * colour sits beside an urgency colour, never in place of it, so it may
 * share a hue with one: urgency always has its symbol as well.
 */
export const COURSE_COLORS: Record<CourseColorKey, CourseColorToken> = {
  orange: { name: 'Orange', dark: '#e69f00', light: '#b87500' },
  sky: { name: 'Sky', dark: '#56b4e9', light: '#2b88c2' },
  green: { name: 'Green', dark: '#1fb386', light: '#00866a' },
  yellow: { name: 'Yellow', dark: '#f0e442', light: '#8f8200' },
  blue: { name: 'Blue', dark: '#3d8fd6', light: '#0072b2' },
  vermillion: { name: 'Vermillion', dark: '#e8743b', light: '#c2530a' },
  pink: { name: 'Pink', dark: '#d68bb8', light: '#b4558e' },
}

export const COURSE_COLOR_KEYS = Object.keys(COURSE_COLORS) as CourseColorKey[]
