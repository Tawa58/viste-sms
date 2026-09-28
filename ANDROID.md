# Viste SMS — Android app

The Android app (`android-app/`) is a [Capacitor 8](https://capacitorjs.com) shell around the live
web app at https://viste-sms.vercel.app. Every feature, screen and permission is the web app's own:
the same Firebase login, data and roles. Web changes deployed to Vercel reach the app immediately,
so you only rebuild the APK when the native shell (icon, name, Android behaviour) changes.

The `mobile/` folder is an unrelated Expo template and is not used by this app.

## What the native shell adds

| Area | Behaviour |
|---|---|
| Layout | The page is kept between the status bar / camera cutout and the navigation bar, and above the keyboard while typing, so nothing is hidden or overlapped on any phone or tablet. Text renders at the web app's own scale so enlarged system fonts cannot break layouts. |
| System bars | White with dark icons; switch to the dark header colour when the app's dark theme is on. |
| Printing | Registers and portal slips open the Android print dialog (print or *Save as PDF*). |
| Downloads | PDF/CSV reports, teacher logins and files are saved to `Downloads/Viste SMS` and opened. |
| Offline | A branded "Can't reach Viste SMS" page that reconnects automatically. |
| Back button | Goes back through app pages; exits from the first page. |
| Icon & splash | The school logo on white, scaled to fit fully inside every launcher shape and the Android 12+ splash circle. |
| Security | Loads only the Viste SMS site over HTTPS; other links open in the browser. The native bridge (`window.VisteAndroid`, see `src/lib/native-app.ts`) only answers the Viste SMS site. App data is excluded from cloud backup. No secrets or service-account keys are in the app. |

## Install from the website (recommended for users' phones)

The website is an installable web app (PWA). On any Android phone with Chrome — or an iPhone with
Safari — users open https://viste-sms.vercel.app and tap **Install app** (under the sign-in form, or
in the user menu after signing in). Chrome installs Viste SMS with the school logo, full screen,
signed by Google: no APK file, no "unknown apps" setting, no Play Protect warning, automatic updates.

- Phone-maker and in-app browsers that cannot install apps show "open this page in Chrome" with a
  copy-link button; iPhones show the Share → Add to Home Screen steps.
- `public/sw.js` only serves `public/offline.html` when a page cannot load; it never caches school
  data. Icons live in `public/pwa/` (regenerate with `npm run android:icons`).

## Install the APK directly

1. Get `Viste-SMS-<version>.apk` from the GitHub release `android-v<version>`
   (https://github.com/Tawa58/viste-sms/releases) or from `android-app/release/` after a local build.
2. Copy or download it to the phone and tap it. Allow *Install unknown apps* for the browser/file
   manager when Android asks.
3. Open **Viste SMS** and sign in as usual.

Updates: install the newer APK over the old one (same signing key) — users stay signed in.

## Build locally

Requirements: Node 22+, JDK 21 and the Android SDK (platform 36, build-tools 36). Android Studio
installs both; set `JAVA_HOME` and `ANDROID_HOME` if building from the command line.

```bash
npm run android:install   # once
npm run android:apk       # signed release APK -> android-app/release/Viste-SMS-<version>.apk
npm run android:open      # open the project in Android Studio (emulators, debugging)
npm run android:icons     # regenerate icons/splash after changing public/viste-logo.png
```

`npm --prefix android-app run apk:debug` builds a debug APK without the release key.

## Signing key (keep it safe)

Android only installs an update if it is signed with the **same key** as the installed app.

- Key store: `%USERPROFILE%\.viste-sms\viste-sms-release.jks` (alias `viste-sms`).
- Passwords: `%USERPROFILE%\.viste-sms\keystore.properties`. A copy sits in
  `android-app/android/keystore.properties` for local builds; it is git-ignored.
- Back both files up somewhere private (e.g. the school's password manager). Never commit them.

For GitHub builds add these repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\.viste-sms\viste-sms-release.jks"))` |
| `ANDROID_KEYSTORE_PASSWORD` | `storePassword` from `keystore.properties` |
| `ANDROID_KEY_ALIAS` | `viste-sms` |
| `ANDROID_KEY_PASSWORD` | `keyPassword` from `keystore.properties` |

## Releasing a new version

```bash
npm run android:version -- patch    # 1.0.0 -> 1.0.1 (versionCode 10001)
git add android-app/package.json
git commit -m "Android v1.0.1"
git tag android-v1.0.1
git push origin main --follow-tags
```

`.github/workflows/android-release.yml` builds the signed APK and publishes release
`android-v1.0.1`. Android releases are never marked *Latest*, so the Windows app's auto-updater keeps
following the desktop `vX.Y.Z` releases. Pushes that touch `android-app/` build a debug APK artifact.

Rollback: phones cannot install a lower `versionCode`, so ship the old code as a new, higher version
(e.g. revert, then release `1.0.2`).
