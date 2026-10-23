import type { Attachment } from './model'

/** The extension each kind of file is saved with, on every device. */
const EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/gif': 'gif',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
}

/**
 * What an attachment's file is called on disk. Worked out from the record
 * rather than stored in it, since the record syncs everywhere and a path is
 * only ever true on the device that wrote it.
 */
export function attachmentFileName(a: Pick<Attachment, 'id' | 'mime'>): string {
  return `${a.id}.${EXTENSION[a.mime] ?? 'bin'}`
}
