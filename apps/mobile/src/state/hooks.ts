import { MINUTE, nextUrgencyChangeAt, startOfNextLocalDay, type Entity, type Reminder } from '@cairn/core'
import type { Repository } from '@cairn/sync'
import { useEffect, useLayoutEffect, useState } from 'react'
import { AppState } from 'react-native'

/** Live query results, subscribed before the first paint. */
export function useObserved<T extends Entity, Q>(repo: Repository<T, Q>, query: Q): T[] {
  const key = JSON.stringify(query)
  const [items, setItems] = useState<T[]>([])
  useLayoutEffect(() => repo.observe(JSON.parse(key) as Q, setItems), [repo, key])
  return items
}

/**
 * The current time, re-rendered when an urgency color flips, at midnight, at
 * least once a minute, and whenever the app comes back to the foreground.
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
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now())
    })
    return () => subscription.remove()
  }, [])

  return now
}
