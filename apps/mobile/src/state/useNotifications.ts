import type { Reminder } from '@cairn/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import {
  notificationPermission,
  notificationsSupported,
  requestNotificationPermission,
  scheduleNotifications,
  type PermissionState,
} from '../platform/notifications'

/**
 * Keeps the OS schedule in step with the reminders: shortly after any change,
 * and whenever the app returns to the foreground (so relative wording and
 * digests stay fresh). Also exposes the permission, which the app asks for
 * when it first has something to alert about rather than on first launch.
 */
export function useNotifications(reminders: readonly Reminder[]) {
  const [permission, setPermission] = useState<PermissionState | null>(null)
  const latest = useRef(reminders)
  latest.current = reminders

  useEffect(() => {
    void notificationPermission().then(setPermission)
  }, [])

  useEffect(() => {
    if (permission !== 'granted') return
    const timer = setTimeout(() => {
      scheduleNotifications(latest.current, Date.now()).catch((error) => console.error('Scheduling notifications failed', error))
    }, 500)
    return () => clearTimeout(timer)
  }, [reminders, permission])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void notificationPermission().then((current) => {
        setPermission(current)
        if (current === 'granted') void scheduleNotifications(latest.current, Date.now())
      })
    })
    return () => subscription.remove()
  }, [])

  const request = useCallback(async () => {
    setPermission(await requestNotificationPermission())
  }, [])

  return { supported: notificationsSupported, permission, request }
}
