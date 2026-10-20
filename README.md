# Cairn

**Your inbox has deadlines in it. Cairn finds them.**

Cairn is a notes and reminders app for Android and Windows. It keeps your next deadline visible on your phone's home screen and on your desktop, syncs between the two, and can optionally read your Gmail and Google Classroom to turn assignments and due dates into reminders before you have to.

A cairn is a stack of stones left on a trail to mark the way for whoever comes next. A reminder is the same thing: a marker you leave for your future self.

> **Status:** early development. Nothing is ready to install yet. See the [roadmap](#roadmap).

## Features

Planned for v1:

- **Notes and reminders** with due dates, priority, tags, and recurrence. Snooze, complete, and everything works offline.
- **Natural-language capture.** Type `submit DBMS assignment friday 6pm` and get a correctly dated reminder without touching a date picker.
- **Android home-screen widget** showing today's items, color-coded by urgency, tap to complete.
- **Windows desktop widget.** A frameless, translucent panel that lives on your desktop, plus a global quick-capture hotkey (`Ctrl+Shift+Space`).
- **Sync** between phone and desktop through your Google account.
- **Gmail triage** (optional). Sorts incoming mail into important and not, tells you why, and learns from your corrections.
- **Google Classroom** (optional). Assignments and quizzes become reminders with the right due date, and tick themselves off when you submit.

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
- Gmail access is requested only when you open the Notifications tab, and starts with the narrowest scope that works: `gmail.metadata`, which covers headers and labels but not message bodies.
- Google tokens live in the OS keystore (Android Keystore, Windows DPAPI) and are never synced.
- AI classification uses Google Gemini with **your own API key**. Cairn is fully usable without one, using rules only.

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
| AI | Gemini, client-side, rules first |
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

Not available yet. APK and EXE builds will be published on the [Releases](https://github.com/Vishalk1604/Cairn/releases) page.

Two things to know ahead of time. The Windows build will be unsigned, so SmartScreen will show a warning (choose **More info → Run anyway**); every release will list a SHA-256 checksum so you can verify the file. And the Gmail features will open to a limited group of testers first, because Google caps unverified apps that read Gmail at 100 users.

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
```

Both apps are written once and hosted twice. The desktop UI talks to a small platform interface (storage, notifications, the global hotkey, the tray); a browser implementation makes the whole app runnable and testable in any browser, and the Tauri implementation supplies the real thing. The Android app can also be opened in a browser (`pnpm --filter @cairn/mobile web`) for quick checks, though its notifications need a device build.

Things worth knowing about the desktop app:

- Closing the window hides Cairn in the notification area so reminders keep firing. **Quit** in the tray menu is what actually exits.
- The tray icon is drawn in Rust and takes the colour of your most urgent reminder. Its colours are checked against the shared design tokens by a test, so they cannot drift.
- `Ctrl+Shift+Space` jumps to the capture box from anywhere. If another app already owns that combination, Cairn says so and the tray menu still works.

Date tests run in `America/New_York` so daylight-saving transitions are always exercised.

## License

[MIT](LICENSE)
