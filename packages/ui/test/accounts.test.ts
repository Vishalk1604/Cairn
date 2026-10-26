import { describe, expect, it } from 'vitest'
import { accountGaps, accountRecords, featuresOf, scopesFor, type Account } from '../src'

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
    expect(asked).toContain(scope('classroom.announcements.readonly'))
    expect(asked).toContain(scope('classroom.coursework.me.readonly'))
    expect(asked).not.toContain(scope('classroom.coursework.students.readonly'))
    expect(asked).not.toContain(scope('classroom.rosters.readonly'))
  })
})

describe('accountGaps', () => {
  const owner = (sub: string, email: string, scopes: string[]): Account => ({ ...account(scopes), identity: { sub, email, emailVerified: true }, role: 'owner' })
  const gmail = scope('gmail.readonly')
  const classroom = [scope('classroom.courses.readonly'), scope('classroom.coursework.me.readonly')]
  const announcements = scope('classroom.announcements.readonly')

  it('records what each account can read, with no token in it', () => {
    const records = accountRecords([owner('o', 'me@gmail.com', [gmail, ...classroom, announcements])])
    expect(records).toEqual([{ sub: 'o', email: 'me@gmail.com', role: 'owner', services: ['mail', 'classroom', 'announcements'] }])
    expect(JSON.stringify(records)).not.toContain('refresh')
  })

  it('finds nothing when this device can read all the other can', () => {
    const phone = accountRecords([owner('o', 'me@gmail.com', [gmail])])
    expect(accountGaps(phone, [owner('o', 'me@gmail.com', [gmail, ...classroom])])).toEqual([])
  })

  it('names an account the other device reads that is missing here, with the permissions to ask for', () => {
    const phone = accountRecords([owner('o', 'me@gmail.com', []), { ...account([...classroom, announcements]), identity: { sub: 'u', email: 'me@uni.edu', emailVerified: true } }])
    const gaps = accountGaps(phone, [owner('o', 'me@gmail.com', [])])
    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ sub: 'u', email: 'me@uni.edu', role: 'source', missing: ['classroom', 'announcements'], features: { mail: false, classroom: true } })
    expect(gaps[0]!.account).toBeUndefined()
    expect(scopesFor(gaps[0]!.role, gaps[0]!.features)).toContain(announcements)
  })

  it('names a permission missing on an account connected here, keeping what it has', () => {
    const phone = accountRecords([owner('o', 'me@gmail.com', [gmail, ...classroom, announcements])])
    const here = owner('o', 'me@gmail.com', [...classroom])
    const [gap] = accountGaps(phone, [here])
    expect(gap!.missing).toEqual(['mail', 'announcements'])
    expect(gap!.account).toBe(here)
    expect(gap!.features).toEqual({ mail: true, classroom: true })
  })

  it('leaves out what this device has no use for', () => {
    const desktop = accountRecords([owner('o', 'me@gmail.com', [...classroom, scope('drive.readonly')])])
    expect(accountGaps(desktop, [owner('o', 'me@gmail.com', [...classroom])], { ignore: ['files'] })).toEqual([])
    expect(accountGaps(desktop, [owner('o', 'me@gmail.com', [...classroom])])[0]!.missing).toEqual(['files'])
  })
})
