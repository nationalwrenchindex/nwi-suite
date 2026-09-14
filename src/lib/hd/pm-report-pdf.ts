// The PM inspection report, rendered as a real PDF.
//
// ── WHY A PDF LIBRARY AT ALL ─────────────────────────────────────────────────
// Every other "pdf" route in this codebase serves text/html with a print button and
// lets the browser make the PDF. That works for a link a human clicks; it cannot
// produce a file to hang off an email, and a .html attachment is what a customer's
// mail client quarantines or refuses to open on a phone. The PM report is the record
// the customer keeps of the job, so it has to arrive as a PDF.
//
// pdf-lib is used because it is pure JavaScript with no native binaries and no
// headless browser, which is the only shape that survives Vercel's serverless runtime
// and its cold starts. Puppeteer would drag ~300MB of Chromium behind it.
//
// ── THE COST OF THAT CHOICE ──────────────────────────────────────────────────
// pdf-lib has no layout engine. There is no flow, no wrapping, no page breaking — only
// "draw this string at this x/y on this page". Everything below the drawing helpers is
// the layout engine this file has to be: measure the text, wrap it to the column width,
// track a cursor down the page, and cut a new page before the cursor runs off the
// bottom. A PM carries ~73 inspection points and will always span several pages, so a
// renderer that silently drew past the bottom of page one would drop most of the
// document — worse than the HTML it replaces, because nothing would look wrong.
//
// The section header is re-drawn (marked CONTINUED) whenever a section splits across a
// break, so a reader landing mid-page always knows which part of the unit the rows in
// front of them belong to.
//
// ── GREYSCALE ────────────────────────────────────────────────────────────────
// Customers print these, and they print them on whatever is in the shop. A failure is
// therefore marked three ways that all survive a black-and-white printer: a solid dark
// bar down the left edge of the row, the item text in bold, and the word FAIL in caps
// against "Pass" and "N/A" in mixed case. The red is a bonus for whoever reads it on a
// screen, never the thing carrying the meaning.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import type { PMReportSummary, PMReportSection } from '@/lib/hd/pm-report-items'

// ── the record this renderer draws ────────────────────────────────────────────

/** One PM checklist, flattened to exactly what the document shows. */
export interface PMPdfRecord {
  unitNumber:   string | null
  manufacturer: string | null
  model:        string | null
  serial:       string | null
  pmType:       string | null
  completedAt:  string | null
  techName:     string | null
  customerName: string | null
  checklistId:  string
  report:       PMReportSummary
  flagged:      { text?: string; section?: string }[]
  /** hd_pm_checklists.locked_at — prints as "Record locked …" at the foot. */
  lockedAt:     string | null
  signed:       boolean
}

export interface PMPdfMeta {
  businessName:  string
  invoiceNumber: string | null
}

// ── page geometry ─────────────────────────────────────────────────────────────

const PAGE_W = 612          // US Letter, portrait
const PAGE_H = 792
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2          // 516
const TOP_Y = PAGE_H - MARGIN
const BOTTOM_Y = 56                            // everything below this is footer

// Item row columns. The 12pt gutter on the left is where the failure bar lives, so a
// failing row can be marked without shifting the text of the rows around it.
const ROW_X = MARGIN + 12
const ID_W = 34
const STATUS_W = 46
const TEXT_X = ROW_X + ID_W
const TEXT_W = PAGE_W - MARGIN - STATUS_W - 6 - TEXT_X

const ORANGE = rgb(1, 0.4, 0)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.45, 0.45, 0.45)
const FAINT = rgb(0.72, 0.72, 0.72)
const RULE = rgb(0.87, 0.88, 0.89)
const SHADE = rgb(0.949, 0.953, 0.957)
const FAIL_INK = rgb(0.6, 0.05, 0.05)
const FAIL_BG = rgb(0.996, 0.949, 0.949)
const PASS_INK = rgb(0.05, 0.45, 0.2)

// ── text safety ───────────────────────────────────────────────────────────────

