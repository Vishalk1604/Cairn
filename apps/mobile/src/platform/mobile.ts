import { GOOGLE_CLIENTS } from '@cairn/sync'
import type { Platform as CairnPlatform, PermissionState } from '@cairn/ui'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import './crypto'
import { notificationPermission, requestNotificationPermission } from './notifications'
import { storage } from './storage'

/**
 * Google's Android OAuth clients redirect to the app's own package name used
 * as a URL scheme. app.json registers that scheme so Android hands the
 * redirect back to Cairn rather than to a browser tab.
 */
const REDIRECT = 'io.github.vishalk1604.cairn:/oauth2redirect'

const toWeb = (state: Awaited<ReturnType<typeof notificationPermission>>): PermissionState =>
  state === 'undetermined' ? 'default' : state

/** SecureStore keys are limited to letters, digits, '.', '-' and '_'. */
const secretKey = (key: string) => `cairn.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`

export const mobilePlatform: CairnPlatform = {
  name: 'android',
  storage,
  notificationPermission: async () => toWeb(await notificationPermission()),
  requestNotificationPermission: async () => toWeb(await requestNotificationPermission()),
  async notify({ title, body }) {
    await Notifications.scheduleNotificationAsync({ content: { title, body }, trigger: null })
  },
  secrets: {
    // Backed by the Android Keystore: a refresh token never sits in a plain file.
    get: (key) => SecureStore.getItemAsync(secretKey(key)),
    set: (key, value) => SecureStore.setItemAsync(secretKey(key), value),
    delete: (key) => SecureStore.deleteItemAsync(secretKey(key)),
  },
  async authorize(buildUrl) {
    const result = await WebBrowser.openAuthSessionAsync(buildUrl(REDIRECT), REDIRECT, { showInRecents: false })
    if (result.type === 'success') return result.url
    throw new Error(result.type === 'cancel' || result.type === 'dismiss' ? 'Sign-in was cancelled' : 'Sign-in did not finish')
  },
  googleClientId: GOOGLE_CLIENTS.android,
  // Android clients prove themselves by package name and signing certificate, not a secret.
  googleClientSecret: () => undefined,
}
