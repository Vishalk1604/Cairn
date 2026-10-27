# Cairn's Worker

A small server on Cloudflare's free Workers plan. It is the only place Cairn
keeps Google refresh tokens and NVIDIA keys, and it does the reading for
everyone:

- **Every 10 minutes** a cron trigger checks each person's connected accounts:
  new Gmail (never Spam or Trash) and new Classroom coursework and
  announcements. It writes a record of each to that person's Firestore inbox,
  sorts new mail with their own NVIDIA key, makes tasks of Classroom posts when
  they asked for that, ticks coursework tasks off on hand-in, and sends push
  notifications through FCM: new coursework, announcements, important mail,
  "due tomorrow" at 8 pm, "due today" at 7 am and a "Today" summary at 8 am, on
  the person's own clock.
- **Sign-in** for both apps runs through it as a confidential Google Web
  client. The apps get only a one-time code, which they trade (with their own
  PKCE verifier) for the Google ID token that signs them in to Firebase.
- **Devices** call it with their Firebase ID token for short-lived Google access
  tokens narrowed to one job (Drive for photos, Classroom files on the
  desktop), to check now, to store the AI key, to manage accounts and to
  register for push.

It writes to Firestore as the person (a Firebase session from their own Google
account), so the security rules in `firestore.rules` apply to it as to anyone.

Everything it keeps is in Cloudflare D1, sealed with AES-GCM under the
`ENC_KEY` secret: refresh tokens, AI keys, the text of mail waiting for the
model. Where reading has got to is in D1 too; a copy of when it last checked
is written to `users/{uid}/settings/reader` for the apps to show.

## How it fits the free plan

A free Worker gets 10 ms of CPU, 50 requests out and 6 open connections per
invocation. So the cron checks nobody itself: it calls this Worker's own
address in six groups, each group fans out again, and each person's check is a
request of its own (three levels deep for 100 people). The
`global_fetch_strictly_public` flag in `wrangler.toml` is what lets a Worker
call its own address. Each check reads at most 8 new emails and 4 courses per
account and asks the model at most 6 questions; whatever does not fit waits
ten minutes for the next run. Waiting on Google or NVIDIA costs no CPU.

## One-time setup

You need Node 20+, pnpm, and this repository installed (`pnpm install` at the
root). Run the `wrangler` commands from `apps/worker`. Nothing below asks for a
card: Cloudflare's Workers and D1 free plans and Firebase's Spark plan are
enough.

### 1. Cloudflare

1. Create a free account at <https://dash.cloudflare.com/sign-up>.
2. Open **Workers & Pages** once, so Cloudflare gives you a `workers.dev`
   subdomain (shown on that page, e.g. `yourname.workers.dev`).
3. Log in from this folder:

   ```sh
   cd apps/worker
   pnpm exec wrangler login
   ```

4. Create the database and copy the `database_id` it prints into
   `wrangler.toml`, replacing `REPLACE-WITH-YOUR-D1-DATABASE-ID`:

   ```sh
   pnpm exec wrangler d1 create cairn
   ```

5. Create the tables:

   ```sh
   pnpm exec wrangler d1 migrations apply cairn --remote
   ```

6. In `wrangler.toml`, set `PUBLIC_URL` to
   `https://cairn-worker.<your-subdomain>.workers.dev` (the Worker is named
   `cairn-worker`). If you are not sure of it, deploy once (step 6 below),
   copy the address `wrangler deploy` prints, set it, and deploy again.

### 2. Google Cloud (project `cairn-vishalk`)

Open <https://console.cloud.google.com/> with the `cairn-vishalk` project
selected.

1. **APIs & Services → Library**: make sure these are enabled: Gmail API,
   Google Classroom API, Google Drive API, Identity Toolkit API, and Firebase
   Cloud Messaging API.
2. **APIs & Services → Credentials → OAuth 2.0 Client IDs**: open the client
   named **Web client (auto created by Google Service)** — the one Firebase
   made, whose ID Firebase accepts in sign-ins. Under **Authorized redirect
   URIs** add exactly:

   ```
   https://cairn-worker.<your-subdomain>.workers.dev/auth/callback
   ```

   Save, then keep this page open for its **Client ID** and **Client secret**.
3. **OAuth consent screen**: the scopes Cairn asks for are `openid`, `email`,
   `profile`, `drive.file`, `gmail.readonly`, `classroom.courses.readonly`,
   `classroom.coursework.me.readonly`, `classroom.announcements.readonly`, and,
   for Classroom files on the desktop, `drive.readonly` and
   `classroom.courseworkmaterials.readonly`. Add any that are missing.
   **Publishing status must be "In production"** (it can stay unverified): in
   "Testing", Google expires refresh tokens after 7 days and everyone would be
   signed out every week. Unverified, Google shows a warning at sign-in and
   allows 100 people, which is also the Worker's own limit.

### 3. Firebase

Open <https://console.firebase.google.com/> → `cairn-vishalk`.

