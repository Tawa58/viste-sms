import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'
import { loadPdfLogo as loadLogo, PDF_BRAND as BRAND } from '@/lib/pdf-brand'
import type { StudentResultPaper } from '@/types'

export function formatPercent(value: number | undefined) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

export function formatMark(score: number, maxScore: number) {
  const s = Number.isInteger(score) ? score : score.toFixed(1)
  return `${s}/${maxScore}`
}

export function formatResultDate(value?: string) {
  if (!value) return '—'
  if (/^\d{4}-\d{2}$/.test(value)) {
    const date = new Date(`${value}-01T12:00:00`)
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  }
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export type ResultSlipSchool = {
  name: string
  motto?: string
  address?: string
  phone?: string
  email?: string
}

export type ResultSlip = {
  school: ResultSlipSchool
  studentName: string
  studentNumber: string
  className: string
  categoryLabel: string
  papers: StudentResultPaper[]
  average?: number
  classTeacherName?: string
  classTeacherComment?: string
}

function paintSlip(
  doc: jsPDF,
  slip: ResultSlip,
  logo: { data: string; ratio: number } | null,
) {
  const startPage = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 14
  const contentWidth = pageWidth - margin * 2

  if (logo) {
    const h = 22
    const w = Math.min(28, h * logo.ratio)
    doc.addImage(logo.data, 'PNG', margin, 10, w, h, undefined, 'FAST')
  }

  doc.setTextColor(...BRAND)
  doc.setFont('helvetica', 'bold')
  let titleSize = 16
  doc.setFontSize(titleSize)
  while (titleSize > 11 && doc.getTextWidth(slip.school.name) > contentWidth - 64) {
    titleSize -= 0.5
    doc.setFontSize(titleSize)
  }
  doc.text(slip.school.name || 'School', pageWidth / 2, 16, { align: 'center' })

  let headerY = 21.5
  doc.setTextColor(55)
  if (slip.school.motto) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(slip.school.motto, pageWidth / 2, headerY, { align: 'center' })
    headerY += 4.5
  }
  if (slip.school.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const lines = doc.splitTextToSize(slip.school.address, contentWidth - 50) as string[]
    doc.text(lines, pageWidth / 2, headerY, { align: 'center' })
    headerY += lines.length * 3.8
  }
  const contact = [slip.school.phone, slip.school.email].filter(Boolean).join('  ·  ')
  if (contact) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(90)
    doc.text(contact, pageWidth / 2, headerY, { align: 'center' })
    headerY += 4
  }

  const ruleY = Math.max(36, headerY + 2)
  doc.setDrawColor(...BRAND)
  doc.setLineWidth(0.8)
  doc.line(margin, ruleY, pageWidth - margin, ruleY)

  doc.setTextColor(17)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text('RESULTS SLIP', pageWidth / 2, ruleY + 8, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(70)
  doc.text(slip.categoryLabel, pageWidth / 2, ruleY + 13.5, { align: 'center' })

  const boxY = ruleY + 18
  doc.setFillColor(244, 247, 249)
  doc.setDrawColor(220)
  doc.setLineWidth(0.2)
  doc.roundedRect(margin, boxY, contentWidth, 16, 2, 2, 'FD')
  const info: [string, string][] = [
    ['Student', slip.studentName],
    ['Reg. number', slip.studentNumber],
    ['Class', slip.className],
    ['Category', slip.categoryLabel],
  ]
  info.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const x = margin + 4 + col * (contentWidth / 2)
    const y = boxY + 6.5 + row * 6.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(`${label}:`, x, y)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(17)
    doc.text(value || '—', x + 24, y, { maxWidth: contentWidth / 2 - 30 })
  })

  autoTable(doc, {
    startY: boxY + 20,
    head: [['#', 'Subject', 'Exercise / test', 'Date sat', 'Published', 'Score', 'Grade']],
    body: slip.papers.map((p, i) => [
      String(i + 1),
      p.subject,
      p.title,
      formatResultDate(p.satOn),
      formatResultDate(p.publishedAt),
      formatMark(p.score, p.maxScore),
      p.grade || '—',
    ]),
    foot: [
      [
        '',
        'Average',
        `${slip.papers.length} paper${slip.papers.length === 1 ? '' : 's'}`,
        '',
        '',
        formatPercent(slip.average),
        '',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'middle', textColor: [30, 30, 30] },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [236, 241, 244], textColor: [17, 17, 17], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 32 },
      2: { cellWidth: 42 },
      3: { cellWidth: 24, halign: 'center' },
      4: { cellWidth: 24, halign: 'center' },
      5: { cellWidth: 18, halign: 'center' },
      6: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
    },
    margin: { left: margin, right: margin, bottom: 16 },
  })

  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 8
  const pageHeightNow = () => doc.internal.pageSize.getHeight()
  if (slip.classTeacherComment?.trim()) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    const lines = doc.splitTextToSize(slip.classTeacherComment.trim(), contentWidth - 8) as string[]
    const boxHeight = 8 + lines.length * 4.4
    if (y + boxHeight > pageHeightNow() - 48) {
      doc.addPage()
      y = 18
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...BRAND)
    doc.text("Class teacher's comment", margin, y)
    doc.setDrawColor(210)
    doc.setFillColor(252, 252, 252)
    doc.roundedRect(margin, y + 2, contentWidth, boxHeight, 1.5, 1.5, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(40)
    doc.text(lines, margin + 3, y + 7)
    y += boxHeight + 10
  }

  if (y + 42 > pageHeightNow() - 14) {
    doc.addPage()
    y = 22
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(17)
  doc.text("Principal's signature", margin, y)
  doc.setDrawColor(80)
  doc.setLineWidth(0.35)
  doc.line(margin, y + 16, margin + 78, y + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(110)
  doc.text('Sign above', margin, y + 20)

  const stampX = pageWidth - margin - 42
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(17)
  doc.text('School stamp', stampX, y)
  doc.setDrawColor(160)
  doc.setLineWidth(0.4)
  doc.roundedRect(stampX, y + 3, 42, 28, 1.5, 1.5, 'S')

  const endPage = doc.getNumberOfPages()
  const slipPages = endPage - startPage + 1
  const issued = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  for (let p = startPage; p <= endPage; p++) {
    doc.setPage(p)
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.setFont('helvetica', 'normal')
    doc.text(`Official results slip · ${slip.school.name} · ${issued}`, margin, pageHeight - 8)
    doc.text(`Page ${p - startPage + 1} of ${slipPages}`, pageWidth - margin, pageHeight - 8, {
      align: 'right',
    })
  }
  doc.setPage(endPage)
}

export type SubjectClassSheet = {
  school: ResultSlipSchool
  className: string
  categoryLabel: string
  subjectName: string
  columns: { id: string; label: string }[]
  rows: {
    studentName: string
    studentNumber: string
    marks: Record<string, string>
  }[]
}

function drawLetterhead(
  doc: jsPDF,
  school: ResultSlipSchool,
  logo: { data: string; ratio: number } | null,
  margin: number,
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const contentWidth = pageWidth - margin * 2
  if (logo) {
    const h = 18
    const w = Math.min(24, h * logo.ratio)
    doc.addImage(logo.data, 'PNG', margin, 10, w, h, undefined, 'FAST')
  }
  doc.setTextColor(...BRAND)
  doc.setFont('helvetica', 'bold')
  let titleSize = 15
  doc.setFontSize(titleSize)
  while (titleSize > 11 && doc.getTextWidth(school.name) > contentWidth - 56) {
    titleSize -= 0.5
    doc.setFontSize(titleSize)
  }
  doc.text(school.name || 'School', pageWidth / 2, 15, { align: 'center' })
  let headerY = 20
  doc.setTextColor(55)
  if (school.motto) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(school.motto, pageWidth / 2, headerY, { align: 'center' })
    headerY += 4.2
  }
  if (school.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const lines = doc.splitTextToSize(school.address, contentWidth - 40) as string[]
    doc.text(lines, pageWidth / 2, headerY, { align: 'center' })
    headerY += lines.length * 3.6
  }
  const ruleY = Math.max(32, headerY + 2)
  doc.setDrawColor(...BRAND)
  doc.setLineWidth(0.8)
  doc.line(margin, ruleY, pageWidth - margin, ruleY)
  return ruleY
}

