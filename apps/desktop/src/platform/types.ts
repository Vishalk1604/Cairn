import type { UrgencyLevel } from '@cairn/core'
import type { LocalMediaFile, Platform } from '@cairn/ui'
import type { DeskAction, DeskData } from '../desk/feed'

/**
 * Everything the desktop app needs from its host, on top of what every Cairn
 * app needs. The browser implementation lets the app run in any browser
 * during development; the Tauri one adds the real global hotkey, tray and
 * native toasts.
 */
export interface DesktopPlatform extends Platform {
  readonly name: 'web' | 'tauri'
  /** Ctrl+Shift+Space. System-wide under Tauri; in a browser only while the page has focus. */
  registerQuickCapture(onTrigger: () => void): Promise<() => void>
  showWindow(): Promise<void>
  /** Shows the most urgent pending reminder in the tray. No-op without one. */
  setTrayState(level: UrgencyLevel | null, tooltip: string): Promise<void>
  /**
   * Fills the screen as the full app, or shrinks back into the desktop
   * widget. A browser has one shape, set by the tab's width.
   */
  setWindowMode(mode: 'widget' | 'full'): Promise<void>
  minimizeWindow(): Promise<void>
  /** Moves the frameless window with the mouse, from a press on its title bar. */
  startDrag(): Promise<void>
  /** Out of sight but still running, so reminders keep firing. */
  hideWindow(): Promise<void>
  /** In the default browser. */
  openLink(url: string): Promise<void>
  /** Start with Windows. Null in a browser. */
  readonly autostart: { isEnabled(): Promise<boolean>; set(enabled: boolean): Promise<boolean> } | null
  /** A folder on disk for photos and recordings. Null in a browser, which has no disk to offer. */
  readonly media: DesktopMedia | null
  /** A folder on disk for files from Google Classroom. Null in a browser. */
  readonly classroom: DesktopClassroom | null
  /** Today pinned to the desktop, a window of its own. Null in a browser. */
  readonly desk: DesktopDesk | null
}

/** The main window's side of the pinned widget (desk/feed.ts). */
export interface DesktopDesk {
  pinned(): Promise<boolean>
  /** Pins it to the desktop or takes it away, and says which it is now. */
  pin(enabled: boolean): Promise<boolean>
  /** What it should show now. Nothing happens when it is not pinned. */
  send(data: DeskData): Promise<void>
  /** What it asks for: a task completed, the full app. */
  onAction(handler: (action: DeskAction) => void): Promise<() => void>
}

/**
 * The Classroom folder: the user's own, so the shell only ever adds files
 * to it, under a folder per course, and never overwrites or deletes one.
 */
export interface DesktopClassroom {
  /** Documents\Cairn Classroom, until the user picks somewhere else. */
  defaultFolder(): Promise<string>
  /** Null when the picker is closed without choosing. */
  pickFolder(current: string): Promise<string | null>
  /** Saves a file at "Course/Name.pdf" inside the folder, and says the path it took, which gains " (2)" when the name is taken. */
  write(folder: string, path: string, bytes: ArrayBuffer): Promise<string>
  /** Shows the folder, or a course folder inside it, in Explorer. */
  open(folder: string): Promise<void>
}

/**
 * The media folder. The shell only ever touches files named the way Cairn
 * names them, so pointing it at a folder that holds other things is safe.
 */
export interface DesktopMedia {
  /** Beside Cairn's own data, until the user picks somewhere else. */
  defaultFolder(): Promise<string>
  /** Null when the picker is closed without choosing. */
  pickFolder(current: string): Promise<string | null>
  list(folder: string): Promise<LocalMediaFile[]>
  write(folder: string, name: string, bytes: ArrayBuffer): Promise<void>
  read(folder: string, name: string): Promise<ArrayBuffer>
  remove(folder: string, name: string): Promise<void>
  /** Moves Cairn's files to a new folder and says how many went. */
  move(from: string, to: string): Promise<number>
  /** Shows the folder in Explorer. */
  open(folder: string): Promise<void>
}
