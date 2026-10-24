import type { ClassroomFile, Course, DriveFileInfo } from '@cairn/sync'

/** Google's own formats have no file to download; each is saved as an export instead. */
const EXPORTS: Record<string, { mime: string; extension: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/pdf', extension: 'pdf' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', extension: 'pdf' },
  'application/vnd.google-apps.drawing': { mime: 'application/pdf', extension: 'pdf' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' },
}

/** For a file whose name has lost its extension, so Windows still knows what opens it. */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.ms-excel': 'xls',
  'text/plain': 'txt',
  'application/zip': 'zip',
}

/** A lecture recording can run to gigabytes; anything past this is left in Classroom. */
export const CLASSROOM_FILE_LIMIT = 100 * 1024 * 1024

export interface ClassroomFileRecord {
  /** The Classroom course it came from. */
  course?: string
  /** Where it was saved, relative to the Classroom folder. Absent when it was left out. */
  path?: string
  /** Why it was left out, for good. */
  skipped?: string
  at: number
}

/** What the desktop remembers about Classroom files. */
export interface ClassroomFilesState {
  /** Empty means the default folder. */
  folder: string
  /**
   * The courses whose files are saved, by Classroom id. None to begin with,
   * so switching this on never pulls down every class at once.
   */
  courses: string[]
  /** By Drive file id, so each file is fetched once even if it is attached twice. */
  files: Record<string, ClassroomFileRecord>
}

export function readClassroomFilesState(raw: string | null): ClassroomFilesState {
  try {
    const value = JSON.parse(raw ?? '') as Partial<ClassroomFilesState>
    return {
      folder: typeof value.folder === 'string' ? value.folder : '',
      courses: Array.isArray(value.courses) ? value.courses.filter((c): c is string => typeof c === 'string') : [],
      files: value.files && typeof value.files === 'object' ? value.files : {},
    }
  } catch {
    return { folder: '', courses: [], files: {} }
  }
}

/** Files of the chosen courses not handled yet, each once. */
export function newClassroomFiles(found: readonly ClassroomFile[], state: Pick<ClassroomFilesState, 'files' | 'courses'>): ClassroomFile[] {
  const seen = new Set<string>()
  return found.filter((f) => {
    if (!state.courses.includes(f.course.id) || state.files[f.file.id] || seen.has(f.file.id)) return false
    seen.add(f.file.id)
    return true
  })
}

/** Newest class first: this semester's above last year's. */
export function recentCoursesFirst<T extends Pick<Course, 'name' | 'creationTime' | 'updateTime'>>(courses: readonly T[]): T[] {
  const when = (c: T) => Date.parse(c.creationTime ?? '') || Date.parse(c.updateTime ?? '') || 0
  return [...courses].sort((a, b) => when(b) - when(a) || a.name.localeCompare(b.name))
}

/**
 * A name Windows accepts: no characters it reserves, no device names such
 * as CON or NUL, no trailing dot or space, and not too long for a path.
 */
export function safeFileName(name: string, limit = 120): string {
  let clean = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ (?=\.[A-Za-z0-9]{1,5}$)/, '')
    .trim()
    .replace(/[. ]+$/, '')
  if (!clean) clean = 'Untitled'
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean)) clean = `_${clean}`
  if (clean.length <= limit) return clean
  // Shortened from the middle, so the extension survives.
  const dot = clean.lastIndexOf('.')
  const extension = dot > 0 && clean.length - dot <= 6 ? clean.slice(dot) : ''
  return `${clean.slice(0, limit - extension.length).trim()}${extension}`
}

function withExtension(name: string, extension: string | undefined): string {
  if (!extension || name.toLowerCase().endsWith(`.${extension}`)) return name
  return `${name}.${extension}`
}

/** How a file is downloaded — as itself, or exported — or why it is left out. */
export function classroomDownload(info: DriveFileInfo, limit = CLASSROOM_FILE_LIMIT): { name: string; exportAs?: string } | { skip: string } {
  if (!info.canDownload) return { skip: 'The teacher turned off downloading for it' }
  const exported = EXPORTS[info.mimeType]
  if (info.mimeType.startsWith('application/vnd.google-apps.') && !exported) return { skip: 'A form, folder or site, not a file' }
  if (info.size !== undefined && info.size > limit) return { skip: `Larger than ${Math.round(limit / 1024 / 1024)} MB` }
  const name = withExtension(safeFileName(info.name), exported?.extension ?? EXTENSIONS[info.mimeType])
  return exported ? { name, exportAs: exported.mime } : { name }
}

/** A folder per course, so a semester's files sort themselves. */
export function classroomFilePath(course: string, name: string): string {
  return `${safeFileName(course, 80)}/${name}`
}
