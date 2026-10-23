import { attachmentFileName, uuidv7, type Attachment } from '@cairn/core'
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio'
import { Directory, File, Paths } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'


function folder(): Directory {
  const dir = new Directory(Paths.document, 'attachments')
  if (!dir.exists) dir.create({ idempotent: true, intermediates: true })
  return dir
}

/**
 * Where this phone keeps an attachment. Worked out from the id rather than
 * stored, because the attachment record syncs to other devices and a path is
 * only ever true on the one that wrote it.
 */
export function attachmentFile(a: Pick<Attachment, 'id' | 'mime'>): File {
  return new File(folder(), attachmentFileName(a))
}

export function hasLocalCopy(a: Pick<Attachment, 'id' | 'mime'>): boolean {
  return attachmentFile(a).exists
}

/**
 * Lets the person choose a photo and keeps a copy of it. The picker's own
 * file lives in a cache Android may clear at any time, so it is copied out
 * at once rather than referenced.
 */
export async function pickImage(source: 'library' | 'camera' = 'library'): Promise<Attachment | null> {
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.85, exif: false }
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync()
    if (!permission.granted) throw new Error('Cairn needs the camera to take a photo. You can allow it in Settings.')
  }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? undefined : result.assets[0]
  if (!asset) return null

  const now = Date.now()
  const mime = asset.mimeType ?? 'image/jpeg'
  const attachment: Attachment = { id: uuidv7(now), kind: 'image', mime, width: asset.width, height: asset.height, createdAt: now }
  const target = attachmentFile(attachment)
  await new File(asset.uri).copy(target)
  return { ...attachment, bytes: target.size }
}

/** Asks for the microphone, once, at the moment it is first wanted. */
export async function prepareToRecord(): Promise<void> {
  const permission = await requestRecordingPermissionsAsync()
  if (!permission.granted) throw new Error('Cairn needs the microphone to record. You can allow it in Settings.')
  await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
}

/** Moves a finished recording in with the other attachments. */
export async function keepRecording(uri: string, durationMs: number): Promise<Attachment> {
  await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true })
  const now = Date.now()
  const attachment: Attachment = { id: uuidv7(now), kind: 'audio', mime: 'audio/mp4', durationMs: Math.round(durationMs), createdAt: now }
  const target = attachmentFile(attachment)
  await new File(uri).move(target)
  return { ...attachment, bytes: target.size }
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
