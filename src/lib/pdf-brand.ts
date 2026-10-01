import type { jsPDF } from 'jspdf'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'

export const PDF_BRAND: [number, number, number] = [19, 74, 102]
const LOGO_URL = '/viste-logo.png'

export type PdfLogo = { data: string; ratio: number }

/** School logo as a small PNG data URL (downscaled so PDFs stay light). */
export async function loadPdfLogo(): Promise<PdfLogo | null> {
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

/** Logo, centred school name and contact line, and a brand rule. Returns the y below the rule. */
export function drawPdfLetterhead(
  doc: jsPDF,
  logo: PdfLogo | null,
  school: { name: string; motto?: string; address?: string; phone?: string; email?: string },
) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 14
  const contentWidth = pageWidth - margin * 2
  if (logo) {
    const h = 22
    doc.addImage(logo.data, 'PNG', margin, 9, Math.min(28, h * logo.ratio), h, undefined, 'FAST')
  }
  doc.setTextColor(...PDF_BRAND)
  doc.setFont('helvetica', 'bold')
  let size = 16
  doc.setFontSize(size)
  while (size > 11 && doc.getTextWidth(school.name) > contentWidth - 68) {
    size -= 0.5
    doc.setFontSize(size)
  }
  doc.text(school.name, pageWidth / 2, 17, { align: 'center' })
  doc.setTextColor(70)
  let y = 22.5
  if (school.motto) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.text(school.motto, pageWidth / 2, y, { align: 'center' })
    y += 4.5
  }
  const contact = [school.address, school.phone, school.email].filter(Boolean).join('  ·  ')
  if (contact) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.text(contact, pageWidth / 2, y, { align: 'center', maxWidth: contentWidth - 40 })
  }
  doc.setDrawColor(...PDF_BRAND)
  doc.setLineWidth(0.8)
  doc.line(margin, 35, pageWidth - margin, 35)
  return 35
}

export function drawPdfFooters(doc: jsPDF, note: string) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(130)
    doc.text(note, 14, pageHeight - 8)
    doc.text(`Page ${p} of ${pages}`, pageWidth - 14, pageHeight - 8, { align: 'right' })
  }
}

export async function savePdf(doc: jsPDF, name: string) {
  if (isAndroidApp()) {
    await saveBlobInApp(doc.output('blob'), name)
    return
  }
  doc.save(name)
}

export function safeFilePart(value: string) {
  return value.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
