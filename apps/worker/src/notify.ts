import { clockTime, DAY, isImportant, startOfLocalDay, type InboxRecord, type SenderRule } from '@cairn/core'
import type { Push } from './fcm'
import type { Zone } from './zone'

/**
 * What the phone is told when something arrives. Coursework and
 * announcements always; mail only when it matters. Several at once become
 * one notification rather than a stack of them.
 */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "today 11:59 pm", "tomorrow", "Fri 9:00 am", "30 Oct", on the person's clock. */
export function dueLabel(dueAt: number, allDay: boolean, now: number, zone: Zone): string {
  const due = zone.toWall(dueAt)
  const days = Math.round((startOfLocalDay(due) - startOfLocalDay(zone.toWall(now))) / DAY)
  const d = new Date(due)
  const day = days === 0 ? 'today' : days === 1 ? 'tomorrow' : days > 1 && days < 7 ? DAYS[d.getUTCDay()]! : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
  return allDay ? day : `${day} ${clockTime(due)}`
}

/** Whether a record is worth a notification once it is settled. */
export function worthAnnouncing(record: InboxRecord, senders: Readonly<Record<string, SenderRule>>): boolean {
  if (record.dismissed || record.read) return false
  if (record.classroom) return !record.classroom.submitted
  return isImportant(record, senders)
}

export function announcements(records: readonly InboxRecord[], now: number, zone: Zone): Push[] {
  if (records.length === 0) return []
  if (records.length > 3) {
    const classroom = records.every((r) => r.classroom)
    return [
      {
        title: `${records.length} new in Cairn`,
        body: records
          .slice(0, 3)
          .map((r) => r.subject)
          .join(' · '),
        tag: 'inbox',
        data: { kind: classroom ? 'classroom' : 'inbox', id: '' },
      },
    ]
  }
  return records.map((r): Push => {
    const post = r.classroom
    if (post) {
      const due = post.due ? ` · due ${dueLabel(post.due.dueAt, post.due.allDay, now, zone)}` : ''
      return {
        title: post.course,
        body: `${post.kind === 'work' ? 'New coursework: ' : ''}${r.subject}${due}`,
        tag: r.id,
        data: { kind: 'classroom', id: r.id },
      }
    }
    const task = r.triage?.task
    return {
      title: r.triage?.folder ?? (task ? 'A deadline in your mail' : 'Important email'),
      body: r.triage?.summary ?? (task ? `${task.title} · ${dueLabel(task.dueAt, task.allDay, now, zone)}` : r.subject),
      tag: r.id,
      data: { kind: 'inbox', id: r.id },
    }
  })
}
