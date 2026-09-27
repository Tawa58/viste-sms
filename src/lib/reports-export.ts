import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'

export type ReportKind =
  | 'students'
  | 'attendance'
  | 'fees'
  | 'academic'
  | 'results'
  | 'staff'

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  students: 'Student Reports',
  attendance: 'Attendance Reports',
  fees: 'Fee Reports',
  academic: 'Academic Reports',
  results: 'Results Reports',
  staff: 'Staff Reports',
}

export const REPORT_KIND_DESCRIPTIONS: Record<ReportKind, string> = {
  students: 'Active register, admission numbers, class and contact details.',
  attendance: 'Daily and period attendance for the selected date range.',
  fees: 'Invoices, payments and outstanding balances.',
  academic: 'Class enrolment counts against capacity.',
  results: 'Published marks for the selected session and term.',
  staff: 'Staff directory by category, department and status.',
}

export type ReportTable = {
  title: string
  headers: string[]
  rows: string[][]
  summary?: string
}

function escapeCsv(value: string) {
  const v = value.replaceAll('"', '""')
  return /[",\n]/.test(v) ? `"${v}"` : v
}

/** Download a CSV file in the browser. */
export function downloadReportCsv(table: ReportTable, filename: string) {
  const lines = [
    table.headers.map(escapeCsv).join(','),
    ...table.rows.map((r) => r.map((c) => escapeCsv(String(c ?? ''))).join(',')),
  ]
  if (table.summary) lines.push('', escapeCsv(table.summary))
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const name = filename.endsWith('.csv') ? filename : `${filename}.csv`
  if (isAndroidApp()) {
    void saveBlobInApp(blob, name)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** Build and download a PDF table. */
export function downloadReportPdf(opts: {
  schoolName?: string
  table: ReportTable
  filename: string
}) {
  const school = opts.schoolName ?? 'Viste High School'
  const date = new Date().toISOString().slice(0, 10)
  const landscape = opts.table.headers.length > 5

  const doc = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(school, 14, 16)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(opts.table.title, 14, 23)

  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`Generated: ${date}  ·  Records: ${opts.table.rows.length}`, 14, 29)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 34,
    head: [opts.table.headers],
    body: opts.table.rows,
    styles: {
      fontSize: 8,
      cellPadding: 2.2,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: [243, 243, 243],
      textColor: [17, 17, 17],
      fontStyle: 'bold',
    },
    columnStyles: { 0: { cellWidth: 10 } },
    margin: { left: 14, right: 14 },
  })

  if (opts.table.summary) {
    const y =
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40
    doc.setFontSize(9)
    doc.text(opts.table.summary, 14, y + 10)
  }

  const name = opts.filename.endsWith('.pdf') ? opts.filename : `${opts.filename}.pdf`
  if (isAndroidApp()) {
    void saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}
