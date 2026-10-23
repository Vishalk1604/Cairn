import { usePreferences } from './preferences'

export {
  ALL_FOLDER,
  deleteFolder,
  folderTag,
  foldersOf,
  isRealFolder,
  moveToFolder,
  notesInFolder,
  renameFolder,
  UNCATEGORISED,
  type Folder,
} from '@cairn/ui'

/** Which folders sit first; synced with the rest of the preferences. */
export function usePinnedFolders() {
  const { preferences, togglePinned } = usePreferences()
  return { pinned: preferences.pinnedFolders, toggle: togglePinned }
}
