import { createReminder, DAY, HOUR, MINUTE, type InboxRecord } from '@cairn/core'
import type { AccountsDoc, InboxSettings, NoteRepository, ReaderDoc, ReminderRepository, SettingName } from '@cairn/sync'
import type { CourseSettings, InboxBackend, InboxHost } from '@cairn/ui'
import type { Preview } from './app/CairnProvider'
import type { DesktopPlatform } from './platform'
import { webPlatform } from './platform/web'

/**
 * A stand-in for development in a browser, at localhost:1420/?preview: signed
 * in as nobody in particular, with an inbox, accounts and a last check made
 * up here, so the signed-in screens can be looked at without Google or
 * Firebase. Only ever loaded by the dev server; a build leaves it out.
 */

const now = Date.now()
const ME = 'you@gmail.com'
const COLLEGE = 'you@college.edu'

const records: InboxRecord[] = [
  {
    id: 'm1',
    account: ME,
    from: 'HackMIT <team@hackmit.org>',
    subject: 'Registration for HackMIT closes Friday',
    snippet: 'Teams of up to four. Register by Friday 11:59 pm.',
    receivedAt: now - 40 * MINUTE,
    reading: { kind: 'deadline', title: 'Registration for HackMIT closes Friday', allDay: false },
    triage: {
      important: true,
      folder: 'Hackathons',
      tags: ['hackathon', 'hackmit'],
      summary: 'Register your team for HackMIT by Friday night.',
      why: 'A hackathon you follow',
      task: { title: 'Register for HackMIT', dueAt: now + 3 * DAY, allDay: false },
    },
    foundAt: now - 38 * MINUTE,
    updatedAt: now - 30 * MINUTE,
  },
  {
    id: 'm2',
    account: COLLEGE,
    from: 'Placement Cell <placements@college.edu>',
    subject: 'Google internship: online test on Monday',
    snippet: 'Shortlisted students take the online test on Monday at 10 am.',
    receivedAt: now - 3 * HOUR,
    reading: { kind: 'other', title: 'Google internship', allDay: false },
    triage: { important: true, folder: 'Internships', tags: ['internship', 'google'], summary: 'The Google internship test is on Monday at 10 am.', why: 'An internship test' },
    foundAt: now - 3 * HOUR,
    updatedAt: now - 3 * HOUR,
  },
  {
    id: 'm3',
    account: ME,
    from: 'The Weekly <news@weekly.example>',
    subject: 'Your weekly digest',
    snippet: 'Ten stories you might have missed.',
    receivedAt: now - 5 * HOUR,
    reading: { kind: 'other', title: 'Your weekly digest', allDay: false },
    triage: { important: false, tags: ['newsletter'], summary: 'A newsletter with nothing to do.' },
    foundAt: now - 5 * HOUR,
    updatedAt: now - 5 * HOUR,
  },
  {
    id: 'classroom-work-w1',
    account: COLLEGE,
    from: 'CS301 DBMS',
    subject: 'Lab 4: normalisation',
    snippet: 'Normalise the schema from lab 3 to BCNF.',
    receivedAt: now - 2 * HOUR,
    classroom: { kind: 'work', courseId: 'c1', course: 'CS301 DBMS', workId: 'w1', due: { dueAt: now + 2 * DAY, allDay: true }, link: 'https://classroom.google.com' },
    reading: { kind: 'classroom', title: 'Lab 4: normalisation', allDay: true },
    tasked: true,
    foundAt: now - 2 * HOUR,
    updatedAt: now - 2 * HOUR,
  },
  {
    id: 'classroom-announcement-a1',
    account: COLLEGE,
    from: 'CS302 Networks',
    subject: 'Quiz moved to Thursday',
    snippet: 'The quiz on routing is now on Thursday in the usual room.',
    receivedAt: now - 6 * HOUR,
    classroom: { kind: 'announcement', courseId: 'c2', course: 'CS302 Networks', link: 'https://classroom.google.com' },
    reading: { kind: 'other', title: 'Quiz moved to Thursday', allDay: false },
    triage: { important: true, summary: 'The routing quiz moved to Thursday.' },
    foundAt: now - 6 * HOUR,
    updatedAt: now - 6 * HOUR,
  },
]

