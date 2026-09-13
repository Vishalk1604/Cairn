import type { Reminder } from '@cairn/core'
import { planNotifications } from '@cairn/ui'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const CHANNEL_ID = 'reminders'

/** Local notifications only exist on the device builds; the web build is for development. */
export const notificationsSupported = Platform.OS !== 'web'

export type PermissionState = 'granted' | 'denied' | 'undetermined'

export async function setUpNotifications(): Promise<void> {
  if (!notificationsSupported) return
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }
}

export async function notificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'denied'
  return (await Notifications.getPermissionsAsync()).status as PermissionState
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (!notificationsSupported) return 'denied'
  return (await Notifications.requestPermissionsAsync()).status as PermissionState
}

/**
 * Replaces everything scheduled with the current plan. Alerts fire from the
 * OS alarm manager, so they work with the app closed and no network.
 */
export async function scheduleNotifications(reminders: readonly Reminder[], now: number): Promise<void> {
  if (!notificationsSupported || (await notificationPermission()) !== 'granted') return
  const plan = planNotifications(reminders, now)
  await Notifications.cancelAllScheduledNotificationsAsync()
  for (const n of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.id,
      content: { title: n.title, body: n.body, data: n.reminderId ? { reminderId: n.reminderId } : {} },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: CHANNEL_ID },
    })
  }
}

/** Calls back with the reminder id when the user taps one of its notifications. */
export function onNotificationOpened(listener: (reminderId: string) => void): () => void {
  if (!notificationsSupported) return () => {}
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const reminderId = response.notification.request.content.data?.reminderId
    if (typeof reminderId === 'string') listener(reminderId)
  })
  return () => subscription.remove()
}
