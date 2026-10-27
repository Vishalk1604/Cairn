import { completeReminder, type InboxRecord, type SenderRule } from '@cairn/core'
import { currentUser, settled } from '@cairn/sync'
import { COURSE_COLORS_KEY, INBOX_CACHE_KEYS, SENDERS_KEY, widgetData, widgetRowsFor, type CourseColorOverrides, type WidgetData } from '@cairn/ui'
import { requestWidgetUpdate, type WidgetInfo, type WidgetRepresentation, type WidgetTaskHandler } from 'react-native-android-widget'
import { scheduleNotifications } from '../platform/notifications'
import { storage } from '../platform/storage'
import { openLocal, runningSync, startSync } from '../state/context'
import { palettes } from '../theme'
import { COMPLETE, TODAY_WIDGET, TodayWidget } from './TodayWidget'

/**
 * The home-screen widget's side of things. Everything it shows comes from
 * the phone's own store and what the app last cached — never a read from
 * the cloud — so drawing it is instant and costs nothing.
 *
 * It is drawn again when tasks change in the app, when the app goes to the
 * background, every half hour by Android, and when a push from Cairn's
 * Worker arrives (see pushTask.ts).
 */

/** Posts and mail announced by push since the app last looked, until it next does. */
export const PUSHED_KEY = 'cairn.widget.pushed'

async function json<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.get(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

async function snapshot(info: Pick<WidgetInfo, 'height'>, now: number): Promise<{ dark: WidgetData; light: WidgetData }> {
  const store = await openLocal()
  const [reminders, records, seenAt, seenClassroomAt, senders, courseColors, pushed] = await Promise.all([
    store.reminders.list({ status: ['pending', 'snoozed'] }),
    json<InboxRecord[]>(INBOX_CACHE_KEYS.records, []),
    json<number>(INBOX_CACHE_KEYS.seenAt, 0),
    json<number>(INBOX_CACHE_KEYS.seenClassroomAt, 0),
    json<Record<string, SenderRule>>(SENDERS_KEY, {}),
    json<CourseColorOverrides>(COURSE_COLORS_KEY, {}),
    json<{ classroom: number; mail: number }>(PUSHED_KEY, { classroom: 0, mail: 0 }),
  ])
  const make = (scheme: 'dark' | 'light') => {
    const data = widgetData(reminders, now, { limit: widgetRowsFor(info.height), inbox: { records, seenAt, seenClassroomAt, senders }, courseColors, scheme })
    return { ...data, classroom: data.classroom + pushed.classroom, mail: data.mail + pushed.mail }
  }
  return { dark: make('dark'), light: make('light') }
}

async function render(info: Pick<WidgetInfo, 'height' | 'width'>): Promise<WidgetRepresentation> {
  const data = await snapshot(info, Date.now())
  // Wide enough for the counts beside the title: about four cells.
  const wide = info.width >= 250
  return {
    light: <TodayWidget data={data.light} colors={palettes.light} wide={wide} />,
    dark: <TodayWidget data={data.dark} colors={palettes.dark} wide={wide} />,
  }
}

/** Draws every Today widget on the home screen again. Cheap, and safe to call often. */
export async function refreshWidgets(): Promise<void> {
  try {
    await requestWidgetUpdate({ widgetName: TODAY_WIDGET, renderWidget: render })
  } catch (error) {
    // A build without the widget (web, Expo Go) has nothing to update.
    console.warn('Could not draw the widget', error)
  }
}

/** The app has caught up with the inbox, so counts from push are already in its cache. */
export async function clearPushedCounts(): Promise<void> {
  await storage.set(PUSHED_KEY, JSON.stringify({ classroom: 0, mail: 0 }))
}

const withTimeout = <T,>(work: Promise<T>, ms: number) =>
  Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, ms))])

/**
 * Ticks a task off from the widget, without opening the app: the same
 * change, through the same store, as the circle in the Tasks tab. When the
 * app is not running to send it up, a short sync does, and if there is no
 * network it goes the next time the app syncs.
 */
async function complete(id: string): Promise<void> {
  const store = await openLocal()
  const task = await store.reminders.get(id)
  if (!task || task.deletedAt !== undefined || task.status === 'done') return
  const now = Date.now()
  await store.reminders.upsert(completeReminder(task, now))
  const active = await store.reminders.list({ status: ['pending', 'snoozed'] })
  const user = await currentUser().catch(() => null)
  // Its alert goes with it; signed in, the morning digest comes by push.
  void scheduleNotifications(active, now, { digest: !user })
  if (!user || runningSync()) return
  const sync = await startSync(store, user.uid)
  try {
    await withTimeout(
      sync.ready
        // replicate() sends what is newer once the server has answered; give it a moment to hand that over.
        .then(() => new Promise((resolve) => setTimeout(resolve, 300)))
        .then(() => settled()),
      15_000,
    )
  } finally {
    sync.stop()
  }
}

export const widgetTaskHandler: WidgetTaskHandler = async ({ widgetInfo, widgetAction, clickAction, clickActionData, renderWidget }) => {
  if (widgetAction === 'WIDGET_DELETED') return
  if (widgetAction === 'WIDGET_CLICK' && clickAction === COMPLETE && typeof clickActionData?.id === 'string') {
    await complete(clickActionData.id)
  }
  renderWidget(await render(widgetInfo))
}
