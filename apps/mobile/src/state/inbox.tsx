import {
  classroomDueAt,
  classroomTaskId,
  completeReminder,
  createReminder,
  DAY,
  DEFAULT_PROFILE,
  inboxTaskId,
  PROFILE_LIMIT,
  readMail,
  senderAddress,
  TRIAGE_BODY_LIMIT,
  updateReminder,
  type MailMessage,
  type MailReading,
  type MailTriage,
  type Reminder,
} from '@cairn/core'
import {
  AiError,
  announcementMessage,
  classroomFeed,
  courseWorkMessage,
  GoogleApiError,
  mailCursor,
  MailCursorExpired,
  mailSince,
  modelsFor,
  storedAiSetup,
  triageMail,
  type AiSetup,
  type ClassroomItem,
} from '@cairn/sync'
import { accessTokenFor, featuresOf, readsAnnouncements, type Account } from '@cairn/ui'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { storage } from '../platform/storage'
import { useCairn } from './context'
import { usePreferences, type Feature } from './preferences'

const CURSORS_KEY = 'cairn.inbox.cursors'
const FOUND_KEY = 'cairn.inbox.found'
const DISMISSED_KEY = 'cairn.inbox.dismissed'
const SENDERS_KEY = 'cairn.inbox.senders'
const SEEN_KEY = 'cairn.inbox.seenAt'
const PROFILE_KEY = 'cairn.inbox.profile'
/** Where the NVIDIA key lives in secure storage. */
const AI_SECRET = 'ai.nvidia'
/** How often to look while the app is open. With nothing new, a look costs one cheap request. */
const POLL_MS = 5 * 60 * 1000
/** Automatic looks are never closer together than this; a pull to refresh is. */
const MIN_GAP_MS = 60 * 1000
/** After Google says slow down. */
const BACKOFF_MS = 3 * 60 * 1000
const KEEP_FOUND = 200
/**
 * Emails read by the model at once. Most of each request is spent waiting in
 * NVIDIA's queue, so a few at a time finish far sooner than one by one, and
 * stay well inside the free tier's 40 requests a minute.
 */
const AI_AT_ONCE = 4
/** Mail the model could not read is tried again on later looks, for this long… */
const RETRY_FOR_MS = 3 * DAY
/** …a few at a time, so a backlog never crowds out new mail. */
const RETRY_AT_ONCE = 6
/** Classroom posts remembered as already taken in, per account. */
const KEEP_SEEN = 400

/** Where reading left off, per account. Absent means "start from now" on the next look. */
interface Cursor {
  /** Gmail historyId. */
  mail?: string
  /** When Classroom was switched on: posts from before then are not news. */
  classroomSince?: number
  /**
   * Classroom posts already taken in. Kept by id rather than by time, because
   * a scheduled post appears long after it was written.
   */
  classroomSeen?: string[]
}

/** What the person has said about a sender: their mail always or never belongs in Important. */
type SenderRule = 'important' | 'unimportant'

export interface InboxEntry {
  /** Stored without its full text once read: the summary and Gmail itself are there for reading. */
  message: MailMessage
  /** The plain rules' reading, used when there is no model or it could not answer. */
  reading: MailReading
  /** The model's reading, when one was made. */
  triage?: MailTriage
  /** Set when the person moved it in or out of Important by hand. */
  marked?: SenderRule
  /** When Cairn found it, for the unseen count. */
  foundAt: number
}

export interface AiStatus {
  /** Whether a key is saved. */
  on: boolean
  /** The model asked first: the one the pasted code was for, or GPT-OSS. */
  preferred?: string
  /** The model that answered last. */
  model?: string
  /** The last thing that went wrong, until something works again. */
  error?: string
}

