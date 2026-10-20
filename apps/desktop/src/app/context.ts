import type { NoteRepository, ReminderRepository } from '@cairn/sync'
import { createContext, useContext } from 'react'
import type { Platform } from '../platform'
import type { AuthState } from './CairnProvider'

export interface Cairn {
  platform: Platform
  /** `local` until an account is connected, then the Firebase uid. */
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
  auth: AuthState
  signIn(): Promise<void>
  signOut(): Promise<void>
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnProvider')
  return cairn
}