// The standard PDF fonts encode WinAnsi (cp1252) and pdf-lib THROWS on anything else.
// Item text is ours, but unit numbers, customer names and flagged-item notes are
// operator-entered and can hold anything a phone keyboard produces. Unencodable
// characters are transliterated where there is an obvious ASCII equivalent and dropped
// to '?' otherwise — a report with a mangled character still reaches the customer, a
// throw in the invoice send path does not.
const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

function winAnsi(value: unknown): string {
  if (value == null) return ''
  let out = ''
  for (const ch of String(value)) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) { out += ' '; continue }
    if (code >= 0x20 && code <= 0x7e) { out += ch; continue }
    if (code >= 0xa0 && code <= 0xff) { out += ch; continue }
    if (CP1252_EXTRAS.has(code)) { out += ch; continue }
    out += '?'
  }
  return out
}

function str(value: unknown): string | null {
  const s = winAnsi(value).trim()
  return s.length ? s : null
}

function fmtDay(value: unknown): string {
  const s = str(value)
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function fmtStamp(value: unknown): string | null {
  const s = str(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : winAnsi(d.toLocaleString('en-US'))
}

// ── the layout engine ─────────────────────────────────────────────────────────

/**
 * Greedy wrap to a pixel width, measured against the real font metrics.
 *
 * A single word wider than the column (a pasted part number, a URL) is broken by
 * character rather than allowed to run off the page edge — the alternative is text
 * drawn into the margin where it is invisible in the printed copy.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let cur = ''

  for (const word of words) {
    const trial = cur ? `${cur} ${word}` : word
    if (font.widthOfTextAtSize(trial, size) <= maxWidth) { cur = trial; continue }
    if (cur) { lines.push(cur); cur = '' }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) { cur = word; continue }

    let chunk = ''
    for (const ch of word) {
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxWidth) {
        lines.push(chunk)
        chunk = ch
      } else {
        chunk += ch
      }
    }
    cur = chunk
  }

  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

interface TextOpts {
  size?:  number
  bold?:  boolean
  color?: RGB
  align?: 'left' | 'right'
}

/**
 * A cursor walking down a growing stack of pages.
 *
 * Every write goes through `ensure()`, which is the single place that decides a page is
 * full. Nothing draws at an absolute y, so there is no path by which content can be
 * emitted below the bottom margin and lost.
 */
class Layout {
  page!: PDFPage
  y = 0
  /** Set while inside a section so a page break can re-issue its header. */
  private openSection: string | null = null
  private runningTitle = ''

  constructor(
    private readonly pdf:  PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  setRunningTitle(title: string) { this.runningTitle = title }

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H])
    this.y = TOP_Y

    if (this.runningTitle) {
      this.page.drawText(this.runningTitle, {
        x: MARGIN, y: this.y - 8, size: 8, font: this.font, color: FAINT,
      })
      this.y -= 18
      this.page.drawLine({
        start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.5, color: RULE,
      })
      this.y -= 16
    }

    // A section that spilled onto this page keeps its header, so no run of rows is
    // ever orphaned from the part of the unit it describes.
    if (this.openSection) this.drawSectionHeader(this.openSection, true)
  }

  /** Cut a page if `height` will not fit above the bottom margin. */
  ensure(height: number) {
    if (!this.page || this.y - height < BOTTOM_Y) this.newPage()
  }

  gap(amount: number) {
    // Never let whitespace push the cursor into the footer — swallow it instead.
    if (this.y - amount < BOTTOM_Y) return
    this.y -= amount
  }

  text(value: string, opts: TextOpts = {}) {
    const size = opts.size ?? 10
    const font = opts.bold ? this.bold : this.font
    const lines = wrap(winAnsi(value), font, size, CONTENT_W)
    const lh = size * 1.35

    for (const line of lines) {
      this.ensure(lh)
      const x = opts.align === 'right'
        ? PAGE_W - MARGIN - font.widthOfTextAtSize(line, size)
        : MARGIN
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK })
      this.y -= lh
    }
  }

  /** A bar-headed block title: "UNIT DETAILS", "FLAGGED ITEMS", … */
  blockTitle(title: string) {
    this.ensure(26)
    this.page.drawRectangle({ x: MARGIN, y: this.y - 15, width: 3, height: 13, color: ORANGE })
    this.page.drawText(winAnsi(title).toUpperCase(), {
      x: MARGIN + 9, y: this.y - 13, size: 9.5, font: this.bold, color: INK,
    })
    this.y -= 22
  }

  /** Label/value pair on one line, label column fixed so the values align. */
  fact(label: string, value: string) {
    const size = 9.5
    const labelW = 112
    const lines = wrap(winAnsi(value) || '—', this.font, size, CONTENT_W - labelW)
    const lh = size * 1.35

    this.ensure(lines.length * lh)
    this.page.drawText(winAnsi(label).toUpperCase(), {
      x: MARGIN, y: this.y - size, size: 7.5, font: this.bold, color: MUTED,
    })
    lines.forEach((line, i) => {
      this.page.drawText(line, {
        x: MARGIN + labelW, y: this.y - size - i * lh, size, font: this.font, color: INK,
      })
    })
    this.y -= lines.length * lh
  }

  // ── inspection rows ─────────────────────────────────────────────────────────

  openSectionBlock(title: string) {
    // A header stranded at the foot of a page with none of its rows under it is worse
    // than a slightly short page, so demand room for the header plus one row.
    this.ensure(20 + 18)
    this.openSection = title
    this.drawSectionHeader(title, false)
  }

  closeSectionBlock() { this.openSection = null }

  private drawSectionHeader(title: string, continued: boolean) {
    const h = 17
    this.page.drawRectangle({
      x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: SHADE,
    })
    const label = winAnsi(title).toUpperCase() + (continued ? ' (CONTINUED)' : '')
    this.page.drawText(label, {
      x: ROW_X, y: this.y - h + 5.5, size: 8, font: this.bold, color: rgb(0.3, 0.3, 0.3),
    })
    this.y -= h + 3
  }

  /**
   * One inspection point: id, wrapped text, result.
   *
   * Failures get the left bar, bold text and the caps FAIL — three cues, only one of
   * which is colour, because this is printed in greyscale as often as not.
   */
  itemRow(id: string, text: string, label: string, failed: boolean) {
    const size = 9
    const lh = 11
    const lines = wrap(winAnsi(text), failed ? this.bold : this.font, size, TEXT_W)
    const rowH = Math.max(16, lines.length * lh + 6)

    this.ensure(rowH)

    if (failed) {
      this.page.drawRectangle({
        x: MARGIN, y: this.y - rowH, width: CONTENT_W, height: rowH, color: FAIL_BG,
      })
      this.page.drawRectangle({
        x: MARGIN, y: this.y - rowH, width: 4, height: rowH, color: FAIL_INK,
      })
    }

    const firstBaseline = this.y - size - 4

    this.page.drawText(winAnsi(id), {
      x: ROW_X, y: firstBaseline, size: 7.5, font: this.font, color: FAINT,
    })

    lines.forEach((line, i) => {
      this.page.drawText(line, {
        x: TEXT_X,
        y: firstBaseline - i * lh,
        size,
        font: failed ? this.bold : this.font,
        color: failed ? FAIL_INK : INK,
      })
    })

    const status = failed ? 'FAIL' : winAnsi(label)
    const statusFont = failed ? this.bold : this.font
    const statusColor = failed ? FAIL_INK : label === 'Pass' ? PASS_INK : MUTED
    this.page.drawText(status, {
      x: PAGE_W - MARGIN - statusFont.widthOfTextAtSize(status, 8),
      y: firstBaseline,
      size: 8,
      font: statusFont,
      color: statusColor,
    })

    this.y -= rowH
    this.page.drawLine({
      start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y },
      thickness: 0.4, color: RULE,
    })
  }

  /** A flagged item, carrying the same left bar as a failing row. */
  flaggedLine(text: string, note: string | null) {
    const size = 9.5
    const lh = 12
    const x = MARGIN + 12
    const w = CONTENT_W - 12
    const lines = wrap(winAnsi(text), this.bold, size, w)
    const noteLines = note ? wrap(winAnsi(note), this.font, 8, w) : []
    const rowH = lines.length * lh + noteLines.length * 10 + 6

    this.ensure(rowH)
    this.page.drawRectangle({
      x: MARGIN, y: this.y - rowH + 2, width: 4, height: rowH - 4, color: FAIL_INK,
    })

    let cy = this.y - size - 2
    for (const line of lines) {
      this.page.drawText(line, { x, y: cy, size, font: this.bold, color: FAIL_INK })
      cy -= lh
    }
    for (const line of noteLines) {
      this.page.drawText(line, { x, y: cy, size: 8, font: this.font, color: MUTED })
      cy -= 10
    }
    this.y -= rowH
  }
}

