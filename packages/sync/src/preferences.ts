import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { cairnFirestore } from './firebaseApp'
import type { Unsubscribe } from './repository'

/**
 * One small document of settings that should follow a person between
 * devices: which folders are pinned, how notes are laid out. It is a single
 * record rather than a collection, so it is settled by its own updatedAt.
 */
export interface SyncedPreferences {
  updatedAt: number
}

const ref = (uid: string) => doc(cairnFirestore(), 'users', uid, 'preferences', 'app')

export function watchPreferences<T extends SyncedPreferences>(
  uid: string,
  onChange: (value: T) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    ref(uid),
    (snapshot) => {
      if (snapshot.exists()) onChange(snapshot.data() as T)
    },
    (error) => onError?.(error),
  )
}

export function writePreferences<T extends SyncedPreferences>(uid: string, value: T): Promise<void> {
  return setDoc(ref(uid), value)
}
