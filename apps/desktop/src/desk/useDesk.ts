import type { Reminder } from '@cairn/core'
import { widgetData } from '@cairn/ui'
import { useEffect, useMemo, useRef } from 'react'
import { useCairn } from '../app/context'
import { useScheme } from '../app/courses'
import { useInbox } from '../app/inbox'
import type { DeskAction, DeskData } from './feed'

/** Rows the pinned widget is sent; it shows what fits and says how many more. */
const DESK_ROWS = 12

/** What Today pinned to the desktop shows: the same choice and order as the phone's widget. */
export function useDeskData(active: readonly Reminder[], now: number): DeskData {
  const inbox = useInbox()
  const scheme = useScheme()
  return useMemo(() => {
    const data = widgetData(active, now, { limit: DESK_ROWS, courseColors: inbox.courseColors, scheme })
    return {
      ...data,
      classroom: inbox.unseenClassroom,
      mail: inbox.unseen,
      date: new Date(now).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      total: active.length,
    }
  }, [active, now, inbox.courseColors, inbox.unseen, inbox.unseenClassroom, scheme])
}

/**
 * The main window feeding the pinned one: sends it what to show whenever
 * that changes, and does what it asks.
 */
export function useDeskFeed(data: DeskData, onAction: (action: Exclude<DeskAction, { kind: 'ready' }>) => void): void {
  const { platform } = useCairn()
  const desk = platform.desk
  const latest = useRef(data)
  latest.current = data
  const act = useRef(onAction)
  act.current = onAction

  useEffect(() => {
    void desk?.send(data).catch(() => {})
  }, [desk, data])

  useEffect(() => {
    if (!desk) return
    let stop: (() => void) | undefined
    let cancelled = false
    void desk
      .onAction((action) => {
        if (action.kind === 'ready') void desk.send(latest.current).catch(() => {})
        else act.current(action)
      })
      .then((unlisten) => (cancelled ? unlisten() : (stop = unlisten)))
    return () => {
      cancelled = true
      stop?.()
    }
  }, [desk])
}
