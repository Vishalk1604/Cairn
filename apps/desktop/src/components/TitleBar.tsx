import type { MouseEvent } from 'react'
import { useCairn } from '../app/context'
import { CloseIcon, ExpandIcon, MinimizeIcon, WidgetIcon } from './icons'

/**
 * The window has no frame of its own, so this strip is the frame: dragging
 * it moves the window, and its buttons switch between the widget and the
 * full app. Closing only hides — reminders keep firing from the tray.
 */
export function TitleBar({ wide }: { wide: boolean }) {
  const { platform, auth, email } = useCairn()
  const status =
    auth.status === 'synced' && email
      ? `Syncing as ${email}`
      : auth.status === 'connecting'
        ? 'Connecting…'
        : auth.status === 'error'
          ? 'Not syncing'
          : 'On this computer only'

  const onButton = (event: MouseEvent) => (event.target as Element).closest('button') !== null
  const switchMode = () => void platform.setWindowMode(wide ? 'widget' : 'full')

  return (
    <header
      className="titlebar"
      // Anywhere on the bar but its buttons moves the window; a double click
      // switches shape, the way it maximises an ordinary window.
      // Read from the press itself, as Tauri's own drag regions do: once a
      // drag starts, Windows keeps the mouse and no double-click ever arrives.
      onMouseDown={(event) => {
        if (event.button !== 0 || onButton(event)) return
        if (event.detail === 2) switchMode()
        else void platform.startDrag()
      }}
    >
      <span className="brand">
        <span className="brand-mark" aria-hidden="true" />
        Cairn
      </span>
      <span className={`sync-dot ${auth.status}`} title={status} aria-label={status} role="img" />
      <span className="titlebar-fill" />
      <button
        type="button"
        className="window-button"
        onClick={switchMode}
        aria-label={wide ? 'Shrink to the desktop widget' : 'Expand to the full app'}
        title={wide ? 'Widget' : 'Full app'}
      >
        {wide ? <WidgetIcon size={16} /> : <ExpandIcon size={16} />}
      </button>
      {wide && (
        <button type="button" className="window-button" onClick={() => void platform.minimizeWindow()} aria-label="Minimize" title="Minimize">
          <MinimizeIcon size={16} />
        </button>
      )}
      <button
        type="button"
        className="window-button close"
        onClick={() => void platform.hideWindow()}
        aria-label="Hide Cairn"
        title="Hide (keeps running in the tray)"
      >
        <CloseIcon size={16} />
      </button>
    </header>
  )
}
