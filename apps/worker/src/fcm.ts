import { openJson, sealJson, toBase64Url, utf8 } from './crypto'
import type { Env } from './env'
import type { FetchFn } from './net'
import type { Store } from './store'

/**
 * Push notifications through Firebase Cloud Messaging's HTTP v1 API, which
 * is free on the Spark plan. It takes an OAuth token for a service account:
 * the Worker signs a JWT with the account's key, trades it for an access
 * token, and keeps that for its hour, sealed, so most runs never sign
 * anything.
 */

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id?: string
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const META_KEY = 'fcm-token'

let held: { token: string; expiresAt: number } | null = null

/** For tests. */
export function forgetFcmToken(): void {
  held = null
}

function serviceAccount(env: Pick<Env, 'FCM_SERVICE_ACCOUNT'>): ServiceAccount {
  try {
    const parsed = JSON.parse(env.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>
    if (parsed.client_email && parsed.private_key) return parsed as ServiceAccount
  } catch {
    // Reported below.
  }
  throw new Error('FCM_SERVICE_ACCOUNT is not a service account JSON key')
}

function pemBody(pem: string): Uint8Array {
  const base64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A JWT signed RS256 with the service account's key, asking for `scope`. */
export async function serviceJwt(account: ServiceAccount, scope: string, now: number): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemBody(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const iat = Math.floor(now / 1000)
  const part = (value: object) => toBase64Url(utf8(JSON.stringify(value)))
  const unsigned = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: account.client_email, scope, aud: TOKEN_URL, iat, exp: iat + 3600 })}`
  const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(unsigned)))
  return `${unsigned}.${toBase64Url(signature)}`
}

async function accessToken(env: Env, store: Store, fetchFn: FetchFn, now: number): Promise<string> {
  if (held && held.expiresAt - 60_000 > now) return held.token
  const kept = await store.meta(META_KEY, now + 60_000)
  if (kept) {
    held = await openJson<{ token: string; expiresAt: number }>(env, kept, META_KEY)
    if (held.expiresAt - 60_000 > now) return held.token
  }
  const jwt = await serviceJwt(serviceAccount(env), SCOPE, now)
  const response = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  })
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string }
  if (!response.ok || !body.access_token) throw new Error(`Google would not let the Worker send push: ${body.error_description ?? response.status}`)
  held = { token: body.access_token, expiresAt: now + (body.expires_in ?? 3600) * 1000 }
  await store.putMeta(META_KEY, await sealJson(env, held, META_KEY), held.expiresAt)
  return held.token
}

export interface Push {
  title: string
  body: string
  /** A newer push with the same tag replaces the older one on the phone. */
  tag: string
  /** What a tap opens: kind is 'classroom', 'inbox', 'task' or 'today'; id the record or task. */
  data: Record<string, string>
  /** Shows nothing: only wakes the phone's widget to draw itself again (data only, so the app's code runs). */
  silent?: boolean
}

/**
 * Follows the notifications of a check, so the home-screen widget redraws
 * with its counts even while Cairn is closed. Normal priority: it can wait
 * until the phone wakes, which is when the widget is seen anyway.
 */
export function widgetPush(classroom: number, mail: number): Push {
  return { title: '', body: '', tag: 'widget', data: { kind: 'widget', classroom: String(classroom), mail: String(mail) }, silent: true }
}

/** The phone's notification channels; the app creates them. */
const CHANNEL = { inbox: 'inbox', digest: 'digest' } as const

/**
 * Sends one notification to each of the person's phones. A token FCM no
 * longer knows (the app was uninstalled) is forgotten. Returns how many were
 * delivered.
 */
export async function sendPush(env: Env, store: Store, fetchFn: FetchFn, tokens: readonly string[], push: Push, now: number): Promise<number> {
  if (tokens.length === 0) return 0
  const project = serviceAccount(env).project_id ?? env.FIREBASE_PROJECT_ID
  const access = await accessToken(env, store, fetchFn, now)
  let sent = 0
  for (const token of tokens) {
    const response = await fetchFn(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: push.silent
          ? { token, data: push.data, android: { priority: 'normal' } }
          : {
              token,
              notification: { title: push.title, body: push.body },
              data: push.data,
              android: {
                priority: 'high',
                notification: { tag: push.tag, channel_id: push.data.kind === 'today' || push.data.kind === 'task' ? CHANNEL.digest : CHANNEL.inbox },
              },
            },
      }),
    })
    if (response.ok) {
      sent++
      continue
    }
    const text = await response.text().catch(() => '')
    if (response.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) await store.deletePush(token)
    else console.warn('FCM refused a push', response.status, text.slice(0, 200))
  }
  return sent
}
