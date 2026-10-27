-- One row per person: the Firebase uid their phone and computer sign in as.
-- `ai` and `state` are sealed with ENC_KEY (AES-GCM); nothing here is
-- readable without it.
CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  time_zone TEXT,
  ai TEXT,
  state TEXT,
  running_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Each Google account a person connected: their own, and any they read from.
-- `refresh` is the Google refresh token, sealed.
CREATE TABLE IF NOT EXISTS accounts (
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  sub TEXT NOT NULL,
  role TEXT NOT NULL,
  scopes TEXT NOT NULL,
  refresh TEXT NOT NULL,
  watch_mail INTEGER NOT NULL DEFAULT 1,
  watch_classroom INTEGER NOT NULL DEFAULT 1,
  problem TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (uid, email)
);

-- Short-lived access tokens, sealed, so a run or a device's request does not
-- go back to Google every time.
CREATE TABLE IF NOT EXISTS tokens (
  uid TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (uid, email, purpose)
);

-- Where to send push notifications.
CREATE TABLE IF NOT EXISTS push (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  platform TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS push_uid ON push (uid);

-- One-time codes handed to an app at the end of a sign-in, sealed.
CREATE TABLE IF NOT EXISTS codes (
  code TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Anything else worth keeping between runs, such as the FCM access token.
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