// ── the document ──────────────────────────────────────────────────────────────

function unitLabel(rec: PMPdfRecord): string {
  return [rec.unitNumber, rec.manufacturer, rec.model].map(str).filter(Boolean).join(' ')
}

function summaryLine(report: PMReportSummary): string {
  const parts = [
    `${report.total} inspected`,
    `${report.passed} pass`,
    `${report.failed} fail`,
    `${report.na} N/A`,
  ]
  if (report.unrecorded > 0) parts.push(`${report.unrecorded} not recorded`)
  return parts.join('  ·  ')
}

function writeSections(L: Layout, sections: PMReportSection[]) {
  for (const section of sections) {
    L.openSectionBlock(section.title)
    for (const item of section.items) {
      L.itemRow(item.id, item.text, item.label, item.failed)
    }
    L.closeSectionBlock()
    L.gap(10)
  }
}

/**
 * Render one or more PM checklists as a single PDF.
 *
 * Returns the raw bytes. Callers decide what to do with them — the route streams them,
 * the email builder base64s them — so this function has no opinion about transport.
 */
export async function renderPMReportPdf(
  records: PMPdfRecord[],
  meta:    PMPdfMeta,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`PM Inspection Report${meta.invoiceNumber ? ` ${meta.invoiceNumber}` : ''}`)
  pdf.setProducer('National Wrench Index HD Suite')
  pdf.setCreator('National Wrench Index HD Suite')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const L = new Layout(pdf, font, bold)

  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    const label = unitLabel(rec) || 'Unit'

    // The masthead is the header for this page, so the running strip is suppressed
    // here and switched on for every page the record spills onto. Each PM in a
    // multi-PM document starts its own page: they are separate records of separate
    // units, and running them together across a break reads as one inspection.
    L.setRunningTitle('')
    L.newPage()
    L.setRunningTitle(
      records.length > 1
        ? `PM Inspection Report — ${label} (${i + 1} of ${records.length})`
        : `PM Inspection Report — ${label}`,
    )

    // ── masthead, first page of each record ──────────────────────────────────
    L.page.drawText(winAnsi(meta.businessName).toUpperCase(), {
      x: MARGIN, y: L.y - 15, size: 14, font: bold, color: INK,
    })
    L.y -= 20
    L.page.drawText('PM INSPECTION REPORT', {
      x: MARGIN, y: L.y - 16, size: 19, font: bold, color: ORANGE,
    })
    if (meta.invoiceNumber) {
      const inv = `Invoice ${winAnsi(meta.invoiceNumber)}`
      L.page.drawText(inv, {
        x: PAGE_W - MARGIN - bold.widthOfTextAtSize(inv, 11),
        y: L.y - 13, size: 11, font: bold, color: INK,
      })
    }
    L.y -= 24
    L.page.drawLine({
      start: { x: MARGIN, y: L.y }, end: { x: PAGE_W - MARGIN, y: L.y },
      thickness: 2, color: ORANGE,
    })
    L.y -= 18

    if (records.length > 1) {
      L.text(`PM Record ${i + 1} of ${records.length}`, { size: 8, bold: true, color: MUTED })
      L.gap(6)
    }

    // ── unit details ─────────────────────────────────────────────────────────
    L.blockTitle('Unit Details')
    L.fact('Unit Number',    str(rec.unitNumber) ?? '—')
    L.fact('Manufacturer',   str(rec.manufacturer) ?? '—')
    L.fact('Model',          str(rec.model) ?? '—')
    L.fact('Serial Number',  str(rec.serial) ?? '—')
    L.fact('PM Type',        str(rec.pmType) ?? '—')
    L.fact('Date Completed', fmtDay(rec.completedAt))
    L.fact('Customer',       str(rec.customerName) ?? '—')
    L.fact('Technician',     str(rec.techName) ?? '—')
    L.gap(14)

    // ── result summary ───────────────────────────────────────────────────────
    const clean = rec.report.failed === 0
    L.ensure(38)
    L.page.drawRectangle({
      x: MARGIN, y: L.y - 36, width: CONTENT_W, height: 36,
      color: clean ? rgb(0.94, 0.98, 0.95) : FAIL_BG,
      borderColor: clean ? PASS_INK : FAIL_INK,
      borderWidth: 1,
    })
    const verdict = clean ? 'PASS' : 'ATTENTION REQUIRED'
    L.page.drawText(verdict, {
      x: MARGIN + 12, y: L.y - 15, size: 12, font: bold,
      color: clean ? PASS_INK : FAIL_INK,
    })
    L.page.drawText(summaryLine(rec.report), {
      x: MARGIN + 12, y: L.y - 29, size: 9, font, color: INK,
    })
    L.y -= 36
    L.gap(16)

    // ── flagged items ────────────────────────────────────────────────────────
    if (rec.flagged.length > 0) {
      L.blockTitle(`Flagged Items — Customer Review (${rec.flagged.length})`)
      for (const f of rec.flagged) {
        L.flaggedLine(str(f.text) ?? 'Flagged item', str(f.section))
      }
      L.gap(14)
    }

    // ── the complete inspection record ───────────────────────────────────────
    if (rec.report.sections.length > 0) {
      L.blockTitle(
        `Complete Inspection Record — ${rec.report.total} Point${rec.report.total === 1 ? '' : 's'}`,
      )
      L.text('Every point inspected on this unit, with its result.', { size: 8.5, color: MUTED })
      L.gap(8)
      writeSections(L, rec.report.sections)
    } else {
      L.blockTitle('Complete Inspection Record')
      L.text('No inspection points were recorded on this checklist.', { size: 9.5, color: MUTED })
      L.gap(10)
    }

    // ── certification / lock ─────────────────────────────────────────────────
    L.gap(6)
    L.blockTitle('Technician Certification')
    L.fact('Technician', str(rec.techName) ?? '—')
    L.fact('Checklist ID', rec.checklistId.slice(0, 8))
    L.text(
      rec.signed
        ? 'Electronically signed by the technician named above.'
        : 'No signature was captured for this checklist. This document is a record of the inspection results only.',
      { size: 8.5, color: MUTED },
    )

    const locked = fmtStamp(rec.lockedAt)
    if (locked) {
      L.gap(4)
      L.text(`Record locked ${locked}`, { size: 8.5, bold: true, color: INK })
    }
  }

  // ── footers ────────────────────────────────────────────────────────────────
  // Drawn last because "of N" is not knowable until the whole document has been laid
  // out. A reader who drops a printed report on the floor can put it back together.
  const pages = pdf.getPages()
  const generated = winAnsi(new Date().toLocaleString('en-US'))
  pages.forEach((page, i) => {
    page.drawLine({
      start: { x: MARGIN, y: BOTTOM_Y - 6 }, end: { x: PAGE_W - MARGIN, y: BOTTOM_Y - 6 },
      thickness: 0.5, color: RULE,
    })
    page.drawText(`Generated ${generated} · National Wrench Index HD Suite`, {
      x: MARGIN, y: BOTTOM_Y - 20, size: 7.5, font, color: FAINT,
    })
    const num = `Page ${i + 1} of ${pages.length}`
    page.drawText(num, {
      x: PAGE_W - MARGIN - font.widthOfTextAtSize(num, 7.5),
      y: BOTTOM_Y - 20, size: 7.5, font, color: FAINT,
    })
  })

  return pdf.save()
}
