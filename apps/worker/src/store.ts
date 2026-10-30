/**
 * The Worker's own database: D1, Cloudflare's SQLite. It holds what must not
 * be in Firestore — Google refresh tokens, the NVIDIA key, the message text
 * still waiting for the model — all sealed (see crypto.ts), plus the state
 * that changes on every run, which is cheap to write here and would eat into
 * Firestore's small daily allowance.
 *
 * Everything goes through this interface, so the tests can run on a map.
 */

export interface UserRow {
  uid: string
  /** The account that owns the data, which is also the Firebase account. */
  email: string
  timeZone: string | null
  /** The NVIDIA setup, sealed. */
  ai: string | null
  /** Where reading has got to, sealed. */
  state: string | null
  runningUntil: number
  createdAt: number
}

export type Role = 'owner' | 'source'

export interface AccountRow {
  uid: string
  email: string
  /** Google's stable id for the account. */
  sub: string
  role: Role
  scopes: string[]
  /** The refresh token, sealed. */
  refresh: string
  watchMail: boolean
  watchClassroom: boolean
  /** Why it cannot be used, when it cannot. */
  problem: string | null
  createdAt: number
}

export interface Store {
  user(uid: string): Promise<UserRow | null>
  /** Creates the person, or updates their address. */
  putUser(uid: string, email: string, now: number): Promise<void>
  countUsers(): Promise<number>
  /** Whether this address may sign in as a new person (Cairn is invite-only). */
  invited(email: string): Promise<boolean>
  /** Everyone with an account to read and an invite, for the cron. */
  userIds(): Promise<string[]>
  setAi(uid: string, sealed: string | null): Promise<void>
  setTimeZone(uid: string, zone: string): Promise<void>
  /** Takes the run for a while; false when another run has it. */
  claim(uid: string, until: number, now: number): Promise<boolean>
  /** Saves where reading got to and lets the run go. */
  finish(uid: string, state: string | null): Promise<void>
  /** Forgets the person entirely. */
  forget(uid: string): Promise<void>

  accounts(uid: string): Promise<AccountRow[]>
  account(uid: string, email: string): Promise<AccountRow | null>
  putAccount(row: AccountRow): Promise<void>
  deleteAccount(uid: string, email: string): Promise<void>

  token(uid: string, email: string, purpose: string): Promise<{ token: string; expiresAt: number } | null>
  putToken(uid: string, email: string, purpose: string, token: string, expiresAt: number): Promise<void>
  /** Every cached token for an account, after its grant changed. */
  dropTokens(uid: string, email: string): Promise<void>

  /** Codes nobody came back for are cleared out as new ones are made. */
  putCode(code: string, payload: string, expiresAt: number, now: number): Promise<void>
  /** The code's payload, once: it is deleted as it is read. */
  takeCode(code: string, now: number): Promise<string | null>

  pushTokens(uid: string): Promise<string[]>
  putPush(token: string, uid: string, platform: string, now: number): Promise<void>
  deletePush(token: string): Promise<void>

  meta(key: string, now: number): Promise<string | null>
  putMeta(key: string, value: string, expiresAt: number): Promise<void>
}

interface UserSql {
  uid: string
  email: string
  time_zone: string | null
  ai: string | null
  state: string | null
  running_until: number
  created_at: number
}

interface AccountSql {
  uid: string
  email: string
  sub: string
  role: string
  scopes: string
  refresh: string
  watch_mail: number
  watch_classroom: number
  problem: string | null
  created_at: number
}

function userOf(row: UserSql): UserRow {
  return {
    uid: row.uid,
    email: row.email,
    timeZone: row.time_zone,
    ai: row.ai,
    state: row.state,
    runningUntil: row.running_until,
    createdAt: row.created_at,
  }
}

