/**
 * What Cairn asks Google for, by feature. The asking itself is done by
 * Cairn's Worker (apps/worker), the one OAuth client that holds a grant: the
 * apps say which groups they want, and the Worker turns them into scopes.
 */

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
  /** When Gmail is chosen, on the phone. Restricted. */
  mail: ['https://www.googleapis.com/auth/gmail.readonly'],
  /**
   * When Classroom is chosen, on the phone. Sensitive.
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
   * When Classroom files are turned on, on the desktop. Restricted.
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
