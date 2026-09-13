import { MINUTE, nextUrgencyChangeAt, startOfNextLocalDay, type Entity, type Reminder } from '@cairn/core'
import type { Repository } from '@cairn/sync'
import { useEffect, useLayoutEffect, useState } from 'react'

/** Live query results. The layout effect subscribes before paint, so there's no empty flash. */
export function useObserved<T extends Entity, Q>(repo: Repository<T, Q>, query: Q): T[] {
  const key = JSON.stringify(query)
  const [items, setItems] = useState<T[]>([])
  useLayoutEffect(() => repo.observe(JSON.parse(key) as Q, setItems), [repo, key])
  return items
}

/**
 * The current time, re-rendered exactly when an urgency color flips, at
 * midnight, and at least once a minute. Also refreshes when the window
 * regains focus, e.g. after the laptop wakes.
 */
export function useNow(reminders: readonly Reminder[]): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const current = Date.now()
    let next = Math.min(startOfNextLocalDay(current), current + MINUTE)
    for (const r of reminders) {
      const change = nextUrgencyChangeAt(r, current)
      if (change !== null && change < next) next = change
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, next - current) + 20)
    return () => clearTimeout(timer)
  }, [reminders, now])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return now
}