function accountOf(row: AccountSql): AccountRow {
  return {
    uid: row.uid,
    email: row.email,
    sub: row.sub,
    role: row.role === 'owner' ? 'owner' : 'source',
    scopes: row.scopes.split(' ').filter(Boolean),
    refresh: row.refresh,
    watchMail: row.watch_mail === 1,
    watchClassroom: row.watch_classroom === 1,
    problem: row.problem,
    createdAt: row.created_at,
  }
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async user(uid: string): Promise<UserRow | null> {
    const row = await this.db.prepare('SELECT * FROM users WHERE uid = ?').bind(uid).first<UserSql>()
    return row ? userOf(row) : null
  }

  async putUser(uid: string, email: string, now: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO users (uid, email, created_at) VALUES (?, ?, ?) ON CONFLICT (uid) DO UPDATE SET email = excluded.email')
      .bind(uid, email, now)
      .run()
  }

  async countUsers(): Promise<number> {
    const row = await this.db.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()
    return row?.n ?? 0
  }

  async invited(email: string): Promise<boolean> {
    const row = await this.db.prepare('SELECT 1 AS yes FROM invites WHERE email = ?').bind(email.trim().toLowerCase()).first<{ yes: number }>()
    return !!row
  }

  async userIds(): Promise<string[]> {
    // Someone taken off the invite list stops being checked at once.
    const { results } = await this.db
      .prepare('SELECT DISTINCT a.uid FROM accounts a JOIN users u ON u.uid = a.uid JOIN invites i ON i.email = lower(u.email) ORDER BY a.uid')
      .all<{ uid: string }>()
    return results.map((r) => r.uid)
  }

  async setAi(uid: string, sealed: string | null): Promise<void> {
    await this.db.prepare('UPDATE users SET ai = ? WHERE uid = ?').bind(sealed, uid).run()
  }

  async setTimeZone(uid: string, zone: string): Promise<void> {
    await this.db.prepare('UPDATE users SET time_zone = ? WHERE uid = ?').bind(zone, uid).run()
  }

  async claim(uid: string, until: number, now: number): Promise<boolean> {
    const result = await this.db.prepare('UPDATE users SET running_until = ? WHERE uid = ? AND running_until <= ?').bind(until, uid, now).run()
    return (result.meta.changes ?? 0) > 0
  }

  async finish(uid: string, state: string | null): Promise<void> {
    if (state === null) await this.db.prepare('UPDATE users SET running_until = 0 WHERE uid = ?').bind(uid).run()
    else await this.db.prepare('UPDATE users SET state = ?, running_until = 0 WHERE uid = ?').bind(state, uid).run()
  }

  async forget(uid: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM accounts WHERE uid = ?').bind(uid),
      this.db.prepare('DELETE FROM tokens WHERE uid = ?').bind(uid),
      this.db.prepare('DELETE FROM push WHERE uid = ?').bind(uid),
      this.db.prepare('DELETE FROM users WHERE uid = ?').bind(uid),
    ])
  }

  async accounts(uid: string): Promise<AccountRow[]> {
    const { results } = await this.db.prepare("SELECT * FROM accounts WHERE uid = ? ORDER BY role = 'owner' DESC, created_at").bind(uid).all<AccountSql>()
    return results.map(accountOf)
  }

  async account(uid: string, email: string): Promise<AccountRow | null> {
    const row = await this.db.prepare('SELECT * FROM accounts WHERE uid = ? AND email = ?').bind(uid, email).first<AccountSql>()
    return row ? accountOf(row) : null
  }

  async putAccount(row: AccountRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO accounts (uid, email, sub, role, scopes, refresh, watch_mail, watch_classroom, problem, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (uid, email) DO UPDATE SET sub = excluded.sub, role = excluded.role, scopes = excluded.scopes,
           refresh = excluded.refresh, watch_mail = excluded.watch_mail, watch_classroom = excluded.watch_classroom, problem = excluded.problem`,
      )
      .bind(row.uid, row.email, row.sub, row.role, row.scopes.join(' '), row.refresh, row.watchMail ? 1 : 0, row.watchClassroom ? 1 : 0, row.problem, row.createdAt)
      .run()
  }

  async deleteAccount(uid: string, email: string): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM accounts WHERE uid = ? AND email = ?').bind(uid, email),
      this.db.prepare('DELETE FROM tokens WHERE uid = ? AND email = ?').bind(uid, email),
    ])
  }

  async token(uid: string, email: string, purpose: string): Promise<{ token: string; expiresAt: number } | null> {
    const row = await this.db
      .prepare('SELECT token, expires_at FROM tokens WHERE uid = ? AND email = ? AND purpose = ?')
      .bind(uid, email, purpose)
      .first<{ token: string; expires_at: number }>()
    return row ? { token: row.token, expiresAt: row.expires_at } : null
  }

  async putToken(uid: string, email: string, purpose: string, token: string, expiresAt: number): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO tokens (uid, email, purpose, token, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (uid, email, purpose) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at',
      )
      .bind(uid, email, purpose, token, expiresAt)
      .run()
  }

  async dropTokens(uid: string, email: string): Promise<void> {
    await this.db.prepare('DELETE FROM tokens WHERE uid = ? AND email = ?').bind(uid, email).run()
  }

  async putCode(code: string, payload: string, expiresAt: number, now: number): Promise<void> {
    await this.db.batch([
      this.db.prepare('DELETE FROM codes WHERE expires_at < ?').bind(now),
      this.db.prepare('INSERT INTO codes (code, payload, expires_at) VALUES (?, ?, ?)').bind(code, payload, expiresAt),
    ])
  }

  async takeCode(code: string, now: number): Promise<string | null> {
    const row = await this.db.prepare('DELETE FROM codes WHERE code = ? RETURNING payload, expires_at').bind(code).first<{ payload: string; expires_at: number }>()
    return row && row.expires_at >= now ? row.payload : null
  }

  async pushTokens(uid: string): Promise<string[]> {
    const { results } = await this.db.prepare('SELECT token FROM push WHERE uid = ? ORDER BY updated_at DESC LIMIT 5').bind(uid).all<{ token: string }>()
    return results.map((r) => r.token)
  }

  async putPush(token: string, uid: string, platform: string, now: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO push (token, uid, platform, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (token) DO UPDATE SET uid = excluded.uid, platform = excluded.platform, updated_at = excluded.updated_at')
      .bind(token, uid, platform, now)
      .run()
  }

  async deletePush(token: string): Promise<void> {
    await this.db.prepare('DELETE FROM push WHERE token = ?').bind(token).run()
  }

  async meta(key: string, now: number): Promise<string | null> {
    const row = await this.db.prepare('SELECT value, expires_at FROM meta WHERE key = ?').bind(key).first<{ value: string; expires_at: number }>()
    return row && row.expires_at > now ? row.value : null
  }

  async putMeta(key: string, value: string, expiresAt: number): Promise<void> {
    await this.db
      .prepare('INSERT INTO meta (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
      .bind(key, value, expiresAt)
      .run()
  }
}
