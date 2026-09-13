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
