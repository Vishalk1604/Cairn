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
export interface Platform {
  readonly name: 'web' | 'tauri'
  readonly storage: KeyValueStore
  notificationPermission(): Promise<PermissionState>
  requestNotificationPermission(): Promise<PermissionState>
  notify(notification: AppNotification): Promise<void>
  /** Ctrl+Shift+Space. System-wide under Tauri; in a browser only while the page has focus. */
  registerQuickCapture(onTrigger: () => void): Promise<() => void>
  showWindow(): Promise<void>
}
