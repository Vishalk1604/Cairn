import type { NoteRepository, ReminderRepository } from '@cairn/sync'
import type { Account, SourceFeatures } from '@cairn/ui'
import { createContext, useContext } from 'react'
import type { DesktopPlatform } from '../platform'
import type { AuthState } from './CairnProvider'

export interface Cairn {
  platform: DesktopPlatform
  /** `local` until an account is connected, then the Firebase uid. */
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
  auth: AuthState
  /** The owner account, if any, followed by whatever is connected for reading. */
  accounts: Account[]
  /** Connects the account that will hold the data. */
  signIn(): Promise<void>
  /** Forgets every account and goes back to this machine only. */
  signOut(): Promise<void>
  /** Adds another account to read Gmail or Classroom from. */
  connectSource(features: SourceFeatures): Promise<void>
  /** Asks an account already connected for one more permission. */
  regrant(account: Account, features: SourceFeatures): Promise<void>
  disconnectSource(sub: string): Promise<void>
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnProvider')
  return cairn
}
