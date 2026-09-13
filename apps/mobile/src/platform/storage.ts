import AsyncStorage from '@react-native-async-storage/async-storage'
import type { KeyValueStore } from '@cairn/sync'

/** On-device storage for the local repositories. Firestore's own cache takes over once sync lands. */
export const storage: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
}
