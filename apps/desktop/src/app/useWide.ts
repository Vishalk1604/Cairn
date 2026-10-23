import { useSyncExternalStore } from 'react'

/**
 * Wide enough for the full app: a sidebar beside the content. Narrower is
 * the desktop widget. Read from the window's width rather than from which
 * mode was asked for, so dragging the widget wider works the same way.
 */
const WIDE = '(min-width: 860px)'

const query = () => window.matchMedia(WIDE)

function subscribe(onChange: () => void): () => void {
  const list = query()
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, () => query().matches)
}
