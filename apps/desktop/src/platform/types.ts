import type { UrgencyLevel } from '@cairn/core'
import type { KeyValueStore } from '@cairn/sync'

export type PermissionState = 'granted' | 'denied' | 'default'

export interface AppNotification {
  title: string
  body?: string
  /** A newer notification with the same tag replaces the older one. */
  tag?: string
  onClick?: () => void
}

/**
 * Everything the desktop app needs from its host. The browser implementation
 * lets the app run in any browser during development; the Tauri one adds the
 * real global hotkey, tray and native toasts.
 */
/** Somewhere a refresh token can live that is not a plain file. */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

export interface Platform {
  readonly name: 'web' | 'tauri'
  readonly storage: KeyValueStore
  notificationPermission(): Promise<PermissionState>
  requestNotificationPermission(): Promise<PermissionState>
  notify(notification: AppNotification): Promise<void>
  /** Ctrl+Shift+Space. System-wide under Tauri; in a browser only while the page has focus. */
  registerQuickCapture(onTrigger: () => void): Promise<() => void>
  showWindow(): Promise<void>
  /** Shows the most urgent pending reminder in the tray. No-op without one. */
  setTrayState(level: UrgencyLevel | null, tooltip: string): Promise<void>
  /** Encrypted at rest where the platform can manage it. */
  readonly secrets: SecretStore
  /**
   * Runs the browser half of signing in and returns the redirect Google sent
   * back. `buildUrl` is handed the redirect address, which is not known until
   * the platform has somewhere to listen.
   */
  authorize(buildUrl: (redirectUri: string) => string): Promise<string>
}
