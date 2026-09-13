import type { KeyValueStore } from '@cairn/sync'
import type { PermissionState, Platform } from './types'

const storage: KeyValueStore = {
  async get(key) {
    return localStorage.getItem(key)
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
}

const supportsNotifications = () => typeof Notification !== 'undefined'

export const webPlatform: Platform = {
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
}
