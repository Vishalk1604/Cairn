import type { Reminder } from '@cairn/core'
import { planNotifications } from '@cairn/ui'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

const CHANNEL_ID = 'reminders'
/**
 * A second channel for high-priority reminders, allowed through Do Not
 * Disturb. Android only honours that once the person grants Cairn "Do Not
 * Disturb access" in system settings; until then it behaves like the first.
 */
const URGENT_CHANNEL_ID = 'reminders-urgent'
/** Push from Cairn's Worker: new coursework, announcements and important mail. Named to match apps/worker fcm.ts. */
const INBOX_CHANNEL_ID = 'inbox'
/** Push from Cairn's Worker: the evening, morning and eight o'clock digests. */
const DIGEST_CHANNEL_ID = 'digest'

let urgentAlerts = false

/** Whether high-priority reminders go out on the channel that can sound in silent mode. */
export function setUrgentAlerts(enabled: boolean): void {
  urgentAlerts = enabled
}

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
    await Notifications.setNotificationChannelAsync(URGENT_CHANNEL_ID, {
      name: 'High-priority reminders',
      description: 'Sound even when the phone is silent or in Do Not Disturb.',
      importance: Notifications.AndroidImportance.MAX,
      bypassDnd: true,
      audioAttributes: { usage: Notifications.AndroidAudioUsage.ALARM, contentType: Notifications.AndroidAudioContentType.SONIFICATION },
    })
    await Notifications.setNotificationChannelAsync(INBOX_CHANNEL_ID, {
      name: 'Classroom and mail',
      description: 'New coursework, announcements and important email.',
      importance: Notifications.AndroidImportance.HIGH,
    })
    await Notifications.setNotificationChannelAsync(DIGEST_CHANNEL_ID, {
      name: 'Daily summaries',
      description: 'What is due tomorrow, in the evening; what is due today, in the morning.',
      importance: Notifications.AndroidImportance.DEFAULT,
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
 *
 * Reschedules are serialized: each one clears the whole schedule before
 * writing it again, so two overlapping runs could cancel alarms the other had
 * just written and leave the device with nothing scheduled.
 */
export function scheduleNotifications(reminders: readonly Reminder[], now: number, options: { digest?: boolean } = {}): Promise<void> {
  const run = () => reschedule(reminders, now, options.digest ?? true)
  rescheduling = rescheduling.then(run, run)
  return rescheduling
}

let rescheduling: Promise<void> = Promise.resolve()

async function reschedule(reminders: readonly Reminder[], now: number, digest: boolean): Promise<void> {
  if (!notificationsSupported || (await notificationPermission()) !== 'granted') return
  // Signed in, the morning digest comes from Cairn's Worker by push instead.
  const plan = planNotifications(reminders, now, { digest })
  const urgent = new Set(urgentAlerts ? reminders.filter((r) => r.priority === 'high').map((r) => r.id) : [])
  await Notifications.cancelAllScheduledNotificationsAsync()
  for (const n of plan) {
    const channelId = n.reminderId && urgent.has(n.reminderId) ? URGENT_CHANNEL_ID : CHANNEL_ID
    await Notifications.scheduleNotificationAsync({
      identifier: n.id,
      content: { title: n.title, body: n.body, data: n.reminderId ? { reminderId: n.reminderId } : {} },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId },
    })
  }
}

/** What a tapped notification is about: a task, or something the Worker found. */
export interface Opened {
  reminderId?: string
  /** From the Worker's push: 'classroom', 'inbox', 'task' or 'today'. */
  kind?: string
  id?: string
}

function opened(response: Notifications.NotificationResponse): Opened {
  const content = response.notification.request.content.data ?? {}
  // A push shown by Android itself while Cairn was closed keeps its data on the remote message.
  const remote = (response.notification.request.trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null)?.remoteMessage?.data ?? {}
  const data = { ...remote, ...content } as Record<string, unknown>
  const text = (key: string) => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : undefined)
  const kind = text('kind')
  const id = text('id')
  return { reminderId: text('reminderId') ?? (kind === 'task' ? id : undefined), ...(kind ? { kind } : {}), ...(id ? { id } : {}) }
}

/** Calls back when the user taps a notification: a task's, or a push from the Worker, including the one that opened the app. */
export function onNotificationOpened(listener: (what: Opened) => void): () => void {
  if (!notificationsSupported) return () => {}
  let handled: string | null = null
  const handle = (response: Notifications.NotificationResponse) => {
    if (response.notification.request.identifier === handled) return
    handled = response.notification.request.identifier
    listener(opened(response))
  }
  void Notifications.getLastNotificationResponseAsync().then((response) => response && handle(response))
  const subscription = Notifications.addNotificationResponseReceivedListener(handle)
  return () => subscription.remove()
}
