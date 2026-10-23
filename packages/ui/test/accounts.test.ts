import { describe, expect, it } from 'vitest'
import { featuresOf, scopesFor, type Account } from '../src'

const scope = (name: string) => `https://www.googleapis.com/auth/${name}`

const account = (scopes: string[]): Account => ({
  identity: { sub: 's1', email: 'me@uni.edu', emailVerified: true },
  role: 'source',
  scopes: ['openid', ...scopes],
  refreshToken: 'r',
})

describe('featuresOf', () => {
  it('counts Classroom as granted with courses and coursework', () => {
    expect(featuresOf(account([scope('classroom.courses.readonly'), scope('classroom.coursework.me.readonly')])).classroom).toBe(true)
  })

  it('accepts the older submissions synonym Google may return instead', () => {
    // Asking for both scopes once got back only one of them, and the toggle
    // could never turn on — every tap went round the consent screen again.
    expect(featuresOf(account([scope('classroom.courses.readonly'), scope('classroom.student-submissions.me.readonly')])).classroom).toBe(true)
  })

  it('needs the course list as well as the coursework', () => {
    expect(featuresOf(account([scope('classroom.coursework.me.readonly')])).classroom).toBe(false)
  })

  it('reads Gmail only with gmail.readonly', () => {
    expect(featuresOf(account([scope('gmail.readonly')])).mail).toBe(true)
    expect(featuresOf(account([])).mail).toBe(false)
  })
})

describe('scopesFor', () => {
  it('asks for nothing Cairn does not use', () => {
    const asked = scopesFor('source', { mail: false, classroom: true })
    expect(asked).not.toContain(scope('classroom.announcements.readonly'))
    expect(asked).toContain(scope('classroom.coursework.me.readonly'))
  })
})
