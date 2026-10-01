import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { HR_CATEGORY_LABEL, PAYROLL_STATUS_LABEL, formatMoney, formatPercentValue } from '@/lib/hr/constants'
import { periodLabel } from '@/lib/hr/payroll-engine'
import { isAndroidApp } from '@/lib/native-app'
import {
  PDF_BRAND,
  drawPdfFooters,
  drawPdfLetterhead,
  loadPdfLogo,
  safeFilePart,
  savePdf,
} from '@/lib/pdf-brand'
import type { PayrollItem, PayrollRunDetail, PayrollSchoolInfo } from '@/types'

type LastTable = { lastAutoTable?: { finalY: number } }
const lastY = (doc: jsPDF, fallback: number) =>
  (doc as unknown as LastTable).lastAutoTable?.finalY ?? fallback

function issuedNote(school: PayrollSchoolInfo) {
  const issued = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return `Generated ${issued} · ${school.name}`
}

function title(doc: jsPDF, top: number, heading: string, sub: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setTextColor(17)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.text(heading, pageWidth / 2, top + 9, { align: 'center' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(80)
  doc.text(sub, pageWidth / 2, top + 14.5, { align: 'center' })
  return top + 20
}

/** Whole-month payroll register (landscape). */
export async function downloadPayrollPdf(detail: PayrollRunDetail) {
  const { run, items, school } = detail
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  const top = drawPdfLetterhead(doc, await loadPdfLogo(), school)
  const y = title(
    doc,
    top,
    `PAYROLL — ${periodLabel(run.period).toUpperCase()}`,
    `${PAYROLL_STATUS_LABEL[run.status]} · ${run.totals.employees} employee${run.totals.employees === 1 ? '' : 's'}`,
  )
  autoTable(doc, {
    startY: y,
    head: [['#', 'Emp. no', 'Employee', 'Position', 'Basic', 'Allowances', 'Gross', 'Deductions', 'Net salary', 'Bank · account']],
    body: items.map((i, n) => [
      String(n + 1),
      i.employeeNumber,
      i.employeeName,
      `${i.position}${i.grade ? ` (${i.grade})` : ''}`,
      formatMoney(i.basicSalary),
      formatMoney(i.allowancesTotal),
      formatMoney(i.grossSalary),
      formatMoney(i.deductionsTotal),
      formatMoney(i.netSalary),
      [i.bank.bankName, i.bank.accountNumber].filter(Boolean).join(' · ') || '—',
    ]),
    foot: [
      [
        '',
        '',
        'Totals',
        '',
        formatMoney(run.totals.basic),
        formatMoney(run.totals.allowances),
        formatMoney(run.totals.gross),
        formatMoney(run.totals.deductions),
        formatMoney(run.totals.net),
        '',
      ],
    ],
    styles: { fontSize: 8, cellPadding: 1.8, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: PDF_BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [236, 241, 244], textColor: [17, 17, 17], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      8: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14, bottom: 16 },
  })
  if (run.skipped.length) {
    autoTable(doc, {
      startY: lastY(doc, y) + 6,
      head: [['Not paid this month', 'Reason']],
      body: run.skipped.map((s) => [`${s.name} (${s.employeeNumber})`, s.reason]),
      styles: { fontSize: 8, cellPadding: 1.6 },
      headStyles: { fillColor: [120, 120, 120], textColor: [255, 255, 255] },
      margin: { left: 14, right: 14, bottom: 16 },
      tableWidth: 150,
    })
  }
  drawPdfFooters(doc, issuedNote(school))
  await savePdf(doc, `Payroll-${run.period}.pdf`)
}

async function buildPayslip(school: PayrollSchoolInfo, item: PayrollItem) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  const top = drawPdfLetterhead(doc, await loadPdfLogo(), school)
  const y = title(doc, top, 'PAYSLIP', periodLabel(item.period))

  const info: [string, string][] = [
    ['Employee name', item.employeeName],
    ['Employee number', item.employeeNumber],
    ['Position', `${item.position}${item.grade ? ` · Grade ${item.grade}` : ''}`],
    ['Department', item.department || HR_CATEGORY_LABEL[item.category]],
    ['Month', periodLabel(item.period)],
    ['Paid to', [item.bank.bankName, item.bank.accountNumber, item.bank.branch].filter(Boolean).join(' · ') || '—'],
  ]
  doc.setFillColor(244, 247, 249)
  doc.setDrawColor(220)
  doc.setLineWidth(0.2)
  doc.roundedRect(margin, y, contentWidth, 25, 2, 2, 'FD')
  info.forEach(([label, value], i) => {
    const x = margin + 4 + (i % 2) * (contentWidth / 2)
    const rowY = y + 7 + Math.floor(i / 2) * 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(100)
    doc.text(`${label}:`, x, rowY)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(17)
    doc.text(value || '—', x + 30, rowY, { maxWidth: contentWidth / 2 - 36 })
  })

  const tableStyles = {
    styles: { fontSize: 9, cellPadding: 2.2 },
    headStyles: { fillColor: PDF_BRAND, textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const },
    footStyles: { fillColor: [236, 241, 244] as [number, number, number], textColor: [17, 17, 17] as [number, number, number], fontStyle: 'bold' as const },
    columnStyles: { 1: { halign: 'right' as const, cellWidth: 40 } },
    didParseCell: (data: { column: { index: number }; cell: { styles: { halign: string } } }) => {
      if (data.column.index === 1) data.cell.styles.halign = 'right'
    },
    margin: { left: margin, right: margin },
  }
  autoTable(doc, {
    ...tableStyles,
    startY: y + 31,
    head: [['Earnings', 'Amount']],
    body: [
      ['Basic salary', formatMoney(item.basicSalary)],
      ['Housing allowance', formatMoney(item.housingAllowance)],
      ['Transport allowance', formatMoney(item.transportAllowance)],
      ['Other allowances', formatMoney(item.otherAllowances)],
    ],
    foot: [['Gross salary', formatMoney(item.grossSalary)]],
  })
  autoTable(doc, {
    ...tableStyles,
    startY: lastY(doc, y + 60) + 5,
    head: [['Deductions', 'Amount']],
    body: item.deductions.length
      ? item.deductions.map((d) => [
          [
            d.label,
            d.percentage != null ? formatPercentValue(d.percentage) : null,
            d.fixedAmount != null && d.source === 'MANUAL' ? `fixed ${formatMoney(d.fixedAmount)}` : null,
            d.notes || null,
          ]
            .filter(Boolean)
            .join(' · '),
          formatMoney(d.amount),
        ])
      : [['No deductions this month', formatMoney(0)]],
    foot: [['Total deductions', formatMoney(item.deductionsTotal)]],
  })

  const netY = lastY(doc, y + 100) + 7
  doc.setFillColor(...PDF_BRAND)
  doc.roundedRect(margin, netY, contentWidth, 14, 2, 2, 'F')
  doc.setTextColor(255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.text('NET SALARY', margin + 5, netY + 9)
  doc.setFontSize(13)
  doc.text(formatMoney(item.netSalary), pageWidth - margin - 5, netY + 9.2, { align: 'right' })

  doc.setTextColor(110)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text('Computer-generated payslip. Report any discrepancy to the bursar within 7 days.', margin, netY + 22)
  drawPdfFooters(doc, issuedNote(school))
  return doc
}

function payslipName(item: PayrollItem) {
  return `Payslip-${safeFilePart(item.employeeNumber)}-${item.period}.pdf`
}

export async function downloadPayslipPdf(school: PayrollSchoolInfo, item: PayrollItem) {
  await savePdf(await buildPayslip(school, item), payslipName(item))
}

/** Opens the payslip with the print dialog; saves it where printing isn't available. */
export async function printPayslipPdf(school: PayrollSchoolInfo, item: PayrollItem) {
  const doc = await buildPayslip(school, item)
  if (isAndroidApp()) {
    await savePdf(doc, payslipName(item))
    return
  }
  doc.autoPrint()
  const win = window.open(String(doc.output('bloburl')), '_blank')
  if (!win) await savePdf(doc, payslipName(item))
}

/** Generic ledger export (expenses, revenue, staff list). */
export async function downloadLedgerPdf(opts: {
  school: PayrollSchoolInfo
  title: string
  subtitle: string
  head: string[]
  rows: string[][]
  foot?: string[]
  rightAlign?: number[]
  filename: string
}) {
  const landscape = opts.head.length > 6
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4', compress: true })
  const top = drawPdfLetterhead(doc, await loadPdfLogo(), opts.school)
  const y = title(doc, top, opts.title.toUpperCase(), opts.subtitle)
  const columnStyles: Record<number, { halign: 'right' }> = {}
  for (const i of opts.rightAlign ?? []) columnStyles[i] = { halign: 'right' }
  autoTable(doc, {
    startY: y,
    head: [opts.head],
    body: opts.rows,
    ...(opts.foot ? { foot: [opts.foot] } : {}),
    styles: { fontSize: 8.5, cellPadding: 2, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: PDF_BRAND, textColor: [255, 255, 255], fontStyle: 'bold' },
    footStyles: { fillColor: [236, 241, 244], textColor: [17, 17, 17], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [250, 251, 252] },
    columnStyles,
    margin: { left: 14, right: 14, bottom: 16 },
  })
  drawPdfFooters(doc, issuedNote(opts.school))
  await savePdf(doc, opts.filename)
}