1. **Authentication → Sign-in method**: Google must be enabled. Its **Web SDK
   configuration** should show the same Web client ID as above.
2. **Project settings → General**: copy the **Web API key**.
3. **Project settings → Service accounts → Generate new private key**. This
   downloads a JSON key for the `firebase-adminsdk` service account, which may
   send FCM messages. Keep it out of the repository; you will delete it after
   step 4.
4. **Project settings → General → Your apps**: if there is no Android app with
   package `io.github.vishalk1604.cairn`, add one (the SHA-1 is not needed for
   push). Download its **google-services.json** and put it at
   `apps/mobile/google-services.json`. It is gitignored. The phone needs it to
   get a push token, and `expo prebuild` refuses to run without it.
5. Deploy the updated security rules (they no longer accept `settings/ai`, or
   a key or token in any settings document):

   ```sh
   pnpm exec firebase deploy --only firestore:rules --project cairn-vishalk
   ```

   (from the repository root, where `firebase.json` is).

### 4. Secrets

From `apps/worker`, set each one; `wrangler` asks for the value, or reads it
from standard input:

```sh
pnpm exec wrangler secret put GOOGLE_CLIENT_ID        # the Web client's ID
pnpm exec wrangler secret put GOOGLE_CLIENT_SECRET    # the Web client's secret
pnpm exec wrangler secret put FIREBASE_API_KEY        # the Web API key
pnpm exec wrangler secret put FIREBASE_PROJECT_ID     # cairn-vishalk
pnpm exec wrangler secret put FCM_SERVICE_ACCOUNT < ~/Downloads/cairn-vishalk-firebase-adminsdk-xxxxx.json
openssl rand -base64 32 | pnpm exec wrangler secret put ENC_KEY
```

Then delete the downloaded service-account file. On Windows without
`openssl`, any 32 random bytes in base64 will do, for example
`[Convert]::ToBase64String((1..32 | % { Get-Random -Max 256 }))` in
PowerShell.

Keep a copy of `ENC_KEY` somewhere safe. If it is lost or changed, nothing the
Worker stored can be opened again and everyone has to sign in on their phone
once more.

### 5. Point the apps at the Worker

Put the Worker's address in `packages/sync/src/worker.ts` (`CAIRN_WORKER_URL`)
so both apps use it. Alternatively set `VITE_CAIRN_WORKER_URL` in
`apps/desktop/.env.local` and `EXPO_PUBLIC_CAIRN_WORKER_URL` when building the
phone app.

The desktop's content security policy already allows `https://*.workers.dev`.
If you put the Worker on a domain of your own instead, add it to `connect-src`
in `apps/desktop/src-tauri/tauri.conf.json`, and use that domain for
`PUBLIC_URL` and the redirect URI too.

### 6. Deploy

```sh
pnpm exec wrangler deploy
```

Check it answers: `curl https://cairn-worker.<your-subdomain>.workers.dev/`
should print `{"name":"Cairn","ok":true}`. `pnpm exec wrangler tail` shows
each run as it happens; the cron fires every ten minutes.

To try the code without deploying, `pnpm exec wrangler deploy --dry-run`
bundles it, and `pnpm test` runs its tests.

### 7. The apps

1. Phone: with `google-services.json` in place, regenerate the native project
   and build: `pnpm --filter @cairn/mobile prebuild`, then
   `pnpm --filter @cairn/mobile android`. Open Cairn and go through the setup:
   sign in, add your college account, choose what to watch, paste your
   NVIDIA code. Allow notifications when asked; that is when the phone
   registers for push.
2. Computer: run or install the desktop app and sign in with the same Google
   account. It shows what the phone set up.

Within ten minutes `settings/reader` in Firestore gets a `checkedAt`, and the
apps say when mail was last checked. If it never does, `wrangler tail` shows
why.

## What it answers

| Request | Who | What |
|---|---|---|
| `GET /auth/start` | browser | Sends the browser to Google, for `want` = `drive`, `mail`, `classroom`, `files` |
| `GET /auth/callback` | Google | Keeps the grant, sends the browser back to the app with a one-time code |
| `POST /auth/exchange` | app | Trades the code and its PKCE verifier for who signed in (and the Google ID token, when signing in) |
| `POST /auth/ticket` | signed in | A 10-minute pass so a second account joins this person |
| `GET /token?account=&purpose=drive\|classroomFiles` | signed in | A short-lived access token for one of the caller's own accounts |
| `POST /sync` | signed in | Checks the caller now |
| `POST /setup/ai` | signed in | Stores, or with `null` forgets, the NVIDIA setup |
| `GET`/`POST`/`DELETE /accounts` | signed in | Lists accounts, changes what is read, disconnects one |
| `POST`/`DELETE /push/register` | signed in | Registers or forgets an FCM token, with the phone's time zone |
| `DELETE /me` | signed in | Stops everything, revokes every grant and deletes what the Worker keeps |

"Signed in" means a Firebase ID token for the project in
`Authorization: Bearer`, checked against Google's securetoken keys.
