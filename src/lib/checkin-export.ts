import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'

const SCHOOL_NAME = 'Viste High School'

function saveBlob(blob: Blob, fileName: string) {
  if (isAndroidApp()) {
    void saveBlobInApp(blob, fileName)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function csvCell(value: string | number) {
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function downloadCsv(fileName: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
  saveBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), fileName)
}

export function downloadTablePdf(opts: {
  fileName: string
  title: string
  subtitle: string
  header: string[]
  rows: (string | number)[][]
  summary?: string
  landscape?: boolean
}) {
  const doc = new jsPDF({
    orientation: opts.landscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(SCHOOL_NAME, 14, 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(opts.title, 14, 23)
  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(opts.subtitle, 14, 29)
  let startY = 34
  if (opts.summary) {
    doc.text(opts.summary, 14, 34)
    startY = 39
  }
  doc.setTextColor(0)
  autoTable(doc, {
    startY,
    head: [opts.header],
    body: opts.rows.map((row) => row.map(String)),
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [243, 243, 243], textColor: [17, 17, 17], fontStyle: 'bold' },
    margin: { left: 14, right: 14 },
  })
  if (isAndroidApp()) {
    void saveBlobInApp(doc.output('blob'), opts.fileName)
    return
  }
  doc.save(opts.fileName)
}
