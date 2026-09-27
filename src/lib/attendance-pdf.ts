import type { AttendanceStatus, Student } from '@/types'
import { printHtmlInApp } from '@/lib/native-app'
import { fullName } from '@/lib/utils'

type PdfRow = {
  student: Student
  status: AttendanceStatus
}

/** Opens a print-ready register window (browser → Save as PDF). */
export function downloadAttendanceRegisterPdf(opts: {
  schoolName?: string
  className: string
  date: string
  teacherName?: string
  submittedAt?: string
  rows: PdfRow[]
}) {
  const school = opts.schoolName ?? 'Viste High School'
  const present = opts.rows.filter((r) => r.status === 'PRESENT' || r.status === 'LATE').length
  const absent = opts.rows.filter((r) => r.status === 'ABSENT').length
  const total = opts.rows.length
  const pct = total ? Math.round((present / total) * 100) : 0

  const bodyRows = opts.rows
    .map((r, i) => {
      const name = fullName(r.student)
      const mark = r.status === 'PRESENT' || r.status === 'LATE' ? 'Present' : 'Absent'
      return `<tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(r.student.studentNumber || r.student.admissionNumber || '')}</td>
        <td class="${mark === 'Present' ? 'ok' : 'bad'}">${mark}</td>
      </tr>`
    })
    .join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Daily register — ${escapeHtml(opts.className)} — ${escapeHtml(opts.date)}</title>
  <style>
    body { font-family: Georgia, 'Times New Roman', serif; color: #111; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; font-weight: normal; margin: 0 0 16px; color: #444; }
    .meta { font-size: 12px; margin-bottom: 16px; line-height: 1.5; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
    th { background: #f3f3f3; }
    .ok { color: #0a7a3e; font-weight: 600; }
    .bad { color: #b42318; font-weight: 600; }
    .summary { margin-top: 16px; font-size: 13px; }
    @media print {
      body { margin: 12mm; }
      button { display: none !important; }
    }
  </style>
</head>
<body>
  <button onclick="window.print()" style="margin-bottom:12px;padding:8px 12px;">Print / Save as PDF</button>
  <h1>${escapeHtml(school)}</h1>
  <h2>Daily attendance register</h2>
  <div class="meta">
    <div><strong>Class:</strong> ${escapeHtml(opts.className)}</div>
    <div><strong>Date:</strong> ${escapeHtml(opts.date)}</div>
    ${opts.teacherName ? `<div><strong>Marked by:</strong> ${escapeHtml(opts.teacherName)}</div>` : ''}
    ${opts.submittedAt ? `<div><strong>Submitted:</strong> ${escapeHtml(opts.submittedAt)}</div>` : ''}
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>Name &amp; surname</th><th>Student no.</th><th>Mark</th></tr>
    </thead>
    <tbody>${bodyRows}</tbody>
  </table>
  <div class="summary">
    Present: <strong>${present}</strong> ·
    Absent: <strong>${absent}</strong> ·
    Total: <strong>${total}</strong> ·
    Attendance: <strong>${pct}%</strong>
  </div>
  <script>window.onload = function () { setTimeout(function () { window.print(); }, 250); };</script>
</body>
</html>`

  if (printHtmlInApp(html, `attendance-${opts.className}-${opts.date}`)) return

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    // Popup blocked — force download of HTML the user can open/print
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance-${opts.className}-${opts.date}.html`
    a.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
