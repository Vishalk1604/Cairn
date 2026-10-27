import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useState } from 'react'
import { DESK_ACTION_EVENT, DESK_DATA_EVENT, type DeskAction, type DeskData } from './feed'
import { DeskView } from './DeskView'

const ask = (action: DeskAction) => void emitTo('main', DESK_ACTION_EVENT, action)

/**
 * The pinned window's whole app: no store, no sign-in, no cloud. It shows
 * what the main window sends and hands every click back to it.
 */
export function DeskWindow() {
  const [data, setData] = useState<DeskData | null>(null)
  useEffect(() => {
    let stop: (() => void) | undefined
    let cancelled = false
    void listen<DeskData>(DESK_DATA_EVENT, (event) => setData(event.payload)).then((unlisten) => {
      if (cancelled) unlisten()
      else {
        stop = unlisten
        ask({ kind: 'ready' })
      }
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])
  return (
    <DeskView
      data={data}
      onComplete={(id) => ask({ kind: 'complete', id })}
      onOpen={(id) => ask({ kind: 'open', ...(id ? { id } : {}) })}
      onDrag={() => void getCurrentWindow().startDragging()}
    />
  )
}
