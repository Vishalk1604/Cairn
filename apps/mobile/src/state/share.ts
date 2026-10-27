import type { Note } from '@cairn/core'
import { noteFromShare } from '@cairn/ui'
import { useShareIntentContext } from 'expo-share-intent'
import { useEffect, useRef } from 'react'
import { keepSharedImage } from '../platform/media'
import { useActions } from './actions'
import { useToast } from './toast'

/**
 * Share to Cairn: text, a link or photos from any app become a new note,
 * which opens in the editor so a word can be added before pressing back.
 * Photos go in through the same attachments as the editor's own, and on to
 * Drive the same way.
 */
export function useShareToNote(open: (note: Note) => void): void {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext()
  const actions = useActions()
  const toast = useToast()
  const working = useRef(false)
  const latest = useRef(open)
  latest.current = open

  useEffect(() => {
    if (!hasShareIntent || working.current) return
    working.current = true
    void (async () => {
      try {
        const images = []
        for (const file of shareIntent.files ?? []) {
          const kept = await keepSharedImage(file).catch((error: unknown) => {
            console.warn('A shared photo could not be kept', error)
            return null
          })
          if (kept) images.push(kept)
        }
        const input = noteFromShare({ text: shareIntent.text, webUrl: shareIntent.webUrl, title: shareIntent.meta?.title }, images)
        if (!input) {
          toast({ message: 'There was nothing in that share Cairn could keep', tone: 'error' })
          return
        }
        const note = await actions.addNote(input)
        if (note) latest.current(note)
      } finally {
        resetShareIntent()
        working.current = false
      }
    })()
  }, [hasShareIntent, shareIntent, resetShareIntent, actions, toast])
}
