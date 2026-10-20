import { URGENCY_LEVELS, type UrgencyLevel } from '@cairn/core'
import { URGENCY } from '@cairn/ui'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The tray draws its icon in Rust, before any JavaScript runs, so the urgency
// colours are written out a second time there. This fails if they drift.
const source = readFileSync(fileURLToPath(new URL('../src-tauri/src/urgency.rs', import.meta.url)), 'utf8')

const colors = new Map<string, string>()
for (const [, name, r, g, b] of source.matchAll(
  /pub const (\w+): Rgb = \[0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2})\];/gi,
)) {
  colors.set(name!.toLowerCase(), `#${r}${g}${b}`.toLowerCase())
}

describe('tray colours', () => {
  it.each(URGENCY_LEVELS)('%s matches the shared token', (level: UrgencyLevel) => {
    expect(colors.get(level)).toBe(URGENCY[level].color.toLowerCase())
  })

  it('reads every level, and reuses one for the idle icon', () => {
    expect([...colors.keys()].sort()).toEqual([...URGENCY_LEVELS].sort())
    expect(/pub const IDLE: Rgb = (\w+);/.exec(source)?.[1]).toBe('LATER')
  })
})
