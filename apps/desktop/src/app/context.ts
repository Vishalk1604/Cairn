import type { NoteRepository, ReminderRepository, Want, WorkerClient } from '@cairn/sync'
import { createContext, useContext } from 'react'
import type { DesktopPlatform } from '../platform'
import type { AuthState } from './CairnProvider'

export interface Cairn {
  platform: DesktopPlatform
  /** Cairn's Worker, which holds the Google accounts and reads them. */
  worker: WorkerClient
  /** `local` until signed in, then the Firebase uid. */
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
  auth: AuthState
  /** The Google account signed in with, which holds the notes. */
  email: string | null
  /** The one sign-in this computer has: the account the phone set Cairn up with. */
  signIn(): Promise<void>
  /** Signs this computer out. The Worker and the phone carry on. */
  signOut(): Promise<void>
  /**
   * Asks Google, in the browser, for one more permission for an account the
   * phone connected — Classroom files, the one thing only this computer uses.
   */
  grant(email: string, want: readonly Want[]): Promise<void>
  /** Notes and tasks reaching the cloud. */
  sync: { busy: boolean; at: number | null; run(): Promise<void> }
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnProvider')
  return cairn
}
