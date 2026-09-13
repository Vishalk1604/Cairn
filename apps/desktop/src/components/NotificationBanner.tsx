import { useEffect, useState } from 'react'
import { useCairn } from '../app/context'
import type { PermissionState } from '../platform'

export function NotificationBanner() {
  const { platform } = useCairn()
  const [permission, setPermission] = useState<PermissionState | null>(null)

  useEffect(() => {
    void platform.notificationPermission().then(setPermission)
  }, [platform])

  if (permission === 'default') {
    return (
      <div className="banner" role="note">
        Turn on notifications so Cairn can alert you when things are due.
        <button type="button" onClick={async () => setPermission(await platform.requestNotificationPermission())}>
          Turn on
        </button>
      </div>
    )
  }
  if (permission === 'denied') {
    return (
      <div className="banner" role="note">
        Notifications are blocked, so Cairn can't alert you. Allow them in your settings; your lists still work.
      </div>
    )
  }
  return null
}
