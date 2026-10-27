import type { WorkerClient } from '@cairn/sync'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { storage } from './storage'

/**
 * Push from Cairn's Worker, through Firebase Cloud Messaging: new coursework,
 * announcements and important mail as they are found, and the evening,
 * morning and eight o'clock digests, all with the app closed.
 *
 * The phone tells the Worker its FCM token and time zone. Building the app
 * needs google-services.json from the Firebase project (see the README);
 * without it there is no token to give and push stays off.
 */
const TOKEN_KEY = 'cairn.push.token'

export function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** Gives the Worker this phone's push token. Call once notifications are allowed and someone is signed in. */
export async function registerPush(worker: Pick<WorkerClient, 'registerPush'>, token?: string): Promise<void> {
  if (Platform.OS !== 'android') return
  const data = token ?? (await Notifications.getDevicePushTokenAsync()).data
  if (typeof data !== 'string' || !data) return
  await worker.registerPush(data, timeZone())
  await storage.set(TOKEN_KEY, data)
}

/** Stops push to this phone, on signing out. */
export async function forgetPushToken(worker: Pick<WorkerClient, 'unregisterPush'>): Promise<void> {
  const token = await storage.get(TOKEN_KEY)
  if (!token) return
  await worker.unregisterPush(token)
  await storage.set(TOKEN_KEY, '')
}

/** FCM can change the token; the Worker is told the new one. */
export function onPushTokenChange(worker: Pick<WorkerClient, 'registerPush'>): () => void {
  if (Platform.OS !== 'android') return () => {}
  const subscription = Notifications.addPushTokenListener((token) => {
    if (typeof token.data === 'string') void registerPush(worker, token.data).catch(() => {})
  })
  return () => subscription.remove()
}
