import { DAY } from '@cairn/core'
import { isNewerVersion, LATEST_RELEASE_API, newerRelease, type AvailableRelease } from '@cairn/ui'
import Constants from 'expo-constants'
import { useCallback, useEffect, useState } from 'react'
import { storage } from '../platform/storage'

/**
 * A newer Cairn on GitHub Releases, for the banner in Settings → About.
 * GitHub is asked at most once a day; the answer is kept on the phone in
 * between, and a version the person dismissed is not offered again.
 */

const CHECKED_KEY = 'cairn.update.checked'
const DISMISSED_KEY = 'cairn.update.dismissed'

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

interface Checked {
  at: number
  release: AvailableRelease | null
}

async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await storage.get(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

async function look(): Promise<AvailableRelease | null> {
  const kept = await read<Checked>(CHECKED_KEY)
  // Still newer than this app? It may have been installed since the last look.
  if (kept && Date.now() - kept.at < DAY) return kept.release && isNewerVersion(kept.release.version, APP_VERSION) ? kept.release : null
  const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
  // No release yet, or GitHub's hourly limit for this network: try again tomorrow.
  const release = response.ok ? newerRelease(await response.json(), APP_VERSION) : null
  await storage.set(CHECKED_KEY, JSON.stringify({ at: Date.now(), release } satisfies Checked))
  return release
}

export function useAppUpdate(): { release: AvailableRelease | null; dismiss(): void } {
  const [release, setRelease] = useState<AvailableRelease | null>(null)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const found = await look().catch(() => null)
      const dismissed = await storage.get(DISMISSED_KEY).catch(() => null)
      if (!cancelled && found && found.version !== dismissed) setRelease(found)
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const dismiss = useCallback(() => {
    if (release) void storage.set(DISMISSED_KEY, release.version)
    setRelease(null)
  }, [release])
  return { release, dismiss }
}
