---
format: 1920x1080
duration: 45s
message: "Run your whole school from one app: students, attendance, results, fees and payroll"
arc: Hook → Problem → Solution (dashboard) → Features (students, fees, payroll, finance) → Platforms + CTA
audience: school owners, principals and administrators in Zimbabwe
mode: autonomous
music: none
---

Silent build with bold on-screen copy. The user will supply a music / voiceover file; it gets mounted at the root as the BGM track (`audio_meta.json` → `bgm.path`) and the index is reassembled. No SCRIPT.md, no captions.

## Video direction

- Ground: pale school canvas `#f7f9fb` with a soft navy radial glow and a faint dot grid on cover/closing only.
- Type: Fraunces 600 headlines in near-black `#0f1b26` with one key word in navy `#134a66` underlined by a gold `#e8b931` bar; Manrope 700 teal `#0d8a7f` eyebrows, uppercase; Manrope 600 pill chips.
- Devices: real screenshots inside a dark laptop bezel (`#0f1b26`, 22px radius) with a soft long shadow; each device enters with a 3D tilt settle and keeps a slow push-in for the rest of the frame so nothing freezes.
- Callouts: a navy spotlight ring + white label pill pinned onto real UI regions of the screenshot, revealed on the beat.
- Motion: expo/power3 eases, 0.6–0.9s entrances, staggered chips, no exits (root transitions are the exits). Text alternates left/right of the device frame to frame.

## Frame 1 — Hook

- scene: The school crest pops in with a teal ring drawing around it, then "One app. Your whole school." types in
- duration: 4s
- poster: 3s
- transition_in: cut
- status: animated
- src: compositions/frames/01-hook.html
- asset_candidates: assets/logo.png — Viste Senior Academy crest
- blueprint: compose

Scene 1 (0.0–1.4s): centered crest scales 0.6→1 inside a white circle while a teal ring strokes around it (like the app splash). → Scene 2 (1.4–2.6s): crest slides up; "One app." rises word by word in Fraunces h1. → Scene 3 (2.6–4.0s): "Your whole school." lands in navy with the gold underline wiping in; eyebrow "VISTE SCHOOL MANAGEMENT SYSTEM" fades in above.

## Frame 2 — The problem

- scene: Paper registers, receipt books, spreadsheets and payroll files pile up, then get struck through: "Too many systems."
- duration: 5s
- poster: 4s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/02-problem.html
- asset_candidates: none
- blueprint: compose

Scene 1 (0.0–2.2s): six tilted paper cards (Attendance register, Receipt book, Marks spreadsheet, Payroll file, Fee ledger, WhatsApp groups) drop in one after another around the centre, crowding the frame. → Scene 2 (2.2–3.4s): the cards dim and a red strike line draws across each. → Scene 3 (3.4–5.0s): "Too many systems." punches in centre in Fraunces h1; sub-line "Time lost. Money missed." fades below.

## Frame 3 — Dashboard

- scene: Laptop with the real admin dashboard tilts in; callouts pin the live stats and attendance donut — "Your school at a glance"
- duration: 6s
- poster: 4.5s
- transition_in: zoom-through
- status: animated
- src: compositions/frames/03-dashboard.html
- asset_candidates: assets/screen-dashboard.png — admin dashboard with stats, charts and activity
- blueprint: compose

Scene 1 (0.0–1.2s): laptop enters from the right with rotateY 18°→0 and scale 0.9→1; text column left: eyebrow "MEET VISTE SMS", headline "Your school at a *glance*". → Scene 2 (1.2–3.2s): spotlight ring outlines the stat row (students, teachers, attendance, fees) with label "Live numbers". → Scene 3 (3.2–6.0s): second ring on the 94% attendance donut with label "Today's attendance"; chips "Real-time" and "Every role" stagger in under the headline. Slow 1.0→1.04 push-in throughout.

## Frame 4 — Students