const settings: { accounts: AccountsDoc; reader: ReaderDoc; inbox: InboxSettings; courses: CourseSettings } = {
  accounts: {
    accounts: [
      { email: ME, role: 'owner', services: ['drive', 'mail'], watch: { mail: true, classroom: false } },
      { email: COLLEGE, role: 'source', services: ['mail', 'classroom', 'announcements'], watch: { mail: true, classroom: true } },
    ],
    ai: { on: true, preferred: 'GPT-OSS 20B' },
    updatedAt: now,
  },
  // ?preview=paused shows what the apps say when the Worker has stopped checking.
  reader: { checkedAt: now - (new URLSearchParams(location.search).get('preview') === 'paused' ? 47 : 4) * MINUTE, ai: { model: 'GPT-OSS 20B' } },
  inbox: { autoTasks: true, timeZone: 'Asia/Kolkata' },
  courses: { colors: { c2: 'pink' } },
}

function backend(): InboxBackend {
  const settingWatchers: (() => void)[] = []
  const inbox = new Map(records.map((r) => [r.id, r]))
  const watchers = new Set<(records: InboxRecord[]) => void>()
  return {
    watchInbox(_uid, onChange) {
      watchers.add(onChange)
      onChange([...inbox.values()])
      return () => watchers.delete(onChange)
    },
    async patchInbox(_uid, id, patch) {
      inbox.set(id, { ...inbox.get(id)!, ...patch })
      for (const w of watchers) w([...inbox.values()])
    },
    watchSetting<T>(_uid: string, name: SettingName, onChange: (value: T | null) => void) {
      onChange(settings[name] as T)
      settingWatchers.push(() => onChange(structuredClone(settings[name]) as T))
      return () => {}
    },
    async writeSetting(_uid, name, value) {
      const current = settings[name] as unknown as Record<string, unknown>
      // Merged a level deep, as Firestore merges a map.
      for (const [key, v] of Object.entries(value)) {
        current[key] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(current[key] as object), ...v } : v
      }
      for (const w of settingWatchers) w()
    },
  }
}

export const inboxHost: Partial<InboxHost> = {
  backend: backend(),
  worker: { sync: () => new Promise((resolve) => setTimeout(() => resolve({ checkedAt: Date.now(), found: 0 }), 1200)) },
}

export const user: Preview = {
  email: ME,
  async seed({ reminders }: { reminders: ReminderRepository; notes: NoteRepository }) {
    if ((await reminders.list()).length) return
    const at = (hours: number) => now + hours * HOUR
    await reminders.upsertMany([
      createReminder({ title: 'Submit lab 3 report', dueAt: at(-2), priority: 'high' }, { userId: 'local', now, id: 'preview-1' }),
      createReminder({ title: 'Read chapter 5 for the quiz', dueAt: at(5) }, { userId: 'local', now, id: 'preview-2' }),
      createReminder({ title: 'Register for HackMIT', dueAt: at(72), tags: ['hackathon'] }, { userId: 'local', now, id: 'preview-3' }),
      createReminder(
        { title: 'Lab 4: normalisation', dueAt: now + 2 * DAY, allDay: true, courseId: 'c1', source: 'classroom', sourceRef: 'w1', tags: ['classroom'] },
        { userId: 'local', now, id: 'classroom-w1' },
      ),
    ])
  },
}

/** The browser, with somewhere pretend to save class files, so the Classroom gear shows what it does. */
export const platform: DesktopPlatform = {
  ...webPlatform,
  classroom: {
    defaultFolder: async () => 'C:\\Users\\you\\Documents\\Cairn Classroom',
    pickFolder: async () => null,
    write: async (_folder, path) => path,
    open: async () => {},
  },
}