interface Inbox {
  /** Mail and Classroom posts found since reading was switched on, newest first. */
  found: InboxEntry[]
  /** Folders the model has filed mail into, in the order they first appeared. */
  folders: string[]
  /** Accounts with Gmail or Classroom switched on. */
  readable: Account[]
  refreshing: boolean
  error: string | null
  lastRun: number | null
  dismissed: Set<string>
  /** Important mail found since the Inbox was last opened. */
  unseen: number
  ai: AiStatus
  /** What matters to the person, in their words; sent with every message the model reads. */
  profile: string
  refresh(manual?: boolean): Promise<void>
  /** Called when a feature is switched on, so reading starts from that moment. */
  startFresh(account: string, feature: Feature): Promise<void>
  addAsTask(entry: InboxEntry): Promise<void>
  dismiss(entry: InboxEntry): void
  /** Moves an email in or out of Important, and remembers the choice for its sender. */
  mark(entry: InboxEntry, rule: SenderRule): void
  markSeen(): void
  /** Saves (or with null, forgets) the NVIDIA key and the model it was pasted for. */
  setAiSetup(setup: AiSetup | null): Promise<void>
  /** Saves what matters to the person; empty goes back to the default. */
  setProfile(profile: string): void
}

const Context = createContext<Inbox | null>(null)

async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.get(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    // A damaged record costs only a fresh start, never a crash.
    return fallback
  }
}

/** Whether Gmail or Classroom is switched on for an account: granted by Google, and not paused here. */
export function readingOn(account: Account, feature: Feature, paused: Record<Feature, string[]>): boolean {
  return featuresOf(account)[feature] && !(paused[feature] ?? []).includes(account.identity.sub)
}

/** Whether an email belongs in Important: the person's word first, then the model's, then the rules'. */
export function isImportant(entry: InboxEntry): boolean {
  if (entry.marked) return entry.marked === 'important'
  if (entry.triage) return entry.triage.important
  return entry.reading.kind !== 'other'
}

/**
 * The deadline or start time a message offers: Classroom's own due date when
 * it has one, then the model's reading, then the rules'.
 */
export function dueOf(entry: InboxEntry): { title: string; dueAt: number; allDay: boolean } | undefined {
  const post = entry.message.classroom
  if (post?.due) return { title: entry.triage?.task?.title ?? entry.message.subject, ...post.due }
  if (entry.triage?.task) return entry.triage.task
  if (entry.reading.dueAt !== undefined) return { title: entry.reading.title || entry.message.subject, dueAt: entry.reading.dueAt, allDay: entry.reading.allDay }
  return undefined
}

/** The tags a task made from this message carries: the model's, else its folder, else where it came from. */
export function tagsOf(entry: InboxEntry): string[] {
  if (entry.triage?.tags?.length) return entry.triage.tags
  if (entry.triage?.folder) return [entry.triage.folder.toLowerCase().replace(/\s+/g, '-')]
  return entry.message.classroom ? ['classroom'] : []
}

/** Folders in the order they first turned up, oldest first, so chips do not reshuffle. */
function foldersOf(entries: readonly InboxEntry[]): string[] {
  const seen = new Map<string, number>()
  for (const e of entries) {
    const folder = e.triage?.folder
    if (folder) seen.set(folder, Math.min(seen.get(folder) ?? Infinity, e.foundAt))
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name)
}

/** Runs at most `limit` at a time, in order. */
async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await run(items[next++]!)
    }),
  )
}

function timeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/**
 * Kept small on disk: once the model has read it, the body was for reading
 * once, not for keeping. Until then a recent one keeps its text, so it can be
 * read again when the model was too busy to answer.
 */
function stored(entry: InboxEntry): InboxEntry {
  const { text, ...message } = entry.message
  if (text && !entry.triage && Date.now() - entry.foundAt < RETRY_FOR_MS) return { ...entry, message: { ...message, text: text.slice(0, TRIAGE_BODY_LIMIT) } }
  return { ...entry, message }
}

