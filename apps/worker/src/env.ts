/** What the Worker is given: its database, its own address, and the secrets set with `wrangler secret put`. */
export interface Env {
  DB: D1Database
  /** This Worker's own https address, without a trailing slash. */
  PUBLIC_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  FIREBASE_API_KEY: string
  FIREBASE_PROJECT_ID: string
  /** A service account's JSON key, for sending push through FCM. */
  FCM_SERVICE_ACCOUNT: string
  /** 32 random bytes, base64. Seals every token and key at rest, and signs what passes through a browser. */
  ENC_KEY: string
}

/** Google allows an unverified app with Gmail access a hundred people; Cairn stops there too. */
export const USER_LIMIT = 100

/** The phone's Android package, which is also the scheme it is sent back to after signing in. */
export const APP_SCHEME = 'io.github.vishalk1604.cairn'
