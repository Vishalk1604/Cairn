import type { KeyValueStore } from '@cairn/sync'
import type { PermissionState } from '@cairn/ui'
import { googleClientId, googleClientSecret } from './googleClient'
import type { DesktopPlatform } from './types'

const storage: KeyValueStore = {
  async get(key) {
    return localStorage.getItem(key)
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
}

const supportsNotifications = () => typeof Notification !== 'undefined'

export const webPlatform: DesktopPlatform = {
  name: 'web',
  storage,

  async notificationPermission() {
    return supportsNotifications() ? Notification.permission : 'denied'
  },

  async requestNotificationPermission(): Promise<PermissionState> {
    return supportsNotifications() ? Notification.requestPermission() : 'denied'
  },

  async notify({ title, body, tag, onClick }) {
    if (!supportsNotifications() || Notification.permission !== 'granted') return
    const notification = new Notification(title, { body, tag })
    notification.onclick = () => {
      window.focus()
      onClick?.()
      notification.close()
    }
  },

  async registerQuickCapture(onTrigger) {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.code === 'Space') {
        event.preventDefault()
        onTrigger()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  },

  async showWindow() {
    window.focus()
  },

  async setTrayState() {
    // No tray in a browser; the tab title already carries the count.
  },

  // Browser storage is readable by anything with the page open, which is no
  // place for a refresh token. Development in a browser therefore runs
  // signed out, and everything that does not need an account still works.
  secrets: {
    async get() {
      return null
    },
    async set() {
      throw new Error('Signing in needs the Cairn desktop app')
    },
    async delete() {
      // Nothing was ever stored.
    },
  },

  async setWindowMode() {
    // A tab is as wide as the browser makes it; the layout follows that.
  },

  async minimizeWindow() {},

  async startDrag() {},

  async hideWindow() {},

  async openLink(url) {
    window.open(url, '_blank', 'noopener')
  },

  autostart: null,

  // A page cannot keep files in a folder; photos show in the desktop app.
  media: null,

  googleClientId,
  googleClientSecret,

  async authorize() {
    throw new Error('Signing in needs the Cairn desktop app, which can listen for Google’s reply')
  },
}
