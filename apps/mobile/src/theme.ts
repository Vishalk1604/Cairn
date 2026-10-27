import { useColorScheme } from 'react-native'

export interface Palette {
  /** Behind everything. Black on OLED phones is both the reference and cheaper to light. */
  bg: string
  /** Cards and sheets. */
  surface: string
  /** A pressed or selected surface. */
  surfaceHigh: string
  fg: string
  muted: string
  faint: string
  line: string
  /** Pins, the compose button, the selected chip. */
  accent: string
  onAccent: string
  danger: string
}

const dark: Palette = {
  bg: '#000000',
  surface: '#1c1c1e',
  surfaceHigh: '#2c2c2e',
  fg: '#f2f2f2',
  muted: '#9a9a9e',
  faint: '#6e6e73',
  line: '#2c2c2e',
  accent: '#f5a623',
  onAccent: '#1a1a1a',
  danger: '#ff6b60',
}

const light: Palette = {
  bg: '#fafafa',
  surface: '#ffffff',
  surfaceHigh: '#f0f0f0',
  fg: '#1f1f1f',
  muted: '#6b6b6b',
  faint: '#8a8a8a',
  line: '#dedede',
  accent: '#e09400',
  onAccent: '#ffffff',
  danger: '#d93025',
}

/**
 * Dark unless the phone asks for light. The reference this app is built
 * against is dark, so that is the side the design is tuned on.
 */
export function useColors(): Palette {
  return useColorScheme() === 'light' ? light : dark
}

/** Which theme is showing, for tokens that have a shade per theme (course colours). */
export function useScheme(): 'dark' | 'light' {
  return useColorScheme() === 'light' ? 'light' : 'dark'
}

/** Both palettes, for the home-screen widget, which draws outside React's tree. */
export const palettes = { dark, light } as const

/**
 * The default palette, for the few places that cannot hold a hook — and for
 * components still written against a module-level `colors`.
 */
export const colors = dark

export const radius = { card: 14, chip: 18, sheet: 20 } as const

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const

export const type = {
  screenTitle: { fontSize: 34, fontWeight: '400' as const },
  cardTitle: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, lineHeight: 22 },
  meta: { fontSize: 12 },
}
