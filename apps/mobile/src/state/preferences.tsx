import { watchPreferences, writePreferences } from '@cairn/sync'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { storage } from '../platform/storage'
import { LOCAL_USER, useCairn } from './context'

export type FontSize = 'small' | 'medium' | 'large'
export type SortOrder = 'modified' | 'created'
export type Layout = 'grid' | 'list'

export interface Preferences {
  fontSize: FontSize
  sort: SortOrder
  layout: Layout
  /** Folder (tag) names in the order they were pinned. */
  pinnedFolders: string[]
  /** Reminders marked high priority sound even in silent or Do Not Disturb. */
  urgentAlerts: boolean
  /**
   * Accounts whose Gmail or Classroom reading is switched off, by Google
   * account id. Switching off is a choice made here, not a revocation: Google
   * keeps the permission, so switching back on needs no second consent.
   */
  paused: Record<Feature, string[]>
  updatedAt: number
}

export type Feature = 'mail' | 'classroom'

const DEFAULTS: Preferences = {
  fontSize: 'medium',
  sort: 'modified',
  layout: 'grid',
  pinnedFolders: [],
  urgentAlerts: false,
  paused: { mail: [], classroom: [] },
  updatedAt: 0,
}

const KEY = 'cairn.preferences'
/** Where pinned folders lived before there was a preferences record. */
const OLD_PINNED_KEY = 'cairn.folders.pinned'

/** Body text sizes behind the Small / Medium / Large setting. */
export const FONT_SCALE: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.15 }

interface PreferencesApi {
  preferences: Preferences
  update(change: Partial<Omit<Preferences, 'updatedAt'>>): void
  togglePinned(folder: string): void
  setPaused(feature: Feature, account: string, paused: boolean): void
}

const Context = createContext<PreferencesApi | null>(null)

function parse(raw: string | null): Partial<Preferences> {
  if (!raw) return {}
  try {
    const value: unknown = JSON.parse(raw)
    return value && typeof value === 'object' ? (value as Partial<Preferences>) : {}
  } catch {
    // Settings are not worth a crash; a damaged record falls back to defaults.
    return {}
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { userId } = useCairn()
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS)
  const latest = useRef(preferences)
  latest.current = preferences

  useEffect(() => {
    void (async () => {
      const saved = parse(await storage.get(KEY))
      let pinnedFolders: string[] = []
      if (!saved.pinnedFolders) {
        const old: unknown = parse(await storage.get(OLD_PINNED_KEY))
        if (Array.isArray(old)) pinnedFolders = old.filter((f): f is string => typeof f === 'string')
      }
      setPreferences({ ...DEFAULTS, pinnedFolders, ...saved })
    })()
  }, [])

  // Signed in, the cloud copy wins whenever it is newer than what is here.
  useEffect(() => {
    if (userId === LOCAL_USER) return
    return watchPreferences<Preferences>(userId, (remote) => {
      if (remote.updatedAt > latest.current.updatedAt) {
        const next = { ...DEFAULTS, ...remote }
        setPreferences(next)
        void storage.set(KEY, JSON.stringify(next))
      } else if (remote.updatedAt < latest.current.updatedAt) {
        void writePreferences(userId, latest.current).catch(() => {})
      }
    })
  }, [userId])

  const commit = useCallback(
    (make: (current: Preferences) => Partial<Preferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...make(current), updatedAt: Math.max(Date.now(), current.updatedAt + 1) }
        void storage.set(KEY, JSON.stringify(next))
        if (userId !== LOCAL_USER) void writePreferences(userId, next).catch(() => {})
        return next
      })
    },
    [userId],
  )

  const update = useCallback((change: Partial<Omit<Preferences, 'updatedAt'>>) => commit(() => change), [commit])
  const togglePinned = useCallback(
    (folder: string) =>
      commit((current) => ({
        pinnedFolders: current.pinnedFolders.includes(folder)
          ? current.pinnedFolders.filter((f) => f !== folder)
          : [...current.pinnedFolders, folder],
      })),
    [commit],
  )

  const setPaused = useCallback(
    (feature: Feature, account: string, paused: boolean) =>
      commit((current) => {
        const list = (current.paused ?? DEFAULTS.paused)[feature].filter((sub) => sub !== account)
        return { paused: { ...DEFAULTS.paused, ...current.paused, [feature]: paused ? [...list, account] : list } }
      }),
    [commit],
  )

  const value = useMemo(() => ({ preferences, update, togglePinned, setPaused }), [preferences, update, togglePinned, setPaused])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function usePreferences(): PreferencesApi {
  const value = useContext(Context)
  if (!value) throw new Error('usePreferences needs a PreferencesProvider')
  return value
}
