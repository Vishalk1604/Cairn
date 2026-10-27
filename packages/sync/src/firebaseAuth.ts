import {
  GoogleAuthProvider,
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type Auth,
  type Persistence,
  type User,
} from 'firebase/auth'
import { cairnApp } from './firebaseApp'

/**
 * Firestore's rules key on a Firebase user, so the Google ID token that
 * Cairn's Worker hands back after a sign-in is traded here for a Firebase
 * session. Firebase keeps that session on the device and renews it itself;
 * the Google grant behind it stays with the Worker.
 */
let auth: Auth | null = null

export function cairnAuth(): Auth {
  return (auth ??= getAuth(cairnApp()))
}

/**
 * Sets where the session is kept, before anything signs in. A browser keeps
 * it on its own; React Native needs to be handed its storage, or every
 * launch would start signed out.
 */
export function initCairnAuth(persistence: Persistence): Auth {
  if (!auth) {
    try {
      auth = initializeAuth(cairnApp(), { persistence })
    } catch {
      // Already set up, e.g. after a hot reload.
      auth = getAuth(cairnApp())
    }
  }
  return auth
}

/** The signed-in user's ID token, for the Worker; null signed out. */
export async function currentIdToken(): Promise<string | null> {
  return (await cairnAuth().currentUser?.getIdToken()) ?? null
}

/** Returns the Firebase uid that Firestore paths and rules use. */
export async function signInToFirebase(googleIdToken: string): Promise<string> {
  const credential = GoogleAuthProvider.credential(googleIdToken)
  const result = await signInWithCredential(cairnAuth(), credential)
  return result.user.uid
}

export async function signOutOfFirebase(): Promise<void> {
  await signOut(cairnAuth())
}

/** The current user, once Firebase has finished restoring any saved session. */
export function currentUser(): Promise<User | null> {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(cairnAuth(), (user) => {
      stop()
      resolve(user)
    })
  })
}
