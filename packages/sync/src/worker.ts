import type { SenderRule } from '@cairn/core'
import type { AiSetup } from './ai'

/**
 * Cairn's Worker: the small server on Cloudflare that reads Gmail and
 * Classroom for everyone, every ten minutes, and is the only place a Google
 * refresh token or an NVIDIA key is kept. The apps talk to it here, proving
 * who they are with the Firebase session they already have.
 *
 * Replace the address with your own after `wrangler deploy` (it prints it),
 * or set VITE_CAIRN_WORKER_URL for the desktop and EXPO_PUBLIC_CAIRN_WORKER_URL
 * for the phone. See apps/worker/README.md.
 */
export const CAIRN_WORKER_URL = 'https://cairn-worker.vishalkarun0205.workers.dev'

/** What an account can be read for, as the Worker reports it. */
export type Service = 'drive' | 'mail' | 'classroom' | 'announcements' | 'files'

/** Groups of permission the apps ask the Worker to request from Google. */
export type Want = 'drive' | 'mail' | 'classroom' | 'files'

/** What a short-lived access token handed to a device is for. */
export type TokenPurpose = 'drive' | 'classroomFiles'

export interface WorkerAccount {
  email: string
  /** The owner holds the notes and is the Firebase account; a source is only read. */
  role: 'owner' | 'source'
  /** What Google has granted for it. */
  services: Service[]
  /** What the person chose to have read. */
  watch: { mail: boolean; classroom: boolean }
  /** Set when the Worker cannot use the account, e.g. "Google signed Cairn out of it". */
  problem?: string
}

/** settings/accounts, written by the Worker: who is connected and for what. Never a token. */
export interface AccountsDoc {
  accounts: WorkerAccount[]
  /** Whether an NVIDIA key is set up, and which model is asked first. Never the key. */
  ai?: { on: boolean; preferred?: string }
  updatedAt: number
}

/** settings/reader, written by the Worker after its checks. */
export interface ReaderDoc {
  /** When the Worker last looked at this person's accounts. */
  checkedAt?: number
  /** Per account, by address. */
  accounts?: Record<string, { checkedAt?: number; error?: string }>
  /** Where reading has got to, for anyone curious. The Worker keeps its own copy. */
  cursors?: Record<string, { mail?: string; classroomSince?: number }>
  /** The model that answered last, or what went wrong. */
  ai?: { model?: string; error?: string }
}

/** settings/inbox: what the person has said about their mail, written by either device. */
export interface InboxSettings {
  senders?: Record<string, SenderRule>
  /** What matters to them, in their own words. Empty means the default. */
  profile?: string
  /** New coursework and announcements become tasks without a tap. */
  autoTasks?: boolean
  /** IANA name, set by the phone, so the Worker's notifications keep the person's hours. */
  timeZone?: string
  updatedAt?: number
}

export type WorkerFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class WorkerError extends Error {
  constructor(
    readonly status: number,
    /** The Worker's own reason, e.g. "consent" when Google has not granted what was asked. */
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkerError'
  }

  /** The account has not granted what this needs; the consent flow will put it right. */
  get needsConsent(): boolean {
    return this.code === 'consent'
  }
}

export interface WorkerClientOptions {
  url?: string
  /** The signed-in Firebase user's ID token, or null signed out. */
  idToken: () => Promise<string | null>
  fetchFn?: WorkerFetch
}

const TOKEN_SLACK_MS = 5 * 60_000

/** The Worker's API, as the apps call it. */
export class WorkerClient {
  readonly url: string
  private readonly idToken: () => Promise<string | null>
  private readonly fetchFn?: WorkerFetch
  private readonly tokens = new Map<string, Promise<{ accessToken: string; expiresAt: number }>>()

  constructor(options: WorkerClientOptions) {
    this.url = (options.url || CAIRN_WORKER_URL).replace(/\/+$/, '')
    this.idToken = options.idToken
    this.fetchFn = options.fetchFn
  }

  /**
   * Where to send the browser to sign in, or to grant more. The Worker runs
   * Google's consent and sends the browser back to `redirect` with a
   * one-time code and `state`.
   */
  authUrl(options: { redirect: string; state: string; challenge: string; want: readonly Want[]; hint?: string; ticket?: string; add?: boolean }): string {
    const params: Record<string, string> = { redirect: options.redirect, state: options.state, challenge: options.challenge, want: options.want.join(',') }
    if (options.hint) params.hint = options.hint
    if (options.ticket) params.ticket = options.ticket
    if (options.add) params.add = '1'
    const query = Object.entries(params)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&')
    return `${this.url}/auth/start?${query}`
  }

