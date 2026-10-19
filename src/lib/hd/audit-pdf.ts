// The two audit exports as real PDFs: the equipment schedule (spec 5.2) and the audit
// packet (spec 5.3).
//
// Same approach as src/lib/hd/pm-report-pdf.ts, for the same reasons: pdf-lib is pure
// JavaScript and survives Vercel's serverless runtime; it has no layout engine, so this
// file carries its own - measure, wrap to the column, walk a cursor down the page and
// cut a new page before the cursor reaches the footer. Nothing draws at an absolute y
// below the content area, so nothing can be lost off the bottom of a page.
//
// Tables re-draw their header on every page they spill onto. Every page carries the
// same footer: the generated date, the source line an auditor will ask about, and
// "Page n of N" (drawn last, when N is known).
//
// PRESENTATION ONLY. Every figure arrives already decided by audit-schedule.ts /
// audit-packet.ts; this file formats, it never sums or recomputes. A null prints as
// "Not recorded" in a fact and "-" in a table cell, never as 0.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { fmtShopDate } from '@/lib/shop-time'
import type { AuditSchedule } from './audit-schedule'
import { APPROVER_STATEMENT, peakValueStatement, type AuditPacket, type PacketEntry } from './audit-packet'

export const AUDIT_FOOTER_SOURCE = 'Generated from work orders and invoices recorded in NWI Suite'
export const NOT_RECORDED = 'Not recorded'

// ── geometry ────────────────────────────────────────────────────────────────

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 44
const CONTENT_W = PAGE_W - MARGIN * 2
const TOP_Y = PAGE_H - MARGIN
const BOTTOM_Y = 58

const ORANGE = rgb(1, 0.4, 0)
const INK = rgb(0.1, 0.1, 0.1)
const MUTED = rgb(0.42, 0.42, 0.42)
const FAINT = rgb(0.6, 0.6, 0.6)
const RULE = rgb(0.85, 0.86, 0.87)
const SHADE = rgb(0.94, 0.945, 0.95)
const WARN = rgb(0.6, 0.05, 0.05)

// ── text safety (WinAnsi only; pdf-lib throws on anything else) ─────────────

const CP1252_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

export function winAnsi(value: unknown): string {
  if (value == null) return ''
  let out = ''
  for (const ch of String(value)) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 9 || code === 10 || code === 13) { out += ' '; continue }
    if (code >= 0x20 && code <= 0x7e) { out += ch; continue }
    if (code >= 0xa0 && code <= 0xff) { out += ch; continue }
    if (CP1252_EXTRAS.has(code)) { out += ch; continue }
    // U+202F / U+00A0-like spaces from Intl formatting become plain spaces.
    if (code === 0x202f || code === 0x2009) { out += ' '; continue }
    out += '?'
  }
  return out
}

// ── formatting ──────────────────────────────────────────────────────────────

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number | null | undefined, nullText = '-') => (n == null ? nullText : USD.format(n))
const hours = (n: number | null | undefined, nullText = '-') =>
  (n == null ? nullText : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }))
const plain = (v: string | number | null | undefined, nullText = '-') => {
  if (v == null) return nullText
  const s = String(v).trim()
  return s.length ? s : nullText
}
const day = (d: string | null | undefined, tz: string, nullText = NOT_RECORDED) => (d ? fmtShopDate(d, tz) : nullText)
function stamp(s: string | null | undefined, tz: string): string {
  if (!s) return NOT_RECORDED
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-US', { timeZone: tz, year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
}
const pretty = (s: string | null) => (s ? s.replace(/_/g, ' ') : null)

// ── the layout engine ───────────────────────────────────────────────────────

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
      if (chunk && font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch }
      else chunk += ch
    }
    cur = chunk
  }
  if (cur) lines.push(cur)
  return lines.length ? lines : ['']
}

export interface Column { header: string; width: number; align?: 'left' | 'right' }

class Layout {
  page!: PDFPage
  y = 0
  runningTitle = ''
  /** Re-draws an open table's header on a fresh page. */
  private repeatHeader: (() => void) | null = null

  constructor(readonly pdf: PDFDocument, readonly font: PDFFont, readonly bold: PDFFont) {}

