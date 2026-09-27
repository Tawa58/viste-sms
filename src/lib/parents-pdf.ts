import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'
import type { Guardian, Student } from '@/types'
import { educationLevelName } from '@/lib/education-levels'
import { fullName } from '@/lib/utils'

export type ParentPdfVariant =
  | 'contacts'
  | 'names_address'
  | 'names_contacts'
  | 'names_contacts_children'

export type ParentPdfRow = {
  guardian: Guardian
  children: Student[]
  /** Resolved class / level labels keyed by student id */
  levelByStudentId: Record<string, string>
}

const VARIANT_TITLES: Record<ParentPdfVariant, string> = {
  contacts: 'Parent / guardian contacts',
  names_address: 'Parent / guardian names and addresses',
  names_contacts: 'Parent / guardian names and contacts',
  names_contacts_children: 'Parents with contacts, children, and levels',
}

function childLine(s: Student, levelByStudentId: Record<string, string>) {
  const level =
    levelByStudentId[s.id] || educationLevelName(s.educationLevelId) || '—'
  return `${fullName(s)} (${level})`
}

function headersFor(variant: ParentPdfVariant): string[] {
  switch (variant) {
    case 'contacts':
      return ['#', 'Name', 'Phone', 'Email']
    case 'names_address':
      return ['#', 'Name', 'Address']
    case 'names_contacts':
      return ['#', 'Name', 'Phone', 'Email']
    case 'names_contacts_children':
      return ['#', 'Name', 'Phone', 'Email', 'Children & levels']
  }
}

function bodyFor(variant: ParentPdfVariant, rows: ParentPdfRow[]): string[][] {
  return rows.map((row, i) => {
    const name = `${row.guardian.firstName} ${row.guardian.lastName}`.trim()
    const phone = row.guardian.phone || '—'
    const email = row.guardian.email || '—'
    const address = row.guardian.address || '—'
    const children =
      row.children.length > 0
        ? row.children.map((s) => childLine(s, row.levelByStudentId)).join('; ')
        : '—'

    switch (variant) {
      case 'contacts':
        return [String(i + 1), name, phone, email]
      case 'names_address':
        return [String(i + 1), name, address]
      case 'names_contacts':
        return [String(i + 1), name, phone, email]
      case 'names_contacts_children':
        return [String(i + 1), name, phone, email, children]
    }
  })
}

/** Builds a real PDF file and triggers a browser download. */
export function downloadParentsPdf(opts: {
  schoolName?: string
  variant: ParentPdfVariant
  rows: ParentPdfRow[]
}) {
  const school = opts.schoolName ?? 'Viste High School'
  const title = VARIANT_TITLES[opts.variant]
  const date = new Date().toISOString().slice(0, 10)
  const landscape = opts.variant === 'names_contacts_children'

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
  doc.text(title, 14, 23)

  doc.setFontSize(9)
  doc.setTextColor(80)
  doc.text(`Generated: ${date}  ·  Records: ${opts.rows.length}`, 14, 29)
  doc.setTextColor(0)

  autoTable(doc, {
    startY: 34,
    head: [headersFor(opts.variant)],
    body: bodyFor(opts.variant, opts.rows),
    styles: {
      fontSize: 8,
      cellPadding: 2.5,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      fillColor: [243, 243, 243],
      textColor: [17, 17, 17],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 10 },
    },
    margin: { left: 14, right: 14 },
  })

  const name = `parents-${opts.variant}-${date}.pdf`
  if (isAndroidApp()) {
    void saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}
