import type { UrgencyLevel } from '@cairn/core'
import type { AiFetch, KeyValueStore } from '@cairn/sync'
import type { AppNotification, PermissionState } from '@cairn/ui'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { fetch as shellFetch } from '@tauri-apps/plugin-http'
import { isPermissionGranted, onAction, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { load, type Store } from '@tauri-apps/plugin-store'
import { googleClientId, googleClientSecret } from './googleClient'
import type { DesktopClassroom, DesktopMedia, DesktopPlatform } from './types'

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

const media: DesktopMedia = {
  defaultFolder: () => invoke<string>('media_default_dir'),
  async pickFolder(current) {
    const picked = await openDialog({ directory: true, defaultPath: current, title: 'Where should Cairn keep photos and recordings?' })
    return typeof picked === 'string' ? picked : null
  },
  list: (folder) => invoke('media_list', { dir: folder }),
  // The file goes over as raw bytes rather than JSON. The folder and name
  // ride in headers, which only carry ASCII, hence the encoding.
  write: (folder, name, bytes) =>
    invoke('media_write', bytes, { headers: { 'x-dir': encodeURIComponent(folder), 'x-name': encodeURIComponent(name) } }),
  read: (folder, name) => invoke<ArrayBuffer>('media_read', { dir: folder, name }),
  remove: (folder, name) => invoke('media_remove', { dir: folder, name }),
  move: (from, to) => invoke<number>('media_move', { from, to }),
  open: (folder) => invoke('media_open', { dir: folder }),
}

const classroom: DesktopClassroom = {
  defaultFolder: () => invoke<string>('classroom_default_dir'),
  async pickFolder(current) {
    const picked = await openDialog({ directory: true, defaultPath: current, title: 'Where should Cairn save files from Classroom?' })
    return typeof picked === 'string' ? picked : null
  },
  write: (folder, path, bytes) =>
    invoke<string>('classroom_write', bytes, { headers: { 'x-dir': encodeURIComponent(folder), 'x-path': encodeURIComponent(path) } }),
  open: (folder) => invoke('media_open', { dir: folder }),
}

/**
 * NVIDIA's API sends no CORS headers, so a request from the web view would
 * be refused before it left. This one is made by the shell instead, which
 * the capabilities file allows for NVIDIA's addresses and nothing else.
 */
const aiFetch: AiFetch = (url, init) => shellFetch(url, init as RequestInit)

export const tauriPlatform: DesktopPlatform = {
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

  // Encrypted with DPAPI by the shell, so the token is tied to this Windows
  // account rather than sitting in a file any process could read.
  secrets: {
    get: (key) => invoke<string | null>('secret_get', { key }),
    set: (key, value) => invoke('secret_set', { key, value }),
    delete: (key) => invoke('secret_delete', { key }),
  },

  async setWindowMode(mode) {
    await invoke(mode === 'full' ? 'window_full' : 'window_widget')
  },

  async minimizeWindow() {
    await invoke('window_minimize')
  },

  async startDrag() {
    await getCurrentWindow().startDragging()
  },

  async hideWindow() {
    await invoke('window_hide')
  },

  async openLink(url) {
    await invoke('open_link', { url })
  },

  // Through the shell rather than the plugin's own calls, so the tick in the
  // tray menu changes along with it.
  autostart: {
    isEnabled: () => invoke<boolean>('autostart_enabled'),
    set: (enabled) => invoke<boolean>('set_autostart', { enabled }),
  },

  media,
  classroom,
  aiFetch,

  googleClientId,
  googleClientSecret,

  async authorize(buildUrl) {
    // The shell opens a loopback port first, because the redirect address
    // has to name the port Google will be sent back to.
    const port = await invoke<number>('oauth_listen')
    try {
      return await invoke<string>('oauth_await', { authorizeUrl: buildUrl(`http://127.0.0.1:${port}`) })
    } catch (error) {
      await invoke('oauth_cancel').catch(() => {})
      throw error
    }
  },
}