  newPage() {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H])
    this.y = TOP_Y
    if (this.runningTitle) {
      this.page.drawText(winAnsi(this.runningTitle), { x: MARGIN, y: this.y - 8, size: 8, font: this.font, color: FAINT })
      this.y -= 16
      this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.5, color: RULE })
      this.y -= 12
    }
    if (this.repeatHeader) this.repeatHeader()
  }

  ensure(h: number) { if (!this.page || this.y - h < BOTTOM_Y) this.newPage() }
  gap(n: number) { if (this.y - n >= BOTTOM_Y) this.y -= n }

  text(value: string, opts: { size?: number; bold?: boolean; color?: RGB } = {}) {
    const size = opts.size ?? 9.5
    const font = opts.bold ? this.bold : this.font
    const lh = size * 1.35
    for (const line of wrap(winAnsi(value), font, size, CONTENT_W)) {
      this.ensure(lh)
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color: opts.color ?? INK })
      this.y -= lh
    }
  }

  blockTitle(title: string) {
    this.ensure(26 + 14 + 6)
    if (this.y < TOP_Y - 30) this.y -= 6
    this.page.drawRectangle({ x: MARGIN, y: this.y - 14, width: 3, height: 12, color: ORANGE })
    this.page.drawText(winAnsi(title).toUpperCase(), { x: MARGIN + 9, y: this.y - 12, size: 9, font: this.bold, color: INK })
    this.y -= 20
  }

  fact(label: string, value: string, opts: { warn?: boolean } = {}) {
    const size = 9
    const labelW = 150
    const lh = size * 1.35
    const labelLines = wrap(winAnsi(label).toUpperCase(), this.bold, 7, labelW - 8)
    const lines = wrap(winAnsi(value) || NOT_RECORDED, opts.warn ? this.bold : this.font, size, CONTENT_W - labelW)
    const h = Math.max(lines.length * lh, (labelLines.length - 1) * 9 + lh)
    this.ensure(h)
    labelLines.forEach((l, i) => this.page.drawText(l, { x: MARGIN, y: this.y - size - i * 9, size: 7, font: this.bold, color: MUTED }))
    lines.forEach((l, i) => this.page.drawText(l, {
      x: MARGIN + labelW, y: this.y - size - i * lh, size, font: opts.warn ? this.bold : this.font, color: opts.warn ? WARN : INK,
    }))
    this.y -= h + 1.5
  }

  /** A table whose header repeats on every page it reaches. Widths are fractions of the content width. */
  table(columns: Column[], rows: Array<{ cells: string[]; bold?: boolean }>, size = 8) {
    const total = columns.reduce((s, c) => s + c.width, 0)
    const widths = columns.map(c => (c.width / total) * CONTENT_W)
    const xs: number[] = []
    widths.reduce((x, w) => { xs.push(x); return x + w }, MARGIN)
    const pad = 3
    const lh = size + 2.5

    const drawHeader = () => {
      const lines = columns.map((c, i) => wrap(winAnsi(c.header), this.bold, size - 0.5, widths[i] - pad * 2))
      const h = Math.max(...lines.map(l => l.length)) * lh + 5
      this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: SHADE })
      lines.forEach((ls, i) => ls.forEach((l, j) => {
        const w = this.bold.widthOfTextAtSize(l, size - 0.5)
        const x = columns[i].align === 'right' ? xs[i] + widths[i] - pad - w : xs[i] + pad
        this.page.drawText(l, { x, y: this.y - 3 - size - j * lh, size: size - 0.5, font: this.bold, color: rgb(0.25, 0.25, 0.25) })
      }))
      this.y -= h
    }

    // Demand room for the header and one row before starting, so a header is never
    // stranded alone at the foot of a page.
    this.ensure(lh * 2 + 14)
    drawHeader()
    this.repeatHeader = drawHeader
    try {
      for (const row of rows) {
        const font = row.bold ? this.bold : this.font
        const lines = columns.map((_, i) => wrap(winAnsi(row.cells[i] ?? ''), font, size, widths[i] - pad * 2))
        const h = Math.max(...lines.map(l => l.length)) * lh + 4
        this.ensure(h)
        lines.forEach((ls, i) => ls.forEach((l, j) => {
          const w = font.widthOfTextAtSize(l, size)
          const x = columns[i].align === 'right' ? xs[i] + widths[i] - pad - w : xs[i] + pad
          this.page.drawText(l, { x, y: this.y - 2 - size - j * lh, size, font, color: INK })
        }))
        this.y -= h
        this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.4, color: RULE })
      }
    } finally {
      this.repeatHeader = null
    }
  }

  masthead(shopName: string, addressLines: string[], title: string) {
    this.page.drawText(winAnsi(shopName).toUpperCase(), { x: MARGIN, y: this.y - 14, size: 13, font: this.bold, color: INK })
    this.y -= 18
    for (const a of addressLines) {
      this.page.drawText(winAnsi(a), { x: MARGIN, y: this.y - 9, size: 9, font: this.font, color: MUTED })
      this.y -= 12
    }
    this.y -= 6
    for (const line of wrap(winAnsi(title).toUpperCase(), this.bold, 17, CONTENT_W)) {
      this.page.drawText(line, { x: MARGIN, y: this.y - 16, size: 17, font: this.bold, color: ORANGE })
      this.y -= 21
    }
    this.y -= 3
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 2, color: ORANGE })
    this.y -= 14
  }
}

