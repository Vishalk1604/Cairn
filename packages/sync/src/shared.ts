import type { InboxRecord } from '@cairn/core'
import { collection, doc, onSnapshot, setDoc, updateDoc, waitForPendingWrites } from 'firebase/firestore'
import { cairnFirestore } from './firebaseApp'
import type { Unsubscribe } from './repository'

/**
 * What both apps share beyond notes and tasks: the inbox the Worker reads
 * for them, and a handful of small settings documents. Everything is filed
 * under the signed-in user, which is what the rules key on.
 *
 * The Worker writes the records; a device only ever changes what the person
 * did to one (opened it, hid it, made a task of it) and the settings they
 * chose. Firestore's free plan allows 20,000 writes a day across everyone,
 * so each of those is one small write.
 */

/** The small documents under users/{uid}/settings. */
export type SettingName = 'accounts' | 'reader' | 'inbox' | 'courses'

const inbox = (uid: string) => collection(cairnFirestore(), 'users', uid, 'inbox')
const setting = (uid: string, name: SettingName) => doc(cairnFirestore(), 'users', uid, 'settings', name)

/** Firestore refuses undefined anywhere in a document. */
function defined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(defined) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) if (v !== undefined) out[key] = defined(v)
    return out as T
  }
  return value
}

/** Every inbox record, now and whenever one changes. */
export function watchInbox(uid: string, onChange: (records: InboxRecord[]) => void, onError?: (error: unknown) => void): Unsubscribe {
  return onSnapshot(
    inbox(uid),
    (snapshot) => onChange(snapshot.docs.map((d) => d.data() as InboxRecord)),
    (error) => onError?.(error),
  )
}

/** Changes a few fields of one record: opened, hidden, made into a task. */
export async function patchInbox(uid: string, id: string, patch: Partial<Pick<InboxRecord, 'read' | 'dismissed' | 'tasked' | 'updatedAt'>>): Promise<void> {
  await updateDoc(doc(inbox(uid), id), defined(patch))
}

/** One settings document, now and whenever it changes; null while there is none. */
export function watchSetting<T>(uid: string, name: SettingName, onChange: (value: T | null) => void, onError?: (error: unknown) => void): Unsubscribe {
  return onSnapshot(
    setting(uid, name),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.data() as T) : null),
    (error) => onError?.(error),
  )
}

/** Merged into what is there, so two devices writing different fields do not undo each other. */
export async function writeSetting<T extends object>(uid: string, name: SettingName, value: T, options: { replace?: boolean } = {}): Promise<void> {
  await setDoc(setting(uid, name), defined(value), { merge: !options.replace })
}

/**
 * One field of the phone's preferences document, now and whenever it
 * changes — with undefined while there is no document at all, so a caller
 * waiting on it is never left waiting.
 */
export function watchPreference<T>(uid: string, field: string, onChange: (value: T | undefined) => void, onError?: (error: unknown) => void): Unsubscribe {
  return onSnapshot(
    doc(cairnFirestore(), 'users', uid, 'preferences', 'app'),
    (snapshot) => onChange(snapshot.exists() ? (snapshot.get(field) as T | undefined) : undefined),
    (error) => onError?.(error),
  )
}

/** Resolves once everything written on this device has reached the server. */
export async function settled(): Promise<void> {
  await waitForPendingWrites(cairnFirestore())
}
