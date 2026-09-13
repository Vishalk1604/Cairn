import { useEffect, useRef, type KeyboardEvent } from 'react'

/**
 * Opens a <dialog> as a modal on mount and calls onClose exactly once, however
 * it closes. Chromium delivers the native close event on a rendering frame,
 * which never comes while the window isn't drawing (hidden, minimized), so
 * closes we initiate call onClose directly; the event covers the rest.
 */
export function useModal(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null)
  const latest = useRef(onClose)
  latest.current = onClose
  const finished = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    latest.current()
  }

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    // finish only reads refs, so binding it once is safe.
    dialog.addEventListener('close', finish)
    return () => dialog.removeEventListener('close', finish)
  }, [])

  const close = () => {
    ref.current?.close()
    finish()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  return { ref, close, onKeyDown }
}
