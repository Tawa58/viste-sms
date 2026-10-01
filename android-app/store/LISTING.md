# Google Play listing — Viste SMS

Everything needed to publish on Google Play. Upload `Viste-SMS-<version>.aab` from the GitHub
release `android-v<version>` (built and signed by GitHub Actions).

## App details

| Field | Value |
|---|---|
| App name (30) | Viste SMS |
| Package | `school.viste.sms` |
| Category | Education |
| Contains ads | No |
| In-app purchases | No |
| Target audience | 13+ (students, parents, staff). Not designed for children under 13. |
| App icon (512×512) | `store/play-store-icon-512.png` |
| Feature graphic (1024×500) | Still needed — school logo on white with "Viste High School Management System". |
| Phone screenshots (2–8) | Still needed — login, dashboard, attendance, results (take on a phone after installing). |

### Short description (80)

Viste High School: attendance, results, fees and class tools in one app.

### Full description (4000)

Viste SMS is the official school management app for Viste High School.

Staff, students and parents sign in with their existing Viste SMS account to:

• Mark daily class registers and view attendance
• Enter marks and view month-end and term results
• Write class teacher report comments and keep the duty roster
• See fee invoices, payments and balances
• Manage students, classes, subjects and staff (administrators)
• Print registers and portal slips, and download reports as PDF or CSV

Students sign in with their student number and the monthly portal code issued by the school.

The app works on phones and tablets and stays up to date automatically with the school system.

## App content answers (Play Console → Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy URL | **Required** — publish the school's privacy policy page and paste its URL. |
| App access | Restricted: provide a reviewer login (a test staff account) in Play Console. |
| Ads | No ads |
| Content rating | Complete the IARC questionnaire: education app, no violence, no user-to-user public chat. |
| Data safety | Collects: name, email, phone (account management); student records and results (app functionality). Encrypted in transit (HTTPS). Not shared with third parties. Users can request deletion through the school. |
| Government / financial features | None |

## Account requirements

- Google Play developer account: https://play.google.com/console/signup — US$25 once.
- Personal accounts created after Nov 2023 must run a **closed test with at least 12 testers for
  14 days** before production. Registering as an **organization** (needs a D-U-N-S number for the
  school) skips this.
- Opt in to **Play App Signing** when creating the app and upload the AAB. Keep the upload key
  (`%USERPROFILE%\.viste-sms\viste-sms-release.jks`) safe — it signs every future update.
