import { DAY } from '@cairn/core'
import { useEffect, useSyncExternalStore } from 'react'
import type { DesktopPlatform, DesktopUpdate } from '../platform/types'

/**
 * New versions, looked for quietly: a minute after launch and then once a
 * day, from GitHub Releases. Nothing interrupts; Settings → About offers the
 * update once there is one.
 */

export interface UpdateState {
  available: DesktopUpdate | null
  checking: boolean
  installing: boolean
  /** When the last look finished. */
  checkedAt: number | null
  error: string | null
}

let state: UpdateState = { available: null, checking: false, installing: false, checkedAt: null, error: null }
const listeners = new Set<() => void>()

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function checkForUpdate(platform: DesktopPlatform): Promise<void> {
  if (!platform.updates || state.checking || state.installing) return
  set({ checking: true, error: null })
  try {
    set({ available: await platform.updates.check(), checkedAt: Date.now() })
  } catch (error) {
    // Offline, or no release yet: nothing to say until asked.
    set({ error: error instanceof Error ? error.message : String(error), checkedAt: Date.now() })
  } finally {
    set({ checking: false })
  }
}

export async function installUpdate(): Promise<void> {
  const update = state.available
  if (!update || state.installing) return
  set({ installing: true, error: null })
  try {
    await update.install()
  } catch (error) {
    set({ installing: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/** Starts the quiet checks. Call once, from the main window. */
export function useUpdateChecks(platform: DesktopPlatform): void {
  useEffect(() => {
    if (!platform.updates) return
    const first = setTimeout(() => void checkForUpdate(platform), 60_000)
    const daily = setInterval(() => void checkForUpdate(platform), DAY)
    return () => {
      clearTimeout(first)
      clearInterval(daily)
    }
  }, [platform])
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(subscribe, () => state)
}

/** For the browser preview: an update that installs nothing. */
export function pretendUpdate(version: string): void {
  set({ available: { version, install: () => new Promise((resolve) => setTimeout(resolve, 1500)) }, checkedAt: Date.now() })
}
