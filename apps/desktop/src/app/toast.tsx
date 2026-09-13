import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export interface ToastInput {
  message: string
  action?: { label: string; run: () => void }
  tone?: 'info' | 'error'
}

interface Toast extends ToastInput {
  id: number
}

const ToastContext = createContext<(toast: ToastInput) => void>(() => {})

export function useToast(): (toast: ToastInput) => void {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const show = useCallback((input: ToastInput) => setToast({ ...input, id: Date.now() }), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 8000 : 6000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.tone ?? 'info'}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          <span>{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              onClick={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
            ✕
          </button>
        </div>
      )}
    </ToastContext.Provider>
  )
}
