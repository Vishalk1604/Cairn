import { addLocalDays, atLocalTime, HOUR, MINUTE } from '@cairn/core'

export interface SnoozeChoice {
  label: string
  until: number
}

export interface SnoozeOptions {
  morningHour?: number
  eveningHour?: number
}

/** Quick snooze targets. Time-of-day choices only appear when they're at least an hour away. */
export function snoozeChoices(now: number, options: SnoozeOptions = {}): SnoozeChoice[] {
  const morningHour = options.morningHour ?? 9
  const eveningHour = options.eveningHour ?? 18
  const choices: SnoozeChoice[] = [
    { label: '15 minutes', until: now + 15 * MINUTE },
    { label: '1 hour', until: now + HOUR },
    { label: '3 hours', until: now + 3 * HOUR },
  ]
  const thisMorning = atLocalTime(now, morningHour)
  if (thisMorning - now >= HOUR) choices.push({ label: 'This morning', until: thisMorning })
  const thisEvening = atLocalTime(now, eveningHour)
  if (thisEvening - now >= HOUR) choices.push({ label: 'This evening', until: thisEvening })
  choices.push({ label: 'Tomorrow morning', until: atLocalTime(addLocalDays(now, 1), morningHour) })
  const daysToMonday = (8 - new Date(now).getDay()) % 7 || 7
  choices.push({ label: 'Next week', until: atLocalTime(addLocalDays(now, daysToMonday), morningHour) })
  return choices
}
