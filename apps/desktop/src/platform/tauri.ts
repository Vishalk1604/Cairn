import type { UrgencyLevel } from '@cairn/core'
import type { KeyValueStore } from '@cairn/sync'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isPermissionGranted, onAction, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { load, type Store } from '@tauri-apps/plugin-store'
import type { AppNotification, PermissionState, Platform } from './types'

/** Raised by the shell for the hotkey and the tray menu item. */
const QUICK_CAPTURE_EVENT = 'cairn://quick-capture'

// One JSON file in the app's data directory, so the data outlives the WebView
// cache and can be backed up or inspected by hand.
let opening: Promise<Store> | null = null
const store = () => (opening ??= load('cairn.json'))

const storage: KeyValueStore = {
  async get(key) {
    return (await (await store()).get<string>(key)) ?? null
  },
  async set(key, value) {
    const open = await store()
    await open.set(key, value)
    // Written through rather than left to autosave: the repository already
    // coalesces bursts, and an unsaved buffer would be lost on quit.
    await open.save()
  },
}

// Windows only reports a toast click while the toast is still on screen, so
// callbacks are kept by notification id and dropped once they go stale.
const clickHandlers = new Map<number, () => void>()
let nextNotificationId = 1
let actionListener: Promise<unknown> | null = null

function trackClicks(): void {
  actionListener ??= onAction((event) => {
    const id = event.notification?.id
    if (id === undefined) return
    clickHandlers.get(id)?.()
    clickHandlers.delete(id)
  }).catch((error: unknown) => {
    console.error('Could not listen for notification clicks', error)
  })
}

export const tauriPlatform: Platform = {
  name: 'tauri',
  storage,

  async notificationPermission(): Promise<PermissionState> {
    // Windows has no "denied" state to report back, so anything short of
    // granted is treated as "not asked yet".
    return (await isPermissionGranted()) ? 'granted' : 'default'
  },

  async requestNotificationPermission(): Promise<PermissionState> {
    return (await requestPermission()) as PermissionState
  },

  async notify({ title, body, tag, onClick }: AppNotification) {
    if (!(await isPermissionGranted())) return
    const id = nextNotificationId++
    if (onClick) {
      trackClicks()
      clickHandlers.set(id, onClick)
      // Clicks are only reported while the toast is up; don't leak the rest.
      setTimeout(() => clickHandlers.delete(id), 60_000)
    }
    sendNotification({ id, title, body, group: tag })
  },

  async registerQuickCapture(onTrigger) {
    // The shell owns the hotkey: Windows only grants the foreground in the
    // moment the hotkey arrives, so it raises the window itself and then asks
    // here for the caret. The tray menu item raises the same event.
    const stopListening = await listen(QUICK_CAPTURE_EVENT, () => onTrigger())
    return stopListening
  },

  async showWindow() {
    await invoke('show_window')
  },

  async setTrayState(level: UrgencyLevel | null, tooltip: string) {
    await invoke('set_tray_state', { level, tooltip })
  },
}
