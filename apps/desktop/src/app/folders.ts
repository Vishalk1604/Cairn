import { watchPreferences, writePreferences, type SyncedPreferences } from '@cairn/sync'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCairn } from './context'

/** The phone's settings document; only the pinned folders matter here. */
interface Preferences extends SyncedPreferences {
  pinnedFolders?: string[]
}

/**
 * Pinned folders, shared with the phone through the synced preferences.
 * Signed out there is nothing to share them with, so none are pinned.
 */
export function usePinnedFolders(): { pinned: string[]; toggle: (tag: string) => Promise<void> } {
  const { auth, userId } = useCairn()
  const [pinned, setPinned] = useState<string[]>([])
  const latest = useRef<Preferences | null>(null)
  const synced = auth.status === 'synced'

  useEffect(() => {
    if (!synced) {
      latest.current = null
      setPinned([])
      return
    }
    return watchPreferences<Preferences>(
      userId,
      (value) => {
        latest.current = value
        setPinned(Array.isArray(value.pinnedFolders) ? value.pinnedFolders : [])
      },
      (error) => console.error('Could not read preferences', error),
    )
  }, [synced, userId])

  const toggle = useCallback(
    async (tag: string) => {
      if (!synced) return
      const current = latest.current?.pinnedFolders ?? []
      const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
      setPinned(next)
      // Everything else in the document is the phone's; it is written back as it was.
      await writePreferences<Preferences>(userId, { ...latest.current, pinnedFolders: next, updatedAt: Date.now() })
    },
    [synced, userId],
  )

  return { pinned, toggle }
}
