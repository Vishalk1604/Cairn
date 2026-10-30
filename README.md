# Cairn

**Your inbox has deadlines in it. Cairn finds them.**

Cairn is a notes and reminders app for Android and Windows. It keeps your next deadline visible on your phone's home screen and on your desktop, syncs between the two, and can optionally watch your Gmail and Google Classroom — every ten minutes, even with your phone off — to turn assignments and due dates into reminders before you have to.

A cairn is a stack of stones left on a trail to mark the way for whoever comes next. A reminder is the same thing: a marker you leave for your future self.

> **Status:** early access. Version 0.3.0 is out for Android and Windows — see [Installing](#installing). Still young; see the [roadmap](#roadmap).

## Features

Planned for v1:

- **Notes and reminders** with due dates, priority, tags, and recurrence. Snooze, complete, and everything works offline.
- **Natural-language capture.** Type `submit DBMS assignment friday 6pm` and get a correctly dated reminder without touching a date picker.
- **Android home-screen widget** showing what is late, due soon and due today, color-coded by urgency, with the class's colour for coursework. Tap a circle to complete, a row to open it, + for a new task.
- **Windows desktop widget.** A frameless panel that lives on your desktop and opens on **Today**: what is due next, new Classroom posts, important mail and a line to write in. Plus a global quick-capture hotkey (`Ctrl+Shift+Space`). Switch on **Pin to desktop** and Today also sits on your wallpaper, behind your windows, through Show desktop.
- **Share to Cairn.** Share a link, some text or photos from any Android app and it becomes a note, open for a word before you go back.
- **Sync** between phone and desktop through your Google account.
- **Set up once, on the phone.** A four-step setup — sign in, add your college account, choose what to watch, paste your AI key — and the computer then needs only to sign in with the same account.
- **Gmail triage** (optional). Sorts incoming mail into important and not, tells you why, and learns from your corrections.
- **One inbox on both devices.** Cairn's server, a small Cloudflare Worker, reads every connected account every ten minutes and writes a short summary of each new email to the cloud, so the phone and the computer show the same Inbox, filtered by account. **Sync now** asks it to look straight away.
- **Google Classroom** (optional). New assignments and announcements from every connected account have their own Classroom tab; one tap makes a reminder with the right due date, and it ticks itself off when you submit. Switch on **Automatically add tasks** and they become reminders by themselves, once. Each class has its own colour, which you can change. When a college keeps Classroom's API from apps, Cairn reads Classroom's notification emails instead.
- **Notifications** for new coursework, announcements and important mail as they arrive, what is due tomorrow at 8 pm, what is due today in the morning, and a Today summary at 8 am — pushed to the phone, and shown on the computer while Cairn runs.
- **Classroom files** (Windows, optional). Behind the gear in the Classroom tab, pick which of your classes to save, newest classes listed first. Notes, slides and worksheets their teachers attach are saved to a folder you choose, a folder per class, and each new one as it is posted. Google Docs and Slides arrive as PDF.
- **Recycle bin.** Deleted notes wait in **Settings → Recycle bin** for 30 days, then are deleted for good everywhere, their photos and recordings included. **Delete forever** and **Empty bin** do it at once, on every device, including one that was offline.

Not in v1: iOS, macOS, Linux, shared notes, attachments, two-way calendar sync, location-based reminders.

## Urgency at a glance

One color scale drives the widgets, the tray icon, and the in-app list, so a color means the same thing everywhere:

| State | Color |
|---|---|
| Overdue | Red (slow pulse on the desktop widget) |
| Due within 2 hours | Amber |
| Due today | Yellow |
| Due this week | Blue |
| Later | Grey |
| Done | Green, then fades out |

Each state also has a non-color cue, so the widgets stay readable for colorblind users and on any wallpaper.

## Privacy

- Your notes and tasks are in Firestore, where only your account can read them; photos and recordings are in your own Google Drive.
- Gmail and Classroom are read by **Cairn's server**, a Cloudflare Worker, which is the only place your Google permission is kept — encrypted. Your phone and computer keep only a sign-in to your Cairn account.
- Only the outcome is stored in Firestore: sender, subject, Gmail's short preview, the summary, folder and any deadline — never the message itself. Spam and Trash are never read.
- Gmail access is read-only and asked for only when you choose Gmail.
- AI sorting uses NVIDIA's hosted models with **your own API key**, which the server keeps encrypted and your phone keeps in its secure storage — never in Firestore. Without a key, mail is sorted by fixed rules and nothing goes to an AI service. See [AI sorting](#ai-sorting).
- See the [privacy policy](apps/site/public/privacy.html) for the details.

## AI sorting

Cairn can sort your mail and Classroom posts with AI: it picks out what matters to you, files each one into a folder it names itself (Hackathons, Jobs, and so on), tags it (`#hackathon #sih`, `#assignment #cs301`), writes a one-line summary, and reads off any deadline or event time. **Add as task** then puts it in Tasks at exactly that time, with those tags. Tell it what matters under **Settings → Inbox & AI → What matters to you** on either device; marking a sender Important or Not important overrules it from then on. It is off until you add a key, and **every person uses their own key** — Cairn never ships one, so no one's mail goes through anyone else's account and no single key's rate limit is shared.

To turn it on:

1. On your phone, sign in to Cairn with Google and choose Gmail for an account — the setup walks you through it.
2. In the setup's last step, or **Settings → Inbox & AI**, tap **Add an NVIDIA API key**, then **Open the NVIDIA page**. It opens the GPT-OSS 20B page on [build.nvidia.com](https://build.nvidia.com/openai/gpt-oss-20b).
3. Sign in to NVIDIA (a free developer account) and press **Get API Key**, then **Generate Key**. Copy the key it shows: it starts with `nvapi-`. NVIDIA only shows it once, so keep a copy somewhere safe.
4. Paste it into the box in Cairn. Sample code from that page works too, as long as your key is written into it. Code that reads the key from a setting called `NVIDIA_API_KEY` has no key in it to find, and Cairn says so.
5. Tap **Check and save**. Cairn finds the key (and the model, if you pasted code), sends one tiny test request, and says which model answered. On NVIDIA's free tier that answer can take a minute or two to arrive.

The key goes to Cairn's server, which keeps it encrypted, and to your phone's secure storage; it is never written to Firestore, and it is only ever sent to NVIDIA. The server asks OpenAI's GPT-OSS 20B through NVIDIA's Responses API, and falls back to Nemotron 3.5 Lightning on the same key when it is busy. NVIDIA's free tier queues requests, so a reply can take a minute or two; new mail shows in the Inbox straight away and gets its folder and summary when the reply arrives, at the latest on the server's next check. The free tier allows about 40 requests a minute per key, far more than one person's mail needs. **Remove key** in the same place turns AI sorting off everywhere.

### How the server reads

[`apps/worker`](apps/worker/README.md) is a Cloudflare Worker on the free plan. Every ten minutes its cron checks everyone's connected accounts — each person in a request of their own — and writes what it finds to their Firestore inbox as them, so the same security rules apply. It reads at most a handful of emails and courses per account per check, keeps where it got to in Cloudflare D1, and leaves anything that does not fit, or that the model has not answered yet, for the next check. When it has not checked for 30 minutes, both apps say **Mail checks paused**.

Sign-in on both apps runs through the server too, so it holds the one Google grant: the phone signs in, adds a college account and asks for Gmail or Classroom; the computer only signs in, and asks the server for short-lived tokens to download photos from Drive and, if you turn it on, Classroom files. See the Worker's [README](apps/worker/README.md) for setting it up.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript, with a little Rust (desktop shell) |
| Monorepo | pnpm workspaces + Turborepo |
| Android | Expo (development build) + React Native, home-screen widget with react-native-android-widget |
| Windows | Tauri v2 + React + Vite |
| Website | Static pages on Firebase Hosting |
| Releases | GitHub Actions to GitHub Releases; the desktop updates itself with tauri-plugin-updater |
| Auth and sync | Firebase Auth (Google sign-in, PKCE) + Firestore, behind a repository interface |
| Push | Firebase Cloud Messaging (HTTP v1), sent by the Worker |
| Server jobs | A Cloudflare Worker with a cron trigger and D1, on the free plan |
| AI | OpenAI's GPT-OSS 20B on NVIDIA (Responses API), Nemotron as a fallback; run by the Worker with each person's own key |
| Dates | `chrono-node`, `rrule` |

## Repository layout

```
apps/
  mobile/     Expo + React Native (Android), home-screen widget, config plugins
  desktop/    Tauri v2 + React; Rust for tray, hotkey, autostart
  site/       The public site: home, privacy and terms
  worker/     Cloudflare Worker: sign-in, reading Gmail and Classroom, AI sorting, push
packages/
  core/       Domain models, reminder engine, recurrence, natural-language parsing, mail triage, the day's digests
  sync/       Repository interfaces + Firestore implementation, Google and NVIDIA clients, the Worker's API client
  auth/       OAuth helpers: PKCE, redirects, tokens
  ui/         Shared app logic: the inbox, actions, design tokens
```

`core` has no platform imports (no React, Firebase, `fs`, or `window`), so it runs identically in Node, Hermes, WebView2 and the Worker, and can be unit-tested without a device.

## Roadmap

- [ ] **Phase 0: Foundations.** Monorepo scaffold, design tokens, Google Cloud and Firebase projects, privacy policy and terms.
- [x] **Phase 1: Local core.** Reminder engine, natural-language capture, Android and Windows apps working offline with no sync.
- [ ] **Phase 2: Identity and sync.** Google sign-in, Firestore sync with offline persistence, tested security rules.
- [x] **Phase 3: Widgets.** Android home-screen widget, the desktop widget, and Today pinned to the Windows desktop.
- [x] **Phase 4: Distribution.** CI builds, GitHub Releases, auto-update, and the download site. See [docs/release.md](docs/release.md).
- [ ] **Phase 5: Gmail intelligence.** Rules engine, Gemini classification, Notifications tab, feedback loop.
- [ ] **Phase 6: Classroom.** Extraction from Classroom notification emails first, then the Classroom API with auto-complete on submission.
- [ ] **Phase 7: Beta and polish.** Real users, accessibility pass, onboarding.

## Installing

Download both from the [site](https://cairn-vishalk.web.app) or the [latest release](https://github.com/Vishalk1604/Cairn/releases/latest); the file names never change, so these links always fetch the newest:

- [Cairn-android.apk](https://github.com/Vishalk1604/Cairn/releases/latest/download/Cairn-android.apk)
- [Cairn-windows-setup.exe](https://github.com/Vishalk1604/Cairn/releases/latest/download/Cairn-windows-setup.exe)

**Android** (7.0 or newer): open the APK on your phone. Android asks once to allow installs from your browser or file manager; allow it, then install. Updates install over the top, keeping your notes, and **Settings → About** says when there is one. Coming from 0.2.0, uninstall it once first: it was signed with a different key.

**Windows** (10 or 11): run `Cairn-windows-setup.exe`. It installs for your account only, without admin rights. The installer is not code-signed, so SmartScreen warns about an unknown publisher: choose **More info → Run anyway**. Cairn then updates itself, offering **Update to x.y.z** in **Settings → About**.

Cairn on Windows lives in the system tray, next to the clock:

- Click the tray icon to show or hide the widget. Right-click it for the full app, quick capture, **Start with Windows**, and **Quit**.
- Closing the widget only hides it, so reminders keep firing. **Quit** in the tray menu is what really exits.
- `Ctrl+Shift+Space` brings up the capture box from anywhere.

**Signing in.** Set Cairn up on your phone first, then sign in on the computer with the same Google account: notes, tasks, the inbox and Classroom show on both. Google shows **"Google hasn't verified this app"** because Cairn is a small personal project that has not been through Google's paid review; choose **Advanced → Go to Cairn** to continue. For the same reason, Google limits Cairn to its first 100 users.

**Checking a download.** Each release lists SHA-256 checksums in `SHA256SUMS.txt`. On Windows, `Get-FileHash .\Cairn-windows-setup.exe` prints the one to compare.

## Development

Requires Node 20.19+ and pnpm 10.

```sh
pnpm install
pnpm test          # all packages
pnpm typecheck
pnpm dev:desktop   # desktop UI in a browser, http://localhost:1420 (add ?preview for the signed-in screens with made-up data)
pnpm dev:mobile    # Expo dev server for the Android app
pnpm test:rules    # Firestore security rules, against the emulator (needs Java)
pnpm --filter @cairn/worker exec wrangler deploy --dry-run   # bundle the Worker without deploying
```

The apps talk to Cairn's Worker at the address in `packages/sync/src/worker.ts`; set it, and deploy the Worker, as its [README](apps/worker/README.md) describes. Building the Android app needs `apps/mobile/google-services.json` from the Firebase project (gitignored) for push.

Building the Windows app additionally needs Rust (stable, MSVC toolchain) and the Visual Studio C++ build tools; building the Android app needs the Android SDK with `ANDROID_HOME` and `JAVA_HOME` set.

```sh
pnpm --filter @cairn/desktop app          # run the real desktop app
pnpm --filter @cairn/desktop app:build    # installer in src-tauri/target/release/bundle

pnpm --filter @cairn/mobile prebuild      # generate the native android/ project
pnpm --filter @cairn/mobile android       # build and install on a connected device
```

The `android/` folder is generated from `app.json` and is not in the repository: change the config, not the generated files.

Both apps are written once and hosted twice. The desktop UI talks to a small platform interface (storage, notifications, the global hotkey, the tray); a browser implementation makes the whole app runnable and testable in any browser, and the Tauri implementation supplies the real thing. The Android app can also be opened in a browser (`pnpm --filter @cairn/mobile web`) for quick checks, though its notifications need a device build.

Things worth knowing about the desktop app:

- Closing the window hides Cairn in the notification area so reminders keep firing. **Quit** in the tray menu is what actually exits.
- The tray icon is drawn in Rust and takes the colour of your most urgent reminder. Its colours are checked against the shared design tokens by a test, so they cannot drift.
- `Ctrl+Shift+Space` jumps to the capture box from anywhere. If another app already owns that combination, Cairn says so and the tray menu still works.
- Cairn starts as a small frameless widget just above the tray. It has its own taskbar button, so Alt+Tab, Snap layouts and tiling tools treat it like any other window; clicking the tray icon brings it forward or minimizes it. The expand button (or a double click on its title bar, or **Open the full app** in the tray menu) fills the screen with the full app: folders down the side, notes as a grid, tasks opening in a panel beside the list. The widget remembers where you last left it.
- Photos and recordings made on the phone are downloaded from your Drive, with a short-lived token from the Worker, into a folder you can choose in **Settings → Media** (by default `Media` inside Cairn's app data folder). When one is removed on the phone, the copy on the computer goes too. Only Cairn's own files in that folder are ever touched.

On Android, reminders are handed to the system alarm clock ahead of time, so they fire with the app closed and no network. Cairn asks for exact alarms, because without them Android is free to delay a reminder by several minutes while the phone is dozing. It deliberately does not ask for storage or screen-overlay access, which React Native would otherwise request by default.

Date tests run in `America/New_York` so daylight-saving transitions are always exercised.

## License

[MIT](LICENSE)
