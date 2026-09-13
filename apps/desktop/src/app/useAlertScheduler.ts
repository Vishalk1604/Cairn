import type { Reminder } from '@cairn/core'
import { useEffect, useRef } from 'react'
import { planTick, type SchedulerState } from '../scheduler'
import { useCairn } from './context'

const STATE_KEY = 'cairn.scheduler'
const TICK_MS = 15_000

/**
 * Checks every 15s (and on wake) for alerts that came due since the last check.
 * The last tick is saved, so reminders that came due while the app was closed
 * are reported once on the next launch instead of being lost.
 */
export function useAlertScheduler(reminders: readonly Reminder[], onOpen: (reminderId: string) => void): void {
  const { platform } = useCairn()
  const latest = useRef({ reminders, onOpen })
  latest.current = { reminders, onOpen }

  useEffect(() => {
    let state: SchedulerState | null = null
    let busy = false

    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const now = Date.now()
        state ??= await loadState(now)
        const result = planTick(latest.current.reminders, state, now)
        state = result.state
        await platform.storage.set(STATE_KEY, JSON.stringify(state))
        for (const n of result.notifications) {
          const reminderId = n.reminderId
          await platform.notify({
            title: n.title,
            body: n.body,
            tag: n.tag,
            onClick: reminderId ? () => latest.current.onOpen(reminderId) : undefined,
          })
        }
      } catch (error) {
        console.error('Alert check failed', error)
      } finally {
        busy = false
      }
    }

    const loadState = async (now: number): Promise<SchedulerState> => {
      try {
        const saved = await platform.storage.get(STATE_KEY)
        if (saved) return JSON.parse(saved) as SchedulerState
      } catch {
        // Unreadable state just means starting the clock from now.
      }
      return { lastTick: now, lastDigestDay: null }
    }

    const onWake = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    void tick()
    const timer = setInterval(() => void tick(), TICK_MS)
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [platform])
}
