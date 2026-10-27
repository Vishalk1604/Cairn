/**
 * The person's own clock, for a server that has none.
 *
 * Cairn's date logic (@cairn/core) reads the local clock: "Friday" in an
 * email, an all-day Classroom due date, eight in the morning. A Worker runs
 * in UTC and cannot be told otherwise, so instead each time is moved onto the
 * person's wall clock before core sees it — 18:30 in Kolkata becomes 18:30
 * UTC — and moved back afterwards. Core then reads the right hour without
 * knowing any of this.
 */
export class Zone {
  private readonly format: Intl.DateTimeFormat | null

  constructor(readonly name: string) {
    this.format = zoneFormat(name)
  }

  /** How far the wall clock is ahead of UTC at `t`, in ms. */
  offset(t: number): number {
    if (!this.format) return 0
    const parts: Record<string, number> = {}
    for (const part of this.format.formatToParts(new Date(t))) if (part.type !== 'literal') parts[part.type] = Number(part.value)
    const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour! % 24, parts.minute!, parts.second!)
    return wall - (t - (((t % 1000) + 1000) % 1000))
  }

  /** The instant, as the person's clock shows it, read as UTC. */
  toWall(t: number): number {
    return t + this.offset(t)
  }

  /** Back from the wall clock to the real instant. Twice, so a time near a clock change settles. */
  fromWall(wall: number): number {
    const first = wall - this.offset(wall)
    return wall - this.offset(first)
  }
}

const formats = new Map<string, Intl.DateTimeFormat | null>()

/** Building a formatter is the costly part, so there is one per zone per isolate. Unknown zones are UTC. */
function zoneFormat(name: string): Intl.DateTimeFormat | null {
  if (!name || name === 'UTC' || name === 'Etc/UTC') return null
  if (formats.has(name)) return formats.get(name)!
  let made: Intl.DateTimeFormat | null = null
  try {
    made = new Intl.DateTimeFormat('en-US', {
      timeZone: name,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
  } catch {
    made = null
  }
  formats.set(name, made)
  return made
}

/** A zone name the runtime knows, or UTC. */
export function zoneName(name: unknown): string {
  return typeof name === 'string' && name.length < 64 && zoneFormat(name) ? name : 'UTC'
}
