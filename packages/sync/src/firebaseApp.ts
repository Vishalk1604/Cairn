import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, initializeFirestore, type Firestore, type FirestoreSettings } from 'firebase/firestore'

/**
 * The Firebase web configuration.
 *
 * This is not a secret and is meant to ship inside clients: it identifies the
 * project, it does not grant anything. What stops one person reading another's
 * data is `firestore.rules`, which is tested in `test/rules.test.ts`. Google
 * documents these values as safe to include in client code, which is just as
 * well — they are readable inside any APK or executable anyway.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyB9nlEDRBczbRqubUap02jwD2YEbAYluuE',
  authDomain: 'cairn-vishalk.firebaseapp.com',
  projectId: 'cairn-vishalk',
  storageBucket: 'cairn-vishalk.firebasestorage.app',
  messagingSenderId: '1093942418184',
  appId: '1:1093942418184:web:506b66cd4ffac923f9eabd',
} as const

const APP_NAME = 'cairn'

/** The one Firebase app, created on first use. */
export function cairnApp(): FirebaseApp {
  return getApps().some((app) => app.name === APP_NAME) ? getApp(APP_NAME) : initializeApp(firebaseConfig, APP_NAME)
}

/**
 * Firestore for this app. Each platform passes the cache it can actually
 * support — the desktop web view has IndexedDB and can keep a durable cache,
 * so it is given one; others fall back to whatever the SDK defaults to.
 */
export function cairnFirestore(settings?: FirestoreSettings): Firestore {
  const app = cairnApp()
  if (!settings) return getFirestore(app)
  try {
    return initializeFirestore(app, settings)
  } catch {
    // Already initialized, e.g. after a hot reload.
    return getFirestore(app)
  }
}
