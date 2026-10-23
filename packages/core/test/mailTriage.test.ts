import { describe, expect, it } from 'vitest'
import { canonicalFolder, MAX_FOLDERS, parseDue, readTriage, senderAddress, triagePrompt, type MailMessage } from '../src'
import { at, NOW, show } from './helpers'

const message: MailMessage = {
  id: 'm1',
  account: 'me@uni.edu',
  from: 'Devfolio <hello@devfolio.co>',
  subject: 'HackMIT registrations close Friday',
  snippet: 'Register before…',
  text: 'Register for HackMIT before 18 Sep, 11:59 PM.\n\n\n\nUnsubscribe',
  receivedAt: NOW,
}

const reply = (value: unknown) => JSON.stringify(value)

describe('triagePrompt', () => {
  it('gives the model the whole body, the folders in use and the local time', () => {
    const { user } = triagePrompt(message, { now: NOW, folders: ['Jobs', 'Classes'], timeZone: 'America/New_York' })
    expect(user).toContain('Existing folders: Jobs, Classes')
    expect(user).toContain('Monday 2026-09-14 10:00 (America/New_York)')
    expect(user).toContain('Register for HackMIT before 18 Sep, 11:59 PM.\n\nUnsubscribe')
  })

  it('says there are no folders yet, and when there are enough', () => {
    expect(triagePrompt(message, { now: NOW, folders: [] }).user).toContain('Existing folders: none yet')
    const many = Array.from({ length: MAX_FOLDERS }, (_, i) => `F${i}`)
    expect(triagePrompt(message, { now: NOW, folders: many }).user).toContain('use one of these, or null')
  })

  it('falls back to the snippet when the body was not fetched', () => {
    const { user } = triagePrompt({ ...message, text: undefined }, { now: NOW, folders: [] })
    expect(user.endsWith('Register before…')).toBe(true)
  })
})

describe('readTriage', () => {
  const context = { now: NOW, folders: ['Jobs', 'Hackathons'] }

  it('reads a full reply, with a task due at a local time', () => {
    const triage = readTriage(
      reply({ important: true, folder: 'hackathon', summary: 'HackMIT registration closes Friday.', why: 'Registration closes soon', task: { title: 'Register for HackMIT', due: '2026-09-18T23:59' } }),
      context,
    )
    expect(triage).toMatchObject({ important: true, folder: 'Hackathons', summary: 'HackMIT registration closes Friday.', why: 'Registration closes soon' })
    expect(triage?.task?.title).toBe('Register for HackMIT')
    expect(show(triage?.task?.dueAt)).toBe(show(at(2026, 9, 18, 23, 59)))
    expect(triage?.task?.allDay).toBe(false)
  })

  it('finds the JSON inside thinking, code fences and prose', () => {
    const wrapped = '<think>Is it a job? No.</think>Sure!\n```json\n' + reply({ important: false, folder: null, summary: 'A newsletter.' }) + '\n```'
    expect(readTriage(wrapped, context)).toEqual({ important: false, summary: 'A newsletter.' })
  })

  it('gives nothing back for a reply with no usable JSON or no summary', () => {
    expect(readTriage('I cannot help with that.', context)).toBeNull()
    expect(readTriage('{"important": tru', context)).toBeNull()
    expect(readTriage(reply({ important: true, summary: '' }), context)).toBeNull()
  })

  it('drops a deadline that is already history, or years away', () => {
    expect(readTriage(reply({ important: true, summary: 's', task: { title: 't', due: '2026-09-01' } }), context)?.task).toBeUndefined()
    expect(readTriage(reply({ important: true, summary: 's', task: { title: 't', due: '2031-01-01' } }), context)?.task).toBeUndefined()
  })

  it('keeps no reason for mail that is not important', () => {
    expect(readTriage(reply({ important: false, summary: 's', why: 'Marketing' }), context)?.why).toBeUndefined()
  })

  it('treats "true" written as a string as true', () => {
    expect(readTriage(reply({ important: 'true', summary: 's' }), context)?.important).toBe(true)
  })
})

describe('canonicalFolder', () => {
  it('matches an existing folder written differently', () => {
    expect(canonicalFolder('hackathon', ['Hackathons'])).toBe('Hackathons')
    expect(canonicalFolder('JOBS', ['Jobs'])).toBe('Jobs')
    expect(canonicalFolder('Classes', ['Class'])).toBe('Class')
  })

  it('tidies a new name: title case, short, acronyms kept', () => {
    expect(canonicalFolder('internship  offers!!', [])).toBe('Internship Offers')
    expect(canonicalFolder('AI events', [])).toBe('AI Events')
    expect(canonicalFolder('a very long folder name indeed', [])).toBe('A Very Long')
  })

  it('refuses names that mean nothing, and new folders past the limit', () => {
    expect(canonicalFolder(null, [])).toBeUndefined()
    expect(canonicalFolder('Other', [])).toBeUndefined()
    expect(canonicalFolder('none', [])).toBeUndefined()
    const many = Array.from({ length: MAX_FOLDERS }, (_, i) => `Folder ${i}`)
    expect(canonicalFolder('Brand New', many)).toBeUndefined()
    expect(canonicalFolder('folder 3', many)).toBe('Folder 3')
  })
})

describe('parseDue', () => {
  it('reads a date alone as all day, alerting in the morning', () => {
    expect(parseDue('2026-09-18')).toEqual({ dueAt: at(2026, 9, 18, 9), allDay: true })
  })

  it('reads a time with no zone as local, and honours a zone when given', () => {
    expect(parseDue('2026-09-18 17:30')).toEqual({ dueAt: at(2026, 9, 18, 17, 30), allDay: false })
    expect(parseDue('2026-09-18T23:59:00+05:30')).toEqual({ dueAt: Date.UTC(2026, 8, 18, 18, 29), allDay: false })
    expect(parseDue('2026-09-18T12:00Z')).toEqual({ dueAt: Date.UTC(2026, 8, 18, 12), allDay: false })
  })

  it('refuses anything else', () => {
    for (const bad of ['Friday', '18/09/2026', '2026-13-01', '2026-09-18T25:00', null, 42]) expect(parseDue(bad)).toBeNull()
  })
})

describe('senderAddress', () => {
  it('takes the address out of a From header', () => {
    expect(senderAddress('Devfolio <Hello@Devfolio.co>')).toBe('hello@devfolio.co')
    expect(senderAddress('someone@uni.edu')).toBe('someone@uni.edu')
  })
})
