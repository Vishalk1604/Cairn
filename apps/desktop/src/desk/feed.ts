import type { WidgetData } from '@cairn/ui'

/**
 * Between the main window and Today pinned to the desktop. The main window
 * holds the data and sends the pinned one what to show; the pinned one only
 * draws it and asks for things to be done. So there is one copy of the tasks
 * and one connection to the cloud, however many shapes Cairn is in.
 */

/** What the pinned widget shows: the home-screen widget's selection, with the date. */
export interface DeskData extends WidgetData {
  date: string
  /** Pending today and beyond, for "All 12 tasks". */
  total: number
}

export type DeskAction =
  /** The pinned window has opened and wants what to show. */
  | { kind: 'ready' }
  | { kind: 'complete'; id: string }
  /** Double-click: the full app, on a task if one was double-clicked. */
  | { kind: 'open'; id?: string }

export const DESK_DATA_EVENT = 'cairn://desk-data'
export const DESK_ACTION_EVENT = 'cairn://desk-action'
/** As the shell names the pinned window (desk.rs). */
export const DESK_LABEL = 'desk'
