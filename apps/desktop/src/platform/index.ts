import { tauriPlatform } from './tauri'
import type { Platform } from './types'
import { webPlatform } from './web'

export type { AppNotification, PermissionState, Platform } from './types'

/** Tauri injects this before any app code runs. */
const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function detectPlatform(): Platform {
  return inTauri() ? tauriPlatform : webPlatform
}
