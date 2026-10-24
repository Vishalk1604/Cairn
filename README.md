# Cairn

**Your inbox has deadlines in it. Cairn finds them.**

Cairn is a notes and reminders app for Android and Windows. It keeps your next deadline visible on your phone's home screen and on your desktop, syncs between the two, and can optionally read your Gmail and Google Classroom to turn assignments and due dates into reminders before you have to.

A cairn is a stack of stones left on a trail to mark the way for whoever comes next. A reminder is the same thing: a marker you leave for your future self.

> **Status:** early access. Version 0.2.0 is out for Android and Windows — see [Installing](#installing). Still young; see the [roadmap](#roadmap).

## Features

Planned for v1:

- **Notes and reminders** with due dates, priority, tags, and recurrence. Snooze, complete, and everything works offline.
- **Natural-language capture.** Type `submit DBMS assignment friday 6pm` and get a correctly dated reminder without touching a date picker.
- **Android home-screen widget** showing today's items, color-coded by urgency, tap to complete.
- **Windows desktop widget.** A frameless, translucent panel that lives on your desktop, plus a global quick-capture hotkey (`Ctrl+Shift+Space`).
- **Sync** between phone and desktop through your Google account.
- **Gmail triage** (optional). Sorts incoming mail into important and not, tells you why, and learns from your corrections.
- **Google Classroom** (optional). New assignments and announcements show in the inbox; one tap makes a reminder with the right due date, and it ticks itself off when you submit.
- **Classroom files** (Windows, optional). Pick which of your classes to save, newest classes listed first. Notes, slides and worksheets their teachers attach are saved to a folder you choose, a folder per class, and each new one as it is posted. Google Docs and Slides arrive as PDF.
- **Recycle bin.** Deleted notes wait in **Settings → Recycle bin** for 30 days, then are deleted for good everywhere, their photos and recordings included.

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

Cairn is designed so that your email never passes through a server we run.

- Gmail and Classroom are read **on your device**, directly from Google. Only the outcome (for example, "a reminder due Friday") is synced.
- Gmail access is requested only when you turn on mail reading, and is read-only.
- Google tokens live in the OS keystore (Android Keystore, Windows DPAPI) and are never synced.
- AI sorting uses NVIDIA's hosted models with **your own API key**, sent straight from your phone. Without a key, mail is checked by fixed rules on the device and nothing goes to an AI service. See [AI sorting](#ai-sorting).

## AI sorting

The Android app can sort your mail and Classroom posts with AI: it picks out what matters to you, files each one into a folder it names itself (Hackathons, Jobs, and so on), tags it (`#hackathon #sih`, `#assignment #cs301`), writes a one-line summary, and reads off any deadline or event time. **Add as task** then puts it in Tasks at exactly that time, with those tags. Tell it what matters under **Settings → AI sorting → What matters to you**; marking a sender Important or Not important overrules it from then on. It is off until you add a key, and **every person uses their own key** — Cairn never ships one, so no one's mail goes through anyone else's account and no single key's rate limit is shared.

To turn it on:

1. Sign in to Cairn on your phone with Google, and switch on mail reading in **Settings**.
2. In **Settings → AI sorting**, tap **Add an NVIDIA API key**, then **Open the NVIDIA page**. It opens the GPT-OSS 20B page on [build.nvidia.com](https://build.nvidia.com/openai/gpt-oss-20b).
3. Sign in to NVIDIA (a free developer account) and press **Get API Key**, then **Generate Key**. Copy the key it shows: it starts with `nvapi-`. NVIDIA only shows it once, so keep a copy somewhere safe.
4. Paste it into the box in Cairn. Sample code from that page works too, as long as your key is written into it. Code that reads the key from a setting called `NVIDIA_API_KEY` has no key in it to find, and Cairn says so.
5. Tap **Check and save**. Cairn finds the key (and the model, if you pasted code), sends one tiny test request, and says which model answered. On NVIDIA's free tier that answer can take a minute or two to arrive.

The key is kept in the phone's secure storage and is only ever sent to NVIDIA. Cairn asks OpenAI's GPT-OSS 20B through NVIDIA's Responses API, and falls back to Nemotron 3.5 Lightning on the same key when it is busy. NVIDIA's free tier queues requests, so a reply can take a minute or two; new mail shows in the Inbox straight away and gets its folder and summary when the reply arrives. The free tier allows about 40 requests a minute per key, far more than one person's mail needs. **Remove key** in the same place turns AI sorting off.

## Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript, with a little Kotlin (Android widget) and Rust (desktop shell) |
| Monorepo | pnpm workspaces + Turborepo |
| Android | Expo (development build) + React Native, Jetpack Glance widget |
| Windows | Tauri v2 + React + Vite |
| Website | Next.js on Cloudflare Pages |
| Auth and sync | Firebase Auth (Google sign-in, PKCE) + Firestore, behind a repository interface |
| Push | Firebase Cloud Messaging, relayed through a Cloudflare Worker |
| Server jobs | Cloudflare Workers with cron triggers |
| AI | OpenAI's GPT-OSS 20B on NVIDIA (Responses API), Nemotron as a fallback; client-side, each person's own key |
| Dates | `chrono-node`, `rrule` |

## Repository layout

```
apps/
  mobile/     Expo + React Native (Android), Kotlin widget module
  desktop/    Tauri v2 + React; Rust for tray, hotkey, autostart
  web/        Next.js marketing site
  workers/    Cloudflare Workers: push relay, reminder sweeper, releases proxy
packages/
  core/       Domain models, reminder engine, recurrence, natural-language parsing
  sync/       Repository interfaces + Firestore implementation
  intel/      Email rules engine, Gemini client, feedback store, Classroom extractors
  ui/         Design tokens and shared primitives
```

`core` and `intel` have no platform imports (no React, Firebase, `fs`, or `window`), so they run identically in Node, Hermes, and WebView2 and can be unit-tested without a device.

## Roadmap

- [ ] **Phase 0: Foundations.** Monorepo scaffold, design tokens, Google Cloud and Firebase projects, privacy policy and terms.
- [x] **Phase 1: Local core.** Reminder engine, natural-language capture, Android and Windows apps working offline with no sync.
- [ ] **Phase 2: Identity and sync.** Google sign-in, Firestore sync with offline persistence, tested security rules.
- [ ] **Phase 3: Widgets.** Android Glance widget and the desktop widget mode.
- [ ] **Phase 4: Distribution.** CI builds, GitHub Releases, auto-update, and the download site.
- [ ] **Phase 5: Gmail intelligence.** Rules engine, Gemini classification, Notifications tab, feedback loop.
- [ ] **Phase 6: Classroom.** Extraction from Classroom notification emails first, then the Classroom API with auto-complete on submission.
- [ ] **Phase 7: Beta and polish.** Real users, accessibility pass, onboarding.

## Installing

Download both from the [Releases](https://github.com/Vishalk1604/Cairn/releases) page.

**Android** (7.0 or newer): download `Cairn-<version>.apk` on your phone and open it. Android asks once to allow installs from your browser or file manager; allow it, then install. Updates install over the top, keeping your notes.

**Windows** (10 or 11): run `Cairn-<version>-setup.exe`. It installs for your account only, without admin rights. The installer is not code-signed, so SmartScreen warns about an unknown publisher: choose **More info → Run anyway**.

Cairn on Windows lives in the system tray, next to the clock:

- Click the tray icon to show or hide the widget. Right-click it for the full app, quick capture, **Start with Windows**, and **Quit**.
- Closing the widget only hides it, so reminders keep firing. **Quit** in the tray menu is what really exits.
- `Ctrl+Shift+Space` brings up the capture box from anywhere.

**Signing in.** Sign in with the same Google account on both, and notes and tasks sync between them. Google shows **"Google hasn't verified this app"** because Cairn is a small personal project that has not been through Google's paid review; choose **Advanced → Go to Cairn** to continue. For the same reason, Google limits Cairn to its first 100 users.

**Checking a download.** Each release lists SHA-256 checksums in `SHA256SUMS.txt`. On Windows, `Get-FileHash .\Cairn-<version>-setup.exe` prints the one to compare.

## Development

Requires Node 20.19+ and pnpm 10.

```sh
pnpm install
pnpm test          # all packages
pnpm typecheck
pnpm dev:desktop   # desktop UI in a browser, http://localhost:1420
pnpm dev:mobile    # Expo dev server for the Android app
```

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
- Cairn starts as a small frameless widget just above the tray, out of the taskbar; clicking the tray icon shows and hides it. The expand button (or a double click on its title bar, or **Open the full app** in the tray menu) fills the screen with the full app: folders down the side, notes as a grid, tasks opening in a panel beside the list. The widget remembers where you last left it.
- Photos and recordings made on the phone are downloaded from your Drive into a folder you can choose in **Settings → Photos and recordings** (by default `Media` inside Cairn's app data folder). When one is removed on the phone, the copy on the computer goes too. Only Cairn's own files in that folder are ever touched.

On Android, reminders are handed to the system alarm clock ahead of time, so they fire with the app closed and no network. Cairn asks for exact alarms, because without them Android is free to delay a reminder by several minutes while the phone is dozing. It deliberately does not ask for storage or screen-overlay access, which React Native would otherwise request by default.

Date tests run in `America/New_York` so daylight-saving transitions are always exercised.

## License

[MIT](LICENSE)
