import { tauriPlatform } from './tauri'
import type { DesktopPlatform } from './types'
import { webPlatform } from './web'

export type { AppNotification, PermissionState, SecretStore } from '@cairn/ui'
export type { DesktopPlatform } from './types'

/** Tauri injects this before any app code runs. */
const inTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function detectPlatform(): DesktopPlatform {
  return inTauri() ? tauriPlatform : webPlatform
}
