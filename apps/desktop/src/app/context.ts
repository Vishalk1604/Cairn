import { openLocalRepositories, type NoteRepository, type ReminderRepository } from '@cairn/sync'
import { createContext, useContext } from 'react'
import type { Platform } from '../platform'

/** Until Google sign-in lands, everything belongs to this device's local user. */
export const LOCAL_USER = 'local'

export interface Cairn {
  platform: Platform
  userId: string
  reminders: ReminderRepository
  notes: NoteRepository
}

export async function openCairn(platform: Platform): Promise<Cairn> {
  const { reminders, notes } = await openLocalRepositories(platform.storage, {
    onError: (error) => console.error('Saved data could not be read; it was backed up and Cairn started fresh.', error),
  })
  const now = Date.now()
  await Promise.all([reminders.purgeTombstones(now), notes.purgeTombstones(now)])
  return { platform, userId: LOCAL_USER, reminders, notes }
}

export const CairnContext = createContext<Cairn | null>(null)

export function useCairn(): Cairn {
  const cairn = useContext(CairnContext)
  if (!cairn) throw new Error('useCairn needs a CairnContext provider')
  return cairn
}
