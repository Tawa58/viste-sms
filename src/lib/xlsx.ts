import { strToU8, zipSync } from 'fflate'
import { isAndroidApp, saveBlobInApp } from '@/lib/native-app'

export type XlsxColumn = { header: string; width?: number; money?: boolean }
export type XlsxValue = string | number | null | undefined

export type XlsxSheet = {
  name: string
  /** Optional heading rows above the table (e.g. school name, period). */
  title?: string[]
  columns: XlsxColumn[]
  rows: XlsxValue[][]
  /** Bold totals row under the table. */
  totals?: XlsxValue[]
}

const STYLE = { text: 0, header: 1, money: 2, boldMoney: 3, bold: 4, title: 5 } as const

function esc(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
}

function colName(index: number) {
  let n = index + 1
  let name = ''
  while (n > 0) {
    const r = (n - 1) % 26
    name = String.fromCharCode(65 + r) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function cell(ref: string, value: XlsxValue, style: number) {
  if (value == null || value === '') return `<c r="${ref}" s="${style}"/>`
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`
  }
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`
}

function sheetXml(sheet: XlsxSheet) {
  const rows: string[] = []
  let r = 0
  for (const line of sheet.title ?? []) {
    r++
    rows.push(`<row r="${r}">${cell(`A${r}`, line, r === 1 ? STYLE.title : STYLE.bold)}</row>`)
  }
  if (sheet.title?.length) r++
  r++
  rows.push(
    `<row r="${r}">${sheet.columns.map((c, i) => cell(`${colName(i)}${r}`, c.header, STYLE.header)).join('')}</row>`,
  )
  const headerRow = r
  for (const values of sheet.rows) {
    r++
    rows.push(
      `<row r="${r}">${sheet.columns
        .map((c, i) =>
          cell(`${colName(i)}${r}`, values[i], c.money && typeof values[i] === 'number' ? STYLE.money : STYLE.text),
        )
        .join('')}</row>`,
    )
  }
  if (sheet.totals) {
    r++
    rows.push(
      `<row r="${r}">${sheet.columns
        .map((c, i) =>
          cell(
            `${colName(i)}${r}`,
            sheet.totals![i],
            c.money && typeof sheet.totals![i] === 'number' ? STYLE.boldMoney : STYLE.bold,
          ),
        )
        .join('')}</row>`,
    )
  }
  const cols = sheet.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 16}" customWidth="1"/>`)
    .join('')
  const pane = `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EEF2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`

function sheetName(name: string, used: Set<string>) {
  let base = name.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let n = 2
  while (used.has(base.toLowerCase())) base = `${base.slice(0, 28)} ${n++}`
  used.add(base.toLowerCase())
  return base
}

/** Minimal Office Open XML workbook (real .xlsx, opens in Excel, Sheets and LibreOffice). */
export function buildXlsx(sheets: XlsxSheet[]): Uint8Array {
  const used = new Set<string>()
  const names = sheets.map((s) => sheetName(s.name, used))
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
        .map(
          (_, i) =>
            `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map(
          (_, i) =>
            `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
        )
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  }
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s))
  })
  return zipSync(files, { level: 6 })
}

export async function downloadXlsx(sheets: XlsxSheet[], filename: string) {
  const bytes = buildXlsx(sheets)
  const blob = new Blob([bytes as BlobPart], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  if (isAndroidApp()) {
    await saveBlobInApp(blob, name)
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
