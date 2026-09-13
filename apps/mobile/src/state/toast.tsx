import type { Toast } from '@cairn/ui'
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../theme'

const ToastContext = createContext<(toast: Toast) => void>(() => {})

export function useToast(): (toast: Toast) => void {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null)
  const show = useCallback((input: Toast) => setToast({ ...input, id: Date.now() }), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 8000 : 6000)
    return () => clearTimeout(timer)
  }, [toast])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <View
          style={[styles.toast, toast.tone === 'error' && styles.error]}
          accessibilityRole={toast.tone === 'error' ? 'alert' : 'text'}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.text}>{toast.message}</Text>
          {toast.action && (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                toast.action!.run()
                setToast(null)
              }}
            >
              <Text style={styles.action}>{toast.action.label}</Text>
            </Pressable>
          )}
        </View>
      )}
    </ToastContext.Provider>
  )
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 8,
    backgroundColor: colors.fg,
  },
  error: { backgroundColor: colors.danger },
  text: { flex: 1, color: colors.bg },
  action: { color: colors.bg, fontWeight: '700' },
})
