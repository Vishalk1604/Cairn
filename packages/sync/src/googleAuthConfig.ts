/**
 * Google OAuth clients for the Cairn project (`cairn-vishalk`).
 *
 * Client ids are public by design: they appear in every authorization URL and
 * are readable inside any shipped binary. The desktop client also has a
 * "secret", which Google does not treat as confidential for installed apps for
 * the same reason — so the flow uses PKCE and the secret stays out of this
 * repository entirely.
 */
export const GOOGLE_CLIENTS = {
  /** Loopback redirect, used by the Tauri app. */
  desktop: '1093942418184-q3jfnam9jrl8h9gnu03nfhr6svvc9297.apps.googleusercontent.com',
  /** Bound to the package name and signing certificate, used by the Android app. */
  android: '1093942418184-11u39gumovas9mmhau9flcm9q77n9mqf.apps.googleusercontent.com',
} as const

/**
 * Asked for in stages rather than all at once: signing in should not demand
 * your inbox. Each group is requested the first time you use the feature that
 * needs it, which is both better manners and a far better consent rate.
 */
export const GOOGLE_SCOPES = {
  /** At sign-in. */
  identity: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
  /** First time you attach an image or a recording. Non-sensitive: only files Cairn created. */
  media: ['https://www.googleapis.com/auth/drive.file'],
  /** First time you open the Notifications tab. Restricted. */
  mail: ['https://www.googleapis.com/auth/gmail.readonly'],
  /**
   * First time you turn on Classroom. Sensitive.
   *
   * Only what Cairn reads: courses, your own coursework with its
   * submission state, and announcements. The older student-submissions
   * scope is a synonym Google collapses into coursework.me — asking for both
   * meant the grant never contained both, so Classroom could never count as
   * switched on.
   */
  classroom: [
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly',
  ],
  /**
   * First time you turn on Classroom files on the desktop. Restricted.
   *
   * A file a teacher attaches lives in the teacher's Drive, not Cairn's, so
   * downloading it needs read access to Drive files shared with you; the
   * materials scope covers posts that are only a material, with no task.
   */
  classroomFiles: [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  ],
} as const

export type ScopeGroup = keyof typeof GOOGLE_SCOPES