  /** A short-lived pass saying which Cairn account a consent belongs to, so a second Google account joins it. */
  async ticket(): Promise<string> {
    return (await this.call<{ ticket: string }>('POST', '/auth/ticket')).ticket
  }

  /**
   * Trades the one-time code for the Google ID token that signs in to
   * Firebase. The verifier proves this is the app that started the sign-in,
   * not another app that caught the redirect.
   */
  async exchange(code: string, verifier: string): Promise<{ email: string; uid: string; idToken?: string }> {
    return this.call('POST', '/auth/exchange', { code, verifier }, false)
  }

  /** Stops every check and deletes everything the Worker holds for this person. */
  async forget(): Promise<void> {
    await this.call('DELETE', '/me')
  }

  /**
   * A short-lived Google access token for one of the caller's accounts. One
   * is kept until five minutes before it runs out, so a media pass that
   * finds nothing to do does not cost the Worker a request each time.
   */
  async token(account: string, purpose: TokenPurpose): Promise<{ accessToken: string; expiresAt: number }> {
    const key = `${account}\n${purpose}`
    const held = this.tokens.get(key)
    if (held) {
      const token = await held.catch(() => null)
      if (token && token.expiresAt - TOKEN_SLACK_MS > Date.now()) return token
    }
    const asked = this.call<{ accessToken: string; expiresAt: number }>('GET', `/token?account=${encodeURIComponent(account)}&purpose=${purpose}`)
    this.tokens.set(key, asked)
    asked.catch(() => this.tokens.get(key) === asked && this.tokens.delete(key))
    return asked
  }

  /** Drops the tokens held, as on signing out or after Google refused one. */
  forgetTokens(): void {
    this.tokens.clear()
  }

  /** Checks this person's mail and Classroom now. Resolves once what was found is in Firestore. */
  async sync(): Promise<{ checkedAt: number; found: number; busy?: boolean; errors?: string[] }> {
    return this.call('POST', '/sync')
  }

  /** Stores, or with null forgets, the NVIDIA key. The Worker keeps it encrypted; it never reaches Firestore. */
  async setupAi(setup: AiSetup | null): Promise<{ on: boolean; preferred?: string }> {
    return this.call('POST', '/setup/ai', { setup })
  }

  async accounts(): Promise<AccountsDoc> {
    return this.call('GET', '/accounts')
  }

  /** What to read from one account. */
  async watch(account: string, watch: Partial<WorkerAccount['watch']>): Promise<AccountsDoc> {
    return this.call('POST', '/accounts', { account, watch })
  }

  /** Forgets a source account and gives its permission back to Google. */
  async disconnect(account: string): Promise<AccountsDoc> {
    return this.call('DELETE', `/accounts?account=${encodeURIComponent(account)}`)
  }

  /** Where to send push notifications for this phone, and the hours to keep. */
  async registerPush(token: string, timeZone?: string): Promise<void> {
    await this.call('POST', '/push/register', { token, platform: 'android', ...(timeZone ? { timeZone } : {}) })
  }

  async unregisterPush(token: string): Promise<void> {
    await this.call('DELETE', '/push/register', { token })
  }

  private async call<T>(method: string, path: string, body?: unknown, signedIn = true): Promise<T> {
    const fetchFn = this.fetchFn ?? (globalThis as { fetch?: WorkerFetch }).fetch
    if (!fetchFn) throw new Error('This runtime has no fetch; pass one of your own')
    const headers: Record<string, string> = { Accept: 'application/json' }
    if (signedIn) {
      const token = await this.idToken()
      if (!token) throw new WorkerError(401, 'signed_out', 'Sign in first.')
      headers.Authorization = `Bearer ${token}`
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    let response: Awaited<ReturnType<WorkerFetch>>
    try {
      response = await fetchFn(`${this.url}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
    } catch (cause) {
      throw new WorkerError(0, 'unreachable', `Could not reach Cairn's server (${cause instanceof Error ? cause.message : String(cause)}).`)
    }
    let payload: { error?: string; message?: string } & Record<string, unknown> = {}
    try {
      payload = (await response.json()) as typeof payload
    } catch {
      // An empty or unreadable body; the status says enough.
    }
    if (!response.ok) {
      throw new WorkerError(response.status, payload.error ?? `http_${response.status}`, payload.message ?? `Cairn's server refused the request (${response.status})`)
    }
    return payload as T
  }
}
