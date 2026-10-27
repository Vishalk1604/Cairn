import { watchPreferences, writePreferences, type SyncedPreferences } from '@cairn/sync'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCairn } from './context'

/** The phone's settings document; only the pinned folders matter here. */
interface Preferences extends SyncedPreferences {
  pinnedFolders?: string[]
}

/**
 * The settings shared with the phone, through the synced preferences.
 * Signed out there is nothing to share them with, so none are pinned.
 */
function useSharedPreferences(): { value: Preferences | null; write: (change: Partial<Preferences>) => Promise<void> } {
  const { auth, userId } = useCairn()
  const [value, setValue] = useState<Preferences | null>(null)
  const latest = useRef<Preferences | null>(null)
  // The browser preview is signed in as nobody; there is nothing to share with.
  const synced = auth.status === 'synced' && userId !== 'preview'

  useEffect(() => {
    if (!synced) {
      latest.current = null
      setValue(null)
      return
    }
    return watchPreferences<Preferences>(
      userId,
      (next) => {
        latest.current = next
        setValue(next)
      },
      (error) => console.error('Could not read preferences', error),
    )
  }, [synced, userId])

  const write = useCallback(
    async (change: Partial<Preferences>) => {
      if (!synced) return
      // Everything else in the document is the phone's; it is written back as it was.
      const next = { ...latest.current, ...change, updatedAt: Math.max(Date.now(), (latest.current?.updatedAt ?? 0) + 1) }
      latest.current = next
      setValue(next)
      await writePreferences<Preferences>(userId, next)
    },
    [synced, userId],
  )

  return { value, write }
}

export function usePinnedFolders(): { pinned: string[]; toggle: (tag: string) => Promise<void> } {
  const { value, write } = useSharedPreferences()
  const pinned = Array.isArray(value?.pinnedFolders) ? value.pinnedFolders : []
  const toggle = useCallback(
    async (tag: string) => {
      await write({ pinnedFolders: pinned.includes(tag) ? pinned.filter((t) => t !== tag) : [...pinned, tag] })
    },
    [pinned, write],
  )
  return { pinned, toggle }
}
