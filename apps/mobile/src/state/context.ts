import { openLocalRepositories, type NoteRepository, type ReminderRepository } from '@cairn/sync'
import { createContext, useContext } from 'react'
import { storage } from '../platform/storage'

/** Until Google sign-in lands, everything belongs to this device's local user. */
export const LOCAL_USER = 'local'

export interface Cairn {
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
}

export async function openCairn(): Promise<Cairn> {
  const { reminders, notes } = await openLocalRepositories(storage, {
    onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
  })
  const now = Date.now()
  await Promise.all([reminders.purgeTombstones(now), notes.purgeTombstones(now)])
  return { userId: LOCAL_USER, reminders, notes }
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnContext provider')
  return cairn
}