function drawFooters(pdf: PDFDocument, font: PDFFont, generated: string) {
  const pages = pdf.getPages()
  pages.forEach((page, i) => {
    page.drawLine({ start: { x: MARGIN, y: BOTTOM_Y - 8 }, end: { x: PAGE_W - MARGIN, y: BOTTOM_Y - 8 }, thickness: 0.5, color: RULE })
    page.drawText(winAnsi(`Generated ${generated}. ${AUDIT_FOOTER_SOURCE}.`), { x: MARGIN, y: BOTTOM_Y - 21, size: 7.5, font, color: MUTED })
    const n = `Page ${i + 1} of ${pages.length}`
    page.drawText(n, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(n, 7.5), y: BOTTOM_Y - 21, size: 7.5, font, color: MUTED })
  })
}

async function open(title: string) {
  const pdf = await PDFDocument.create()
  pdf.setTitle(winAnsi(title))
  pdf.setProducer('National Wrench Index HD Suite')
  pdf.setCreator('National Wrench Index HD Suite')
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  return { pdf, font, bold, L: new Layout(pdf, font, bold) }
}

const generatedText = (iso: string, tz: string) => stamp(iso, tz)
const periodText = (r: { from: string; to: string }, tz: string) => `${fmtShopDate(r.from, tz)} to ${fmtShopDate(r.to, tz)}`

// ── 5.2 the equipment schedule ──────────────────────────────────────────────

