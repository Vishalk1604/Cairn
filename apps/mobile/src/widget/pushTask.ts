import * as Notifications from 'expo-notifications'
import * as TaskManager from 'expo-task-manager'
import { storage } from '../platform/storage'
import { PUSHED_KEY, refreshWidgets } from './widget'

/**
 * Cairn's Worker follows the notifications it sends with one silent push
 * that wakes this task, even with the app closed, so the widget's counts
 * and colours are up to date by the time the phone is picked up. It reads
 * nothing from the cloud: the push says how many posts and emails it
 * announced, and the rest comes from the phone's own store.
 *
 * Defined at the top level, as expo-task-manager needs, from index.ts.
 */
export const WIDGET_PUSH_TASK = 'cairn-widget-push'

TaskManager.defineTask<Notifications.NotificationTaskPayload>(WIDGET_PUSH_TASK, async ({ data }) => {
  const payload = data && 'data' in data ? ((data as { data?: Record<string, unknown> }).data ?? {}) : {}
  if (payload.kind !== 'widget') return
  const number = (value: unknown) => (typeof value === 'string' || typeof value === 'number' ? Number(value) || 0 : 0)
  try {
    const raw = await storage.get(PUSHED_KEY)
    const before = raw ? (JSON.parse(raw) as { classroom: number; mail: number }) : { classroom: 0, mail: 0 }
    await storage.set(PUSHED_KEY, JSON.stringify({ classroom: before.classroom + number(payload.classroom), mail: before.mail + number(payload.mail) }))
  } catch {
    // The counts are a nicety; the redraw below still happens.
  }
  await refreshWidgets()
})

/** Asks for the task to run on push. Harmless to call again on every launch. */
export function registerWidgetPushTask(): void {
  Notifications.registerTaskAsync(WIDGET_PUSH_TASK).catch((error: unknown) => console.warn('Widget refresh on push is not available in this build', error))
}
