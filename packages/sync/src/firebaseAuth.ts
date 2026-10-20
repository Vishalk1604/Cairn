import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'
import { cairnApp } from './firebaseApp'

/**
 * Firestore's rules key on a Firebase user, not on a Google token, so the
 * Google ID token from our own OAuth flow is traded for a Firebase session.
 *
 * Firebase's own Google provider would sign the user in too, but it hands
 * back no refreshable Google token — fine for a login button, useless for an
 * app that has to read Gmail in the background. Running the OAuth flow
 * ourselves and exchanging the result here gets both from one consent.
 */
export function cairnAuth(): Auth {
  return getAuth(cairnApp())
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