/** One sheet for a subject: every learner in the class, not a page per learner. */
export async function downloadSubjectClassSheetPdf(sheet: SubjectClassSheet, fileName: string) {
  const wide = sheet.columns.length > 4
  const doc = new jsPDF({
    orientation: wide ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  })
  const logo = await loadLogo()
  const margin = 12
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const ruleY = drawLetterhead(doc, sheet.school, logo, margin)

  doc.setTextColor(17)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text(sheet.subjectName, pageWidth / 2, ruleY + 7, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(70)
  doc.text(
    `${sheet.className}  ·  ${sheet.categoryLabel}  ·  whole class`,
    pageWidth / 2,
    ruleY + 12,
    { align: 'center' },
  )

  autoTable(doc, {
    startY: ruleY + 16,
    head: [['#', 'Learner', 'Reg. number', ...sheet.columns.map((c) => c.label)]],
    body: sheet.rows.map((row, index) => [
      String(index + 1),
      row.studentName,
      row.studentNumber || '—',
      ...sheet.columns.map((c) => row.marks[c.id] || '—'),
    ]),
    styles: { fontSize: wide ? 7.5 : 8.5, cellPadding: 1.8, valign: 'middle', textColor: [30, 30, 30] },
    headStyles: { fillColor: BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: wide ? 48 : 55 },
      2: { cellWidth: 28 },
    },
    margin: { left: margin, right: margin, bottom: 36 },
  })

  let y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 120) + 8
  if (y + 36 > pageHeight - 12) {
    doc.addPage()
    y = 16
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(17)
  doc.text("Principal's signature", margin, y)
  doc.setDrawColor(80)
  doc.setLineWidth(0.35)
  doc.line(margin, y + 14, margin + 70, y + 14)
  const stampX = pageWidth - margin - 36
  doc.text('School stamp', stampX, y)
  doc.setDrawColor(160)
  doc.roundedRect(stampX, y + 2, 36, 22, 1.5, 1.5, 'S')

  const issued = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.text(`Class subject sheet · ${sheet.school.name} · ${issued}`, margin, pageHeight - 7)
    doc.text(`Page ${p} of ${pages}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
  }

  const safe = fileName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'class-subject-sheet'
  const name = `${safe}.pdf`
  if (isAndroidApp()) {
    await saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}

/** Official hard-copy slips. One learner, or one page-set per learner for a whole class. */
export async function downloadResultSlipsPdf(slips: ResultSlip[], fileName: string) {
  if (slips.length === 0) throw new Error('Nothing to print')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const logo = await loadLogo()
  slips.forEach((slip, index) => {
    if (index > 0) doc.addPage()
    paintSlip(doc, slip, logo)
  })

  const safe = fileName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'results-slips'
  const name = `${safe}.pdf`
  if (isAndroidApp()) {
    await saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}
