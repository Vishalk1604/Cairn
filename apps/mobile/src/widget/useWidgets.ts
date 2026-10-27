import type { Reminder } from '@cairn/core'
import { readWidgetLink, type WidgetLink } from '@cairn/ui'
import { useEffect, useRef } from 'react'
import { AppState, Linking, Platform } from 'react-native'
import type { Inbox } from '../state/inbox'
import { clearPushedCounts, refreshWidgets } from './widget'

/**
 * Keeps the home-screen widget in step with the app: drawn again shortly
 * after tasks change, when the inbox's counts or the course colours change,
 * and as the app goes to the background.
 */
export function useWidgetRefresh(active: readonly Reminder[], inbox: Pick<Inbox, 'records' | 'unseen' | 'unseenClassroom' | 'courseColors'>): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const soon = () => {
    if (Platform.OS !== 'android') return
    if (timer.current) clearTimeout(timer.current)
    // A burst of edits (completing, then undoing) draws it once.
    timer.current = setTimeout(() => void refreshWidgets(), 500)
  }

  useEffect(soon, [active])
  useEffect(() => {
    if (Platform.OS !== 'android') return
    // The app has the inbox as it stands, so counts carried by push are in it now.
    void clearPushedCounts().then(soon)
  }, [inbox.records, inbox.unseen, inbox.unseenClassroom, inbox.courseColors])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') void refreshWidgets()
    })
    return () => {
      subscription.remove()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
}

/** Calls back with what a tap on the widget asked for, including the tap that opened the app. */
export function useWidgetLinks(onLink: (link: WidgetLink) => void): void {
  const latest = useRef(onLink)
  latest.current = onLink
  useEffect(() => {
    const handle = (url: string | null) => {
      const link = readWidgetLink(url)
      if (link) latest.current(link)
    }
    void Linking.getInitialURL().then(handle)
    const subscription = Linking.addEventListener('url', ({ url }) => handle(url))
    return () => subscription.remove()
  }, [])
}
