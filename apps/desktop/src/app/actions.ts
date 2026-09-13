import { createActions, type Actions } from '@cairn/ui'
import { useMemo } from 'react'
import { useCairn } from './context'
import { useToast } from './toast'

export type { Actions }

export function useActions(): Actions {
  const { reminders, notes, userId } = useCairn()
  const toast = useToast()
  return useMemo(() => createActions({ reminders, notes, userId, toast }), [reminders, notes, userId, toast])
}