export async function renderAuditSchedulePdf(s: AuditSchedule): Promise<Uint8Array> {
  const T = s.labels.text
  const { pdf, font, L } = await open(`${T.scheduleTitle} ${s.range.from} to ${s.range.to}`)
  const tz = s.timeZone

  L.newPage()
  L.runningTitle = `${s.shop.name} - ${T.scheduleTitle} - ${s.range.from} to ${s.range.to}`
  L.masthead(s.shop.name, s.shop.addressLines, T.scheduleTitle)
  L.fact(T.policyPeriod, periodText(s.range, tz))
  L.fact('Generated', generatedText(s.generatedAt, tz))
  L.gap(8)

  const hoursCell = (v: number | null, missing: number, jobs: number) =>
    v == null ? (jobs ? NOT_RECORDED : '-') : missing > 0 ? `${hours(v)} (${missing} without)` : hours(v)

  L.table(
    [
      { header: T.classColumn, width: 3 },
      { header: T.unitsInClass, width: 1.3, align: 'right' },
      { header: T.unitsServiced, width: 1.3, align: 'right' },
      { header: T.jobs, width: 1, align: 'right' },
      { header: T.laborHours, width: 1.7, align: 'right' },
      { header: T.totalInvoiced, width: 1.7, align: 'right' },
    ],
    [
      ...s.categories.map(c => ({ cells: [
        c.label, plain(c.unitsInClass), plain(c.unitsServiced), String(c.jobs),
        hoursCell(c.laborHours, c.jobsWithoutHours, c.jobs), money(c.invoiced),
      ] })),
      { bold: true, cells: [
        'Total', String(s.total.unitsInClass), String(s.total.unitsServiced), String(s.total.jobs),
        hoursCell(s.total.laborHours, s.total.jobsWithoutHours, s.total.jobs), money(s.total.invoiced),
      ] },
    ],
    8.5,
  )
  L.gap(8)
  const notes = [
    `${T.unitsInClass} counts the active units on record in each class, serviced or not. ${T.unitsServiced} counts units with at least one job in the period.`,
    'A job is an invoice issued in the period (void invoices excluded), or a closed work order with a recorded total and no invoice. Amounts are the invoice totals as recorded; nothing is recomputed from current rates.',
    `${T.laborHours} are summed from the hours recorded on labor lines. "(N without)" means N jobs recorded no hours and are not in the figure; ${NOT_RECORDED} means none did.`,
  ]
  if (s.jobsFromWorkOrders > 0) notes.push(`${s.jobsFromWorkOrders} of the ${s.total.jobs} jobs are closed work orders with no NWI invoice (including imported history).`)
  for (const n of notes) L.text(n, { size: 7.5, color: MUTED })

  // Appendix, on its own page.
  L.newPage()
  L.blockTitle(T.appendixTitle)
  L.text(s.units.length
    ? 'Every unit with at least one job in the period. Units with no job are counted under units in class only.'
    : 'No unit had a job in the period.', { size: 7.5, color: MUTED })
  L.gap(4)
  if (s.units.length) {
    L.table(
      [
        { header: T.classColumn, width: 1.6 },
        { header: T.unitIdentifier, width: 1.1 },
        { header: T.make, width: 1.2 },
        { header: T.model, width: 1.1 },
        { header: T.year, width: 0.6, align: 'right' },
        { header: T.serial, width: 1.7 },
        { header: T.jobs, width: 0.6, align: 'right' },
        { header: T.laborHours, width: 0.9, align: 'right' },
        { header: T.totalInvoiced, width: 1.2, align: 'right' },
      ],
      s.units.map(u => ({ cells: [
        u.classLabel, plain(u.unitIdentifier), plain(u.make), plain(u.model), plain(u.year), plain(u.serial),
        String(u.jobs), hoursCell(u.laborHours, u.jobsWithoutHours, u.jobs), money(u.invoiced),
      ] })),
      7.5,
    )
  }

  drawFooters(pdf, font, generatedText(s.generatedAt, tz))
  return pdf.save()
}

// ── 5.3 the audit packet ────────────────────────────────────────────────────

export async function renderAuditPacketPdf(p: AuditPacket): Promise<Uint8Array> {
  const T = p.labels.text
  const tz = p.timeZone
  const { pdf, font, L } = await open(`${T.packetTitle} ${p.range.from} to ${p.range.to}`)

  // ── cover ──
  L.newPage()
  L.runningTitle = `${p.shop.name} - ${T.packetTitle} - cover`
  L.masthead(p.shop.name, p.shop.addressLines, T.packetTitle)
  L.fact(T.policyPeriod, periodText(p.range, tz))
  L.fact('Generated', generatedText(p.generatedAt, tz))
  L.gap(8)

  L.blockTitle('Summary')
  L.fact('Work orders in this packet', `${p.entries.length} - opened in the period, one per page after this cover`)
  L.fact('Imported history excluded', p.importedExcluded
    ? `${p.importedExcluded} work order${p.importedExcluded === 1 ? '' : 's'} opened in the period ${p.importedExcluded === 1 ? 'is' : 'are'} imported history from a previous system. ${p.importedExcluded === 1 ? 'It records' : 'They record'} an invoice, not a job performed in NWI, and ${p.importedExcluded === 1 ? 'carries' : 'carry'} no authorization record, so ${p.importedExcluded === 1 ? 'it is' : 'they are'} left out.`
    : 'None')
  L.fact('Cancelled excluded', String(p.cancelledExcluded))
  L.gap(6)

  L.blockTitle('Care, custody and control')
  const pk = p.peak
  L.fact('Peak units in possession', pk.peakUnits
    ? `${pk.peakUnits} unit${pk.peakUnits === 1 ? '' : 's'} on ${day(pk.peakDate, tz)}` +
      (pk.unlinkedAtPeak ? `; ${pk.unlinkedAtPeak} of them on work orders with no unit record linked, each counted as one unit` : '')
    : '0 - no unit was open on a work order on any day of the period')
  L.fact('Peak value exposure', peakValueStatement(pk))
  L.text(`Possession runs from the day a work order opened (arrival, else start, else creation) to the day it closed; an open work order holds its unit to the end of the period. Imported history is excluded because it records an invoice date, not when a unit was in the shop (${pk.importedExcluded} imported work order${pk.importedExcluded === 1 ? '' : 's'} on the account, all dates). Values are hd_units estimated values as entered; a unit with no value is never counted as $0.`, { size: 7.5, color: MUTED })
  L.gap(6)

  L.blockTitle('Authorization')
  const a = p.authorization
  L.fact('Work orders with no recorded authorization', a.missing
    ? `${a.missing} of ${a.checked}: ${a.workOrderNumbers.join(', ')}`
    : `0 of ${a.checked}`, { warn: a.missing > 0 })
  L.fact('Approved by', NOT_RECORDED, { warn: true })
  L.text(APPROVER_STATEMENT, { size: 8, color: INK })
  if (p.missingColumns.length) {
    L.gap(4)
    L.text(`Some fields are not yet available on this account's database and print as ${NOT_RECORDED}: ${p.missingColumns.join(', ')}.`, { size: 7.5, color: WARN })
  }

  // ── one work order per page ──
  p.entries.forEach((e, i) => {
    L.runningTitle = ''
    L.newPage()
    L.runningTitle = `${p.shop.name} - Work order ${e.workOrderNumber ?? e.workOrderId} (continued) - ${i + 1} of ${p.entries.length}`
    writeEntry(L, e, tz, T.classColumn, i, p.entries.length)
  })

  drawFooters(pdf, font, generatedText(p.generatedAt, tz))
  return pdf.save()
}