/**
 * Watches mail and Classroom from the moment each is switched on — never the
 * backlog — and keeps Classroom tasks in step with Classroom.
 *
 * With an AI key, every new email, assignment and announcement is read whole
 * by a language model, against what the person says matters to them, and
 * sorted: important or not, which folder (Hackathons, Jobs… whatever groups
 * the mail actually falls into), which tags, and whether it asks for
 * something by a date or sets a time. Without one, plain rules pick out
 * deadlines. Either way a date is only ever offered as a task: adding it is
 * the person's tap.
 */
export function InboxProvider({ children }: { children: ReactNode }) {
  const { accounts, platform, reminders, userId } = useCairn()
  const { preferences } = usePreferences()
  const [found, setFound] = useState<InboxEntry[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [senders, setSenders] = useState<Record<string, SenderRule>>({})
  const [seenAt, setSeenAt] = useState(0)
  const [profile, setProfileState] = useState(DEFAULT_PROFILE)
  const [aiSetup, setAiSetupState] = useState<AiSetup | null>(null)
  const [ai, setAi] = useState<Omit<AiStatus, 'on'>>({})
  const busy = useRef(false)
  const lastAttempt = useRef(0)
  const holdUntil = useRef(0)
  const foundRef = useRef(found)
  foundRef.current = found
  const dismissedRef = useRef(dismissed)
  dismissedRef.current = dismissed

  const readable = useMemo(
    () => accounts.filter((a) => readingOn(a, 'mail', preferences.paused) || readingOn(a, 'classroom', preferences.paused)),
    [accounts, preferences.paused],
  )

  useEffect(() => {
    void (async () => {
      const saved = await load<InboxEntry[]>(FOUND_KEY, [])
      // Entries saved before mail was sorted had no time found and kept their text.
      setFound(saved.map((e) => stored({ ...e, foundAt: e.foundAt ?? e.message.receivedAt })))
      const ids = await load<unknown>(DISMISSED_KEY, [])
      if (Array.isArray(ids)) setDismissed(new Set(ids.filter((id): id is string => typeof id === 'string')))
      setSenders(await load<Record<string, SenderRule>>(SENDERS_KEY, {}))
      setSeenAt(await load<number>(SEEN_KEY, 0))
      setProfileState((await storage.get(PROFILE_KEY).catch(() => null)) || DEFAULT_PROFILE)
      setAiSetupState(storedAiSetup(await platform.secrets.get(AI_SECRET).catch(() => null)))
    })()
  }, [platform])

  const save = useCallback((next: InboxEntry[]) => {
    void storage.set(FOUND_KEY, JSON.stringify(next.map(stored)))
  }, [])

  /**
   * Keeps tasks already made from Classroom in step with it: completed once
   * the work is handed in, moved when the teacher moves the deadline. New
   * work is never added unasked; it waits in the Inbox for a tap.
   */
  const applyClassroom = useCallback(
    async (items: ClassroomItem[]) => {
      const now = Date.now()
      const writes: Reminder[] = []
      for (const { work, submitted } of items) {
        const existing = await reminders.get(classroomTaskId(work.id))
        if (!existing || existing.deletedAt !== undefined || existing.status === 'done') continue
        const due = classroomDueAt(work)
        if (submitted && existing.autoCompleteOn === 'classroom-submission') {
          writes.push(completeReminder(existing, now))
        } else if (due && (existing.title !== work.title || existing.dueAt !== due.dueAt)) {
          writes.push(updateReminder(existing, { title: work.title, dueAt: due.dueAt, allDay: due.allDay }, now))
        }
      }
      if (writes.length) await reminders.upsertMany(writes)
    },
    [reminders],
  )

  /**
   * Has the model read each message, a few at a time. A sender the person
   * has ruled on is not sent at all. When the model cannot be reached, the
   * message keeps the rules' reading and is tried again on a later look —
   * nothing is lost, it is just sorted later.
   */
  const sortWithAi = useCallback(
    async (setup: AiSetup, entries: InboxEntry[]) => {
      const folders = foldersOf(foundRef.current)
      let failure: string | undefined
      let model: string | undefined
      let stop = false
      await eachLimit(entries, AI_AT_ONCE, async (entry) => {
        if (stop || senders[senderAddress(entry.message.from)]) return
        try {
          const triage = await triageMail(setup, entry.message, { now: Date.now(), folders, timeZone: timeZone(), profile })
          if (!triage) return
          entry.triage = triage
          model = triage.model
          // Later emails in this batch should reuse a folder an earlier one made.
          if (triage.folder && !folders.includes(triage.folder)) folders.push(triage.folder)
        } catch (e) {
          failure = e instanceof Error ? e.message : String(e)
          // A wrong key or a long silence will not improve within this batch.
          if (e instanceof AiError && (e.badKey || e.rateLimited)) stop = true
        }
      })
      // Any answer at all means it works; a failure only stands when nothing answered.
      if (model) setAi({ model })
      else if (failure) setAi((current) => ({ ...current, error: failure }))
    },
    [senders, profile],
  )

  /**
   * Adds newly read mail to the list, or updates mail already shown with
   * what the model made of it. A choice made on an email while the model
   * was still reading it is kept.
   */
  const addFound = useCallback(
    (entries: InboxEntry[]) => {
      if (!entries.length) return
      setFound((current) => {
        const byId = new Map(entries.map((e) => [e.message.id, e]))
        const updated = current.map((e) => {
          const fresh = byId.get(e.message.id)
          if (!fresh) return e
          byId.delete(e.message.id)
          return { ...stored(fresh), marked: e.marked ?? fresh.marked, foundAt: e.foundAt }
        })
        const next = [...[...byId.values()].map(stored), ...updated]
          .sort((a, b) => b.message.receivedAt - a.message.receivedAt)
          .slice(0, KEEP_FOUND)
        save(next)
        return next
      })
    },
    [save],
  )

  const refresh = useCallback(
    async (manual = false) => {
      const now = Date.now()
      if (busy.current || readable.length === 0) return
      if (now < holdUntil.current) return
      if (!manual && now - lastAttempt.current < MIN_GAP_MS) return
      busy.current = true
      lastAttempt.current = now
      setRefreshing(true)
      setError(null)
      try {
        const cursors = await load<Record<string, Cursor>>(CURSORS_KEY, {})
        const fresh: InboxEntry[] = []
        const work: ClassroomItem[] = []
        const problems: string[] = []

        for (const account of readable) {
          const sub = account.identity.sub
          const cursor: Cursor = { ...cursors[sub] }
          const mail = readingOn(account, 'mail', preferences.paused)
          const classes = readingOn(account, 'classroom', preferences.paused)
          try {
            const { accessToken } = await accessTokenFor(platform, account)
            if (mail) {
              if (!cursor.mail) {
                // First look: note where the mailbox is and read nothing yet.
                cursor.mail = await mailCursor(accessToken)
              } else {
                try {
                  // With a model to sort it, Promotions is worth reading: hackathons and job posts land there.
                  const result = await mailSince(accessToken, account.identity.email, cursor.mail, undefined, { everyTab: aiSetup !== null })
                  cursor.mail = result.cursor
                  for (const message of result.messages) {
                    const reading = readMail(message, Date.now())
                    // With Classroom read directly, its notification emails would only repeat it.
                    if (reading.kind === 'classroom' && classes) continue
                    fresh.push({ message, reading, foundAt: Date.now() })
                  }
                } catch (e) {
                  // Away longer than Gmail keeps history: pick up from now rather than replay.
                  if (e instanceof MailCursorExpired) cursor.mail = await mailCursor(accessToken)
                  else throw e
                }
              }
            }
            if (classes) {
              const since = (cursor.classroomSince ??= Date.now())
              const feed = await classroomFeed(accessToken, { announcements: readsAnnouncements(account) })
              work.push(...feed.work)
              const posts = [
                ...feed.work.map((item) => ({ post: courseWorkMessage(item, account.identity.email), done: item.submitted })),
                ...feed.announcements.map(({ course, announcement }) => ({ post: announcementMessage(course, announcement, account.identity.email), done: false })),
              ]
              // The first look after switching on takes in what was already there, quietly.
              const seen = new Set(cursor.classroomSeen ?? posts.filter((p) => p.post.receivedAt < since).map((p) => p.post.id))
              for (const { post, done } of posts) {
                if (seen.has(post.id)) continue
                seen.add(post.id)
                if (!done) fresh.push({ message: post, reading: readMail(post, Date.now()), foundAt: Date.now() })
              }
              cursor.classroomSeen = [...seen].slice(-KEEP_SEEN)
              if (feed.skipped.length) console.warn('Classroom would not open', feed.skipped.join(', '))
            }
          } catch (e) {
            if (e instanceof GoogleApiError && e.rateLimited) holdUntil.current = Date.now() + BACKOFF_MS
            problems.push(`${account.identity.email}: ${e instanceof Error ? e.message : String(e)}`)
          }
          cursors[sub] = cursor
        }

        const ruled = (list: InboxEntry[]) =>
          list.map((e) => {
            const rule = senders[senderAddress(e.message.from)]
            return rule ? { ...e, marked: rule } : e
          })
        // Everything found shows at once: on NVIDIA's free tier the model can
        // take a minute or two per email, and that is no reason to wait.
        const kept = ruled(fresh)
        if (aiSetup) {
          addFound(kept)
          // Mail the model missed last time, while it is still recent, gets another go.
          const retry = foundRef.current
            .filter((e) => !e.triage && !e.marked && e.message.text && Date.now() - e.foundAt < RETRY_FOR_MS && !dismissedRef.current.has(e.message.id))
            .filter((e) => !kept.some((k) => k.message.id === e.message.id))
            .slice(0, RETRY_AT_ONCE)
            .map((e) => ({ ...e }))
          await sortWithAi(aiSetup, [...kept, ...retry])
          addFound(retry.filter((e) => e.triage))
        }
        // Saved only once the mail is read and sorted, so closing the app midway re-reads it next time.
        await storage.set(CURSORS_KEY, JSON.stringify(cursors))

        await applyClassroom(work)

        // Say what turned up, the way a mail app would — but only what
        // matters, and as one notification when a lot arrives at once.
        const worth = kept.filter(isImportant)
        if (worth.length > 3) {
          void platform.notify({ title: `${worth.length} important messages`, body: worth.slice(0, 3).map((e) => e.message.subject).join(' · '), tag: 'inbox' })
        } else {
          for (const e of worth) {
            const due = dueOf(e)
            void platform.notify({
              title: e.message.classroom?.course ?? e.triage?.folder ?? (due ? 'A deadline in your mail' : 'Important email'),
              body: e.triage?.summary ?? due?.title ?? e.message.subject,
              tag: e.message.id,
            })
          }
        }

        addFound(kept)
        setLastRun(Date.now())
        if (problems.length) setError(problems.join('\n'))
      } finally {
        busy.current = false
        setRefreshing(false)
      }
    },
    [readable, preferences.paused, platform, applyClassroom, aiSetup, sortWithAi, senders, addFound],
  )

  // Look when reading is switched on, when the app comes forward, and every few minutes while it is open.
  const latest = useRef(refresh)
  latest.current = refresh
  useEffect(() => {
    void latest.current()
  }, [readable])
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void latest.current()
    }, POLL_MS)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void latest.current()
    })
    return () => {
      clearInterval(timer)
      sub.remove()
    }
  }, [])

  const startFresh = useCallback(async (account: string, feature: Feature) => {
    const cursors = await load<Record<string, Cursor>>(CURSORS_KEY, {})
    const cursor = { ...cursors[account] }
    if (feature === 'mail') delete cursor.mail
    else {
      delete cursor.classroomSince
      delete cursor.classroomSeen
    }
    cursors[account] = cursor
    await storage.set(CURSORS_KEY, JSON.stringify(cursors))
  }, [])

  /**
   * Makes the task a message offers, at the time it gives, with the model's
   * tags. Coursework keeps Classroom's id, so its task follows a moved
   * deadline and completes itself on hand-in.
   */
  const addAsTask = useCallback(
    async (entry: InboxEntry) => {
      const { message, triage } = entry
      const post = message.classroom
      const now = Date.now()
      const due = dueOf(entry)
      const sender = message.from.replace(/<[^>]+>/, '').replace(/["']/g, '').trim() || message.from
      const detail = [triage?.summary ?? message.snippet, post ? `${post.course}: ${message.subject}` : `From ${sender}: ${message.subject}`, post?.link]
        .filter(Boolean)
        .join('\n\n')
      await reminders.upsert(
        createReminder(
          {
            title: due?.title || message.subject || 'From email',
            body: detail,
            dueAt: due?.dueAt ?? now + DAY,
            allDay: due ? due.allDay : true,
            priority: isImportant(entry) ? 'high' : 'normal',
            tags: tagsOf(entry),
            courseId: post?.courseId,
            source: post ? 'classroom' : 'email',
            sourceRef: post?.workId ?? message.id,
            autoCompleteOn: post?.workId ? 'classroom-submission' : undefined,
          },
          { userId, now, id: inboxTaskId(message) },
        ),
      )
    },
    [reminders, userId],
  )

  const dismiss = useCallback(({ message }: InboxEntry) => {
    setDismissed((current) => {
      const next = new Set(current).add(message.id)
      void storage.set(DISMISSED_KEY, JSON.stringify([...next].slice(-500)))
      return next
    })
  }, [])

  const mark = useCallback(
    (entry: InboxEntry, rule: SenderRule) => {
      const address = senderAddress(entry.message.from)
      setSenders((current) => {
        const next = { ...current, [address]: rule }
        void storage.set(SENDERS_KEY, JSON.stringify(next))
        return next
      })
      // Every email already here from that sender moves too, not only this one.
      setFound((current) => {
        const next = current.map((e) => (senderAddress(e.message.from) === address ? { ...e, marked: rule } : e))
        save(next)
        return next
      })
    },
    [save],
  )

  const markSeen = useCallback(() => {
    const now = Date.now()
    setSeenAt(now)
    void storage.set(SEEN_KEY, JSON.stringify(now))
  }, [])

  const setAiSetup = useCallback(
    async (setup: AiSetup | null) => {
      if (setup) await platform.secrets.set(AI_SECRET, JSON.stringify(setup))
      else await platform.secrets.delete(AI_SECRET)
      setAiSetupState(setup)
      setAi({})
    },
    [platform],
  )

  const setProfile = useCallback((text: string) => {
    const tidy = text.trim().slice(0, PROFILE_LIMIT)
    setProfileState(tidy || DEFAULT_PROFILE)
    void storage.set(PROFILE_KEY, tidy === DEFAULT_PROFILE ? '' : tidy)
  }, [])

  const folders = useMemo(() => foldersOf(found), [found])
  const unseen = useMemo(() => found.filter((e) => e.foundAt > seenAt && isImportant(e) && !dismissed.has(e.message.id)).length, [found, seenAt, dismissed])
  const aiStatus = useMemo<AiStatus>(
    () => ({ on: aiSetup !== null, preferred: aiSetup ? modelsFor(aiSetup)[0]?.label : undefined, ...ai }),
    [aiSetup, ai],
  )

  const value = useMemo(
    () => ({ found, folders, readable, refreshing, error, lastRun, dismissed, unseen, ai: aiStatus, profile, refresh, startFresh, addAsTask, dismiss, mark, markSeen, setAiSetup, setProfile }),
    [found, folders, readable, refreshing, error, lastRun, dismissed, unseen, aiStatus, profile, refresh, startFresh, addAsTask, dismiss, mark, markSeen, setAiSetup, setProfile],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useInbox(): Inbox {
  const value = useContext(Context)
  if (!value) throw new Error('useInbox needs an InboxProvider')
  return value
}
