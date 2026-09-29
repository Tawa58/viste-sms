import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'
import type { StudentPortalBundle, StudentResultPeriod } from '@/types'

const BRAND: [number, number, number] = [19, 74, 102]
const LOGO_URL = '/viste-logo.png'

const PERIOD_LABEL: Record<StudentResultPeriod['kind'], string> = {
  TERM: 'Term',
  MONTH: 'Month',
  YEAR: 'Year',
}

export function formatPercent(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

export function formatMark(score: number, maxScore: number) {
  const s = Number.isInteger(score) ? score : score.toFixed(1)
  return `${s}/${maxScore}`
}

async function loadLogo(): Promise<{ data: string; ratio: number } | null> {
  try {
    const res = await fetch(LOGO_URL)
    if (!res.ok) return null
    const blob = await res.blob()
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => resolve(null)
      el.src = data
    })
    if (!img) return { data, ratio: 1 }
    const ratio = img.naturalWidth / Math.max(1, img.naturalHeight)
    const scale = Math.min(1, 320 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return { data, ratio }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return { data: canvas.toDataURL('image/png'), ratio }
  } catch {
    return null
  }
}

/** Builds the official results sheet for one term, month or year and downloads it. */
export async function downloadResultSheetPdf(bundle: StudentPortalBundle, period: StudentResultPeriod) {
  const { school, profile } = bundle
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const issued = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const logo = await loadLogo()
  if (logo) {
    const h = 24
    const w = Math.min(30, h * logo.ratio)
    doc.addImage(logo.data, 'PNG', margin, 10, w, h, undefined, 'FAST')
  }

  doc.setTextColor(...BRAND)
  doc.setFont('helvetica', 'bold')
  let titleSize = 17
  doc.setFontSize(titleSize)
  while (titleSize > 11 && doc.getTextWidth(school.name) > contentWidth - 68) {
    titleSize -= 0.5
    doc.setFontSize(titleSize)
  }
  doc.text(school.name, pageWidth / 2, 18, { align: 'center' })
  doc.setTextColor(70)
  let headerY = 23.5
  if (school.motto) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(school.motto, pageWidth / 2, headerY, { align: 'center' })
    headerY += 4.5
  }
  const contact = [school.address, school.phone, school.email].filter(Boolean).join('  ·  ')
  if (contact) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(contact, pageWidth / 2, headerY, { align: 'center', maxWidth: contentWidth - 40 })
  }

  doc.setDrawColor(...BRAND)
  doc.setLineWidth(0.8)
  doc.line(margin, 38, pageWidth - margin, 38)

  doc.setTextColor(17)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.text('STUDENT RESULTS SHEET', pageWidth / 2, 46, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(80)
  doc.text(`${period.label}  ·  ${period.basis}`, pageWidth / 2, 51.5, { align: 'center' })

  const studentName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ')
  const className = [profile.className, profile.streamName].filter(Boolean).join(' ')
  const info: [string, string][] = [
    ['Student name', studentName],
    ['Reg. number', profile.studentNumber],
    ['Class', className],
    [PERIOD_LABEL[period.kind], period.label],
  ]
  const boxY = 56
  doc.setFillColor(244, 247, 249)
  doc.setDrawColor(220)
  doc.setLineWidth(0.2)
  doc.roundedRect(margin, boxY, contentWidth, 18, 2, 2, 'FD')
  info.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + 4 + col * (contentWidth / 2)
    const y = boxY + 7 + row * 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(100)
    doc.text(`${label}:`, x, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(17)
    doc.text(value || '—', x + 26, y, { maxWidth: contentWidth / 2 - 32 })
  })

  autoTable(doc, {
    startY: boxY + 24,
    head: [['#', 'Subject', 'Mark', '%', 'Grade', 'Subject teacher', "Teacher's comment"]],
    body: period.rows.map((r, i) => [
      String(i + 1),
      r.subject,
      formatMark(r.score, r.maxScore),
      formatPercent(r.percent),
      r.grade,
      r.teacherName ?? '—',
      r.comment ?? '—',
    ]),
    foot: [
      [
        '',
        `Average (${period.rows.length} subject${period.rows.length === 1 ? '' : 's'})`,
        '',
        formatPercent(period.average),
        period.averageGrade ?? '—',
        '',
        '',
      ],
    ],
    styles: { fontSize: 8.5, cellPadding: 2.2, overflow: 'linebreak', valign: 'middle', textColor: [30, 30, 30] },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [236, 241, 244], textColor: [17, 17, 17], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 34 },
      2: { cellWidth: 17, halign: 'center' },
      3: { cellWidth: 15, halign: 'center' },
      4: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
      5: { cellWidth: 30 },
      6: { cellWidth: 'auto' },
    },
    margin: { left: margin, right: margin, bottom: 18 },
  })

  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 9
  const comment = period.classTeacherComment?.trim() || 'No comment recorded.'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  const lines = doc.splitTextToSize(comment, contentWidth - 8) as string[]
  const boxHeight = 10 + lines.length * 4.6
  if (y + boxHeight + 22 > pageHeight - 18) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...BRAND)
  doc.text("Class teacher's comment", margin, y)
  doc.setDrawColor(210)
  doc.setFillColor(252, 252, 252)
  doc.roundedRect(margin, y + 2.5, contentWidth, boxHeight - 2, 2, 2, 'FD')
  doc.setFont('helvetica', period.classTeacherComment ? 'normal' : 'italic')
  doc.setFontSize(9.5)
  doc.setTextColor(40)
  doc.text(lines, margin + 4, y + 8.5)
  if (profile.classTeacherName) {
    doc.setFontSize(8.5)
    doc.setTextColor(100)
    doc.setFont('helvetica', 'normal')
    doc.text(`— ${profile.classTeacherName}, class teacher`, pageWidth - margin - 3, y + boxHeight - 2.5, {
      align: 'right',
    })
  }

  y += boxHeight + 14
  doc.setDrawColor(150)
  doc.setLineWidth(0.3)
  doc.line(margin, y, margin + 60, y)
  doc.line(pageWidth - margin - 60, y, pageWidth - margin, y)
  doc.setFontSize(8.5)
  doc.setTextColor(100)
  doc.text("Class teacher's signature", margin, y + 4.5)
  doc.text('School stamp', pageWidth - margin - 60, y + 4.5)

  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.text(`Issued ${issued} from the ${school.name} student portal`, margin, pageHeight - 8)
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
  }

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const name = `Results-${safe(profile.studentNumber)}-${safe(period.label)}.pdf`
  if (isAndroidApp()) {
    await saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}