function writeEntry(L: Layout, e: PacketEntry, tz: string, classLabel: string, i: number, n: number) {
  L.page.drawText(winAnsi(`Work order ${e.workOrderNumber ?? NOT_RECORDED}`), { x: MARGIN, y: L.y - 14, size: 14, font: L.bold, color: INK })
  const right = winAnsi(`${i + 1} of ${n}${e.status ? ` - ${pretty(e.status)}` : ''}`)
  L.page.drawText(right, { x: PAGE_W - MARGIN - L.font.widthOfTextAtSize(right, 9), y: L.y - 12, size: 9, font: L.font, color: MUTED })
  L.y -= 20
  L.page.drawLine({ start: { x: MARGIN, y: L.y }, end: { x: PAGE_W - MARGIN, y: L.y }, thickness: 1.5, color: ORANGE })
  L.y -= 10

  L.blockTitle('Unit')
  L.fact('Unit identifier', plain(e.unit.identifier, NOT_RECORDED))
  L.fact(classLabel, e.unit.classLabel)
  L.fact('Make / model / year', [e.unit.make, e.unit.model, e.unit.year].filter(Boolean).join(' / ') || NOT_RECORDED)
  L.fact('Serial / VIN', [e.unit.serial ? `Serial ${e.unit.serial}` : null, e.unit.vin ? `VIN ${e.unit.vin}` : null].filter(Boolean).join('; ') || NOT_RECORDED)
  if (e.unit.truck) L.fact('Truck', e.unit.truck)
  if (e.unit.filledFromUnitRecord.length) L.text(`Left empty on the work order and filled from the unit record: ${e.unit.filledFromUnitRecord.join(', ')}.`, { size: 7.5, color: MUTED })
  if (!e.unit.linked) L.text('No unit record is linked to this work order; the unit is as the work order recorded it.', { size: 7.5, color: MUTED })

  L.blockTitle('Customer and dates')
  L.fact('Customer', plain(e.customer, NOT_RECORDED))
  L.fact('Fleet account', plain(e.fleetAccount, NOT_RECORDED))
  L.fact('Date opened', day(e.opened, tz))
  L.fact('Date closed', day(e.closed, tz))
  L.fact('Date invoiced', e.invoice ? day(e.invoiced, tz) : 'Not invoiced')

  L.blockTitle('Authorization record')
  L.fact('Authorized at (work order)', stamp(e.authorization.authorizedAt, tz), { warn: !e.authorization.authorizedAt })
  L.fact('Authorization method', plain(pretty(e.authorization.method), NOT_RECORDED))
  L.fact('Customer PO number', plain(e.authorization.poNumber, NOT_RECORDED))
  L.fact('Quote approved at', e.quote ? stamp(e.authorization.quoteApprovedAt, tz) : 'No source quote')
  L.fact('Quote approval method', e.quote ? plain(pretty(e.authorization.quoteApprovalMethod), NOT_RECORDED) : 'No source quote')
  L.fact('Customer response note', e.quote ? plain(e.authorization.quoteResponseNote, NOT_RECORDED) : 'No source quote')
  L.fact('Approved by', NOT_RECORDED)

  L.blockTitle('Approved quote as presented')
  if (!e.quote) {
    L.text('No source quote is linked to this work order.', { size: 8.5, color: MUTED })
  } else {
    const q = e.quote
    L.fact('Quote number', [plain(q.number, NOT_RECORDED), q.status ? `(${pretty(q.status)})` : null].filter(Boolean).join(' '))
    L.fact('Labor rate recorded on quote', money(q.laborRate, NOT_RECORDED))
    if (q.lines.length) {
      L.table(
        [
          { header: 'Type', width: 0.8 }, { header: 'Description', width: 3 }, { header: 'Part #', width: 1.3 },
          { header: 'Qty / hours', width: 0.9, align: 'right' }, { header: 'Unit price', width: 1, align: 'right' },
          { header: 'Amount', width: 1, align: 'right' },
        ],
        q.lines.map(l => ({ cells: [
          l.type, plain(l.description), plain(l.partNumber),
          l.type === 'labor' ? (l.hours == null ? '-' : `${hours(l.hours)} h`) : hours(l.quantity),
          l.type === 'labor' ? '-' : money(l.unitPrice), money(l.amount),
        ] })),
      )
    } else L.text('The quote has no line items recorded.', { size: 8.5, color: MUTED })
    L.gap(4)
    const fees: Array<[string, number | null]> = [
      ['Diagnostic fee', q.diagnosticFee], ['Road call fee', q.roadCallFee], ['Travel', q.travel],
      ['Mileage', q.mileage], ['Shop supplies', q.shopSupplies],
    ]
    const shown = fees.filter(([, v]) => v != null && v !== 0)
    L.fact('Fees recorded on quote', shown.length ? shown.map(([k, v]) => `${k} ${money(v)}`).join('; ') : 'None recorded')
    L.fact('Quote tax', money(q.tax, NOT_RECORDED))
    L.fact('Quote total', money(q.total, NOT_RECORDED))
  }

  const src = e.linesSource === 'invoice' ? `as recorded on invoice ${e.invoice?.number ?? ''}`.trim()
    : e.linesSource === 'work_order' ? 'as recorded on the work order (not invoiced)' : null

  L.blockTitle('Parts installed')
  if (e.parts.length) {
    if (src) L.text(`Sell prices ${src}.`, { size: 7.5, color: MUTED })
    L.table(
      [
        { header: 'Description', width: 3.2 }, { header: 'Part #', width: 1.4 }, { header: 'Qty', width: 0.7, align: 'right' },
        { header: 'Unit price', width: 1.1, align: 'right' }, { header: 'Amount', width: 1.1, align: 'right' },
      ],
      e.parts.map(l => ({ cells: [plain(l.description), plain(l.partNumber), hours(l.quantity), money(l.unitPrice), money(l.amount)] })),
    )
  } else L.text('No parts lines recorded.', { size: 8.5, color: MUTED })

  L.blockTitle('Labor')
  if (e.labor.length) {
    if (src) L.text(e.linesSource === 'invoice'
      ? `Hours and amounts ${src}; the rate is the labor rate recorded on that invoice.`
      : `Hours, rates and amounts ${src}.`, { size: 7.5, color: MUTED })
    L.table(
      [
        { header: 'Description', width: 4 }, { header: 'Hours', width: 0.8, align: 'right' },
        { header: 'Rate', width: 1.1, align: 'right' }, { header: 'Amount', width: 1.1, align: 'right' },
      ],
      e.labor.map(l => ({ cells: [plain(l.description), hours(l.hours), money(l.rate), money(l.amount)] })),
    )
  } else L.text('No labor lines recorded.', { size: 8.5, color: MUTED })

  L.blockTitle('Technician and invoice')
  L.fact('Technician (work order)', plain(e.techWorkOrder, NOT_RECORDED))
  L.fact('Technician (invoice)', e.invoice ? plain(e.techInvoice, NOT_RECORDED) : 'Not invoiced')
  L.fact('Invoice', e.invoice
    ? `${plain(e.invoice.number, NOT_RECORDED)} - ${money(e.invoice.total, 'total not recorded')} - ${plain(pretty(e.invoice.status), 'status not recorded')}`
    : 'Not invoiced')
}
