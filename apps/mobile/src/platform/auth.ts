import AsyncStorage from '@react-native-async-storage/async-storage'
import { initCairnAuth } from '@cairn/sync'
import * as FirebaseAuth from 'firebase/auth'

/**
 * Keeps the Firebase session across launches. The phone holds no Google
 * refresh token any more — Cairn's Worker does — so this session is what
 * keeps it signed in. React Native has no browser storage for Firebase to
 * use on its own, so it is handed AsyncStorage.
 *
 * getReactNativePersistence is in the React Native build of firebase/auth,
 * which Metro picks; the type library describes the browser build. In the
 * web build for development it is absent and the browser's own is used.
 *
 * Imported for its effect, before anything signs in.
 */
const { getReactNativePersistence } = FirebaseAuth as unknown as {
  getReactNativePersistence?: (storage: typeof AsyncStorage) => FirebaseAuth.Persistence
}
if (getReactNativePersistence) initCairnAuth(getReactNativePersistence(AsyncStorage))
