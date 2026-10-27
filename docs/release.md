# Releasing Cairn

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`. It builds the
Android APK and the Windows installer, signs both, and publishes them to a
GitHub Release under names that never change:

| File | What it is |
|---|---|
| `Cairn-android.apk` | The phone app, arm64-v8a and x86_64, signed with your upload key |
| `Cairn-windows-setup.exe` | The NSIS installer, per-user, no admin rights |
| `Cairn-windows-setup.exe.sig` | Its updater signature |
| `latest.json` | What the desktop app's updater reads |
| `SHA256SUMS.txt` | Checksums of the above |

Because the names are fixed, `https://github.com/Vishalk1604/Cairn/releases/latest/download/<name>`
is always the newest file. The site's download buttons, the desktop updater and
the phone's update check all rely on that.

Before the first release you need two keys and a handful of repository
secrets. Make the keys on your own computer, keep them somewhere safe and
backed up, and never commit them: `.gitignore` already refuses `*.jks`,
`*.keystore` and `*.key`.

## 1. The Android upload key

Android installs an update only over an app signed with the same key, so
every release must be signed with this one key, for good. Lose it and
everyone has to uninstall Cairn before installing the next version.

With a JDK installed (Android Studio includes one), in a folder outside the
repository:

```sh
keytool -genkeypair -v -keystore cairn-upload.jks -alias cairn \
  -keyalg RSA -keysize 4096 -validity 10000
```

It asks for a keystore password and your name; use the same password for the
key when asked, or note both. Then turn the keystore into one line of base64
for GitHub:

```sh
base64 -w0 cairn-upload.jks > cairn-upload.jks.b64          # Linux
base64 -i cairn-upload.jks | tr -d '\n' > cairn-upload.jks.b64   # macOS
```

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("cairn-upload.jks")) | Set-Content cairn-upload.jks.b64   # Windows
```

**Version 0.2.0 was not signed with this key.** It was built with Expo's
default, the debug key of the machine that built it, so Android will refuse to
install 0.3.0 over it ("App not installed" / "package conflicts"). Uninstall
0.2.0 once, then install 0.3.0. Sign in again afterwards: everything that had
synced comes back from the cloud. Notes kept only on a phone that was never
signed in go with the uninstall, so sign in on 0.2.0 first. From 0.3.0 on,
updates install over the top.

## 2. The desktop updater key

The desktop app only installs an update signed with this key. From the
repository root:

```sh
pnpm --filter @cairn/desktop exec tauri signer generate -w ~/.tauri/cairn-updater.key
```

It asks for a password and writes two files:

- `~/.tauri/cairn-updater.key`: the private key. It goes into a secret, below.
- `~/.tauri/cairn-updater.key.pub`: the public key. Paste its contents (one
  long line) into `apps/desktop/src-tauri/tauri.conf.json` as
  `plugins.updater.pubkey`, replacing the placeholder, and commit that change.
  The release workflow stops if the placeholder is still there.

Lose the private key and the copies already installed can no longer update
themselves; people would have to download the next installer by hand.

## 3. Repository secrets

On GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, or with the GitHub CLI from the folder holding the files:

| Secret | Value |
|---|---|
| `GOOGLE_SERVICES_JSON` | The contents of `apps/mobile/google-services.json`, from Firebase (see apps/worker/README.md) |
| `ANDROID_KEYSTORE_BASE64` | The contents of `cairn-upload.jks.b64` |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `cairn`, or the alias you chose |
| `ANDROID_KEY_PASSWORD` | The key's password (often the same as the keystore's) |
| `TAURI_SIGNING_PRIVATE_KEY` | The contents of `~/.tauri/cairn-updater.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | The password you gave `tauri signer generate` |

```sh
gh secret set GOOGLE_SERVICES_JSON < apps/mobile/google-services.json
gh secret set ANDROID_KEYSTORE_BASE64 < cairn-upload.jks.b64
gh secret set ANDROID_KEYSTORE_PASSWORD
gh secret set ANDROID_KEY_ALIAS --body cairn
gh secret set ANDROID_KEY_PASSWORD
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/cairn-updater.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Delete `cairn-upload.jks.b64` afterwards; keep `cairn-upload.jks` and the
`.tauri` keys backed up, for example in a password manager.

## 4. Does the release key's SHA-1 matter?

Not for signing in, any more. Both apps sign in through Cairn's Worker: the
phone opens the Worker's Google sign-in in the browser and is sent back to the
app through its own scheme, and the Worker uses the **Web** OAuth client. No
Android OAuth client, and so no SHA-1, is involved. Push needs only
`google-services.json`, which does not depend on the signing key either.

So nothing has to change in Google Cloud. If an OAuth client of type
**Android** was made for Cairn earlier, it is unused and can be left or
deleted.

In Firebase (**Project settings → Your apps → the Android app**), adding the
upload key's SHA-1 and SHA-256 is optional and harmless. It would only matter
if a Firebase feature that checks the app's signature were added later, such
as App Check. To print them:

```sh
keytool -list -v -keystore cairn-upload.jks -alias cairn
```

## 5. Cutting a release

1. Set the version everywhere. The workflow refuses a tag that disagrees with
   any of these:
   - `package.json`, `apps/mobile/package.json`, `apps/desktop/package.json`
   - `apps/mobile/app.json`: `expo.version`, and raise `android.versionCode` by one
   - `apps/desktop/src-tauri/tauri.conf.json` and `apps/desktop/src-tauri/Cargo.toml`
     (and run `cargo check` there, or let a build update `Cargo.lock`)
2. Commit, then tag and push the tag:

   ```sh
   git tag v0.3.0
   git push origin v0.3.0
   ```

3. Watch **Actions → Release**. In about twenty minutes the release appears
   with its files, notes generated from the commits since the last tag.

If a run fails, fix the cause, delete the tag (`git push --delete origin
v0.3.0`, `git tag -d v0.3.0`) and any half-made release, and tag again.

## What the workflow checks

- The tag matches every version above, and the updater has a real public key.
- The APK is signed with your upload key, not a debug key.
- `latest.json` points at the installer on that release, with its signature.

The phone checks `api.github.com/repos/Vishalk1604/Cairn/releases/latest` at
most once a day and offers the new APK in Settings → About. The desktop app
reads `latest.json` a minute after launch and daily, and offers **Update to
x.y.z** in Settings → About; the installer closes Cairn and opens the new one.