- scene: Student directory in the laptop; chips for enrolment, records, daily check-in and results stack in — "Every student, one place"
- duration: 5.5s
- poster: 4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/04-students.html
- asset_candidates: assets/screen-students.png — students directory with filters and table
- blueprint: compose

Scene 1 (0.0–1.2s): laptop on the left, tilting in from rotateY −16°; text right: eyebrow "STUDENTS & ACADEMICS", headline "Every student, *one place*". → Scene 2 (1.2–3.6s): chips stagger in one per ~0.5s: "Enrolment & profiles", "Daily check-in", "Attendance", "Exams & results". → Scene 3 (3.6–5.5s): spotlight on the filter bar with label "Find anyone in seconds".

## Frame 5 — Fees

- scene: Fees & Payments screen; zoom to the fee structure: ECD to A-Level, day scholar or boarder, termly or monthly — "Fees, sorted"
- duration: 6.5s
- poster: 5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/05-fees.html
- asset_candidates: assets/screen-fees.png — fees page with fee structure and student accounts
- blueprint: compose

Scene 1 (0.0–1.2s): laptop right, text left: eyebrow "FEES & PAYMENTS", headline "Fees, *sorted*". → Scene 2 (1.2–3.6s): spotlight on the Fee structure card, label "ECD → A-Level · Day & Boarder"; chips "Termly or monthly plans", "Receipts & balances". → Scene 3 (3.6–6.5s): spotlight moves to the totals row, label "$6,547 collected"; chip "EcoCash · Bank · Cash".

## Frame 6 — Payroll

- scene: Locked September payroll with payslips; chips for salary scales, deductions, PDF/Excel — "Payroll in minutes"
- duration: 5.5s
- poster: 4s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/06-payroll.html
- asset_candidates: assets/screen-payroll.png — payroll run with payslip buttons
- blueprint: compose

Scene 1 (0.0–1.2s): laptop left, text right: eyebrow "HR & PAYROLL", headline "Payroll in *minutes*". → Scene 2 (1.2–3.4s): chips "Salary scales", "Deductions & rules", "Payslips in one click". → Scene 3 (3.4–5.5s): spotlight on the Locked badge + PDF/Excel buttons, label "Approve · Lock · Export".

## Frame 7 — Finance

- scene: Financial dashboard charts; revenue counter rolls up — "Know where every dollar goes"
- duration: 6s
- poster: 4.5s
- transition_in: push-slide LEFT
- status: animated
- src: compositions/frames/07-finance.html
- asset_candidates: assets/screen-finance.png — financial dashboard with KPI cards and charts
- blueprint: compose

Scene 1 (0.0–1.2s): laptop right, text left: eyebrow "FINANCE", headline "Every dollar, *accounted for*". → Scene 2 (1.2–3.4s): spotlight on the KPI row, a big counter "$52,670" (total revenue shown on screen) rolls up beside the headline. → Scene 3 (3.4–6.0s): spotlight on the Monthly revenue chart, label "Revenue vs expenses"; chip "PDF & Excel reports".

## Frame 8 — Platforms + CTA

- scene: Laptop, Windows desktop window and Android phone fan out; crest + "Viste SMS" + credit pill "Developed by ADIGX — Antonio Digital Innovation Group X"
- duration: 6.5s
- poster: 5.5s
- transition_in: blur-crossfade
- status: animated
- src: compositions/frames/08-cta.html
- asset_candidates: assets/screen-dashboard.png — laptop screen; assets/screen-fees.png — desktop window; assets/screen-splash.png — phone splash; assets/logo.png — crest
- blueprint: compose

Scene 1 (0.0–2.4s): three devices rise in staggered: phone (splash) left, laptop (dashboard) centre, desktop window (fees) right; labels "Android", "Web", "Windows" under each. → Scene 2 (2.4–4.2s): devices ease down and shrink; crest + "Viste SMS" wordmark land above. → Scene 3 (4.2–6.5s): headline "Run your school smarter." and the solid navy credit pill "Developed by ADIGX — Antonio Digital Innovation Group X" pop in; final settle.
