import type { KeyValueStore } from '@cairn/sync'

export type PermissionState = 'granted' | 'denied' | 'default'

export interface AppNotification {
  title: string
  body?: string
  /** A newer notification with the same tag replaces the older one. */
  tag?: string
  onClick?: () => void
}

/** Somewhere a refresh token can live that is not a plain file. */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * What every Cairn app needs from its host: somewhere to keep data, somewhere
 * safe to keep a refresh token, notifications, and the browser half of
 * signing in. Each app extends this with whatever only its own host has — a
 * tray and a system-wide hotkey on Windows, for instance — so that the parts
 * both apps share can be written once.
 */
export interface Platform {
  /** Which host this is, for the rare decision that has to know. */
  readonly name: string
  readonly storage: KeyValueStore
  notificationPermission(): Promise<PermissionState>
  requestNotificationPermission(): Promise<PermissionState>
  notify(notification: AppNotification): Promise<void>
  /** Encrypted at rest where the platform can manage it. */
  readonly secrets: SecretStore
  /**
   * Runs the browser half of signing in and returns the redirect Google sent
   * back. `buildUrl` is handed the redirect address, which is not known until
   * the platform has somewhere to listen.
   */
  authorize(buildUrl: (redirectUri: string) => string): Promise<string>
  /** Public by design: it appears in every authorization URL. */
  readonly googleClientId: string
  /**
   * The client "secret" Google asks for at the token exchange. Each host has
   * its own answer — the Android client has none — and a desktop build has it
   * injected, so it is a call rather than a field: a build that is missing it
   * can then say so itself, naming the file to fill in.
   */
  googleClientSecret(): string | undefined
}
