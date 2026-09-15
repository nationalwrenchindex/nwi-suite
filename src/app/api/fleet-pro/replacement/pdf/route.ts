// GET /api/fleet-pro/replacement/pdf — the replacement report as a real PDF.
//
// ── WHY A PDF AND NOT HTML-WITH-A-PRINT-BUTTON ───────────────────────────────
// This document goes into a budget meeting. It is attached to an agenda, forwarded
// to a finance officer and printed for people who will not be at a laptop, and a
// .html attachment is what a mail client quarantines or refuses to open on a phone.
// Same reasoning, and the same library, as src/lib/hd/pm-report-pdf.ts: pdf-lib is
// pure JavaScript with no native binary and no headless browser, which is the only
// shape that survives Vercel's serverless runtime. Puppeteer would drag ~300MB of
// Chromium behind it for one page of numbers.
//
// ── THE COST OF THAT CHOICE ──────────────────────────────────────────────────
// pdf-lib has no layout engine — only "draw this string at this x/y". The Layout
// class below is the small one this document needs: measure, wrap, track a cursor,
// and cut a new page before the cursor runs off the bottom. A 60-unit fleet can
// easily produce a multi-page list, and a renderer that silently drew past the
// bottom of page one would drop most of the report with nothing looking wrong.
//
// ── GREYSCALE ────────────────────────────────────────────────────────────────
// These get printed on whatever is in the shop. An urgent candidate is marked three
// ways that all survive a black-and-white printer: a solid bar down the left edge,
// the heading in bold, and the word URGENT in caps against "Review" in mixed case.
// The red is a bonus for whoever reads it on screen, never the thing carrying the
// meaning.
//
// The report itself is built by the same buildReplacementReport() the JSON route
// calls, so the page on screen and the page in the meeting cannot drift apart.

import { NextResponse } from 'next/server'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { buildReplacementReport } from '@/lib/fleet-pro/replacement'
import { canViewCosts } from '@/types/fleet-pro'
import {
  formatDaysDown,
  formatMoney,
  replacementReason,
  unitLabel,
  type ReplacementCandidate,
  type ReplacementReport,
} from '@/types/fleet-pro-replacement'

export const dynamic = 'force-dynamic'

// ── page geometry (mirrors pm-report-pdf.ts so the two documents look related) ─

const PAGE_W = 612          // US Letter, portrait
const PAGE_H = 792
const MARGIN = 48
const CONTENT_W = PAGE_W - MARGIN * 2
const TOP_Y = PAGE_H - MARGIN
const BOTTOM_Y = 56

const ORANGE   = rgb(1, 0.4, 0)
const INK      = rgb(0.1, 0.1, 0.1)
const MUTED    = rgb(0.45, 0.45, 0.45)
const FAINT    = rgb(0.72, 0.72, 0.72)
const RULE     = rgb(0.87, 0.88, 0.89)
const SHADE    = rgb(0.949, 0.953, 0.957)
const URGENT_INK = rgb(0.6, 0.05, 0.05)
const URGENT_BG  = rgb(0.996, 0.949, 0.949)

// ── text safety ───────────────────────────────────────────────────────────────

// The standard PDF fonts encode WinAnsi and pdf-lib THROWS on anything outside it.
// Unit numbers, models and fleet names are operator-entered and can hold whatever a
// phone keyboard produces, so anything unencodable becomes '?' — a report with one
// mangled character still reaches the meeting, a throw in the download path does not.
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

/**
 * Greedy wrap to a pixel width against the real font metrics. A single word wider
 * than the column is broken by character rather than allowed to run into the margin,
 * where it is invisible in the printed copy.
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

function fmtStamp(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
}

// ── the layout engine ─────────────────────────────────────────────────────────

interface TextOpts {
  size?:  number
  bold?:  boolean
  color?: RGB
  x?:     number
  width?: number
}

/**
 * A cursor walking down a growing stack of pages. Every write goes through ensure(),
 * which is the single place that decides a page is full, so there is no path by which
 * content is emitted below the bottom margin and lost.
 */
class Layout {
  page!: PDFPage
  y = 0
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
      this.page.drawText(winAnsi(this.runningTitle), {
        x: MARGIN, y: this.y - 8, size: 8, font: this.font, color: FAINT,
      })
      this.y -= 18
      this.page.drawLine({
        start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y },
        thickness: 0.5, color: RULE,
      })
      this.y -= 16
    }
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
    const size  = opts.size ?? 10
    const font  = opts.bold ? this.bold : this.font
    const x     = opts.x ?? MARGIN
    const width = opts.width ?? (PAGE_W - MARGIN - x)
    const lines = wrap(winAnsi(value), font, size, width)
    const lh    = size * 1.35

    for (const line of lines) {
      this.ensure(lh)
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK })
      this.y -= lh
    }
  }

  /** A bar-headed block title: "REPLACEMENT CANDIDATES", "VALUE NOT ON FILE". */
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
    const labelW = 150
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

  /** A shaded strip used for the summary band at the top of page one. */
  summaryBand(pairs: { label: string; value: string }[]) {
    const h = 44
    this.ensure(h + 8)
    this.page.drawRectangle({ x: MARGIN, y: this.y - h, width: CONTENT_W, height: h, color: SHADE })

    const colW = CONTENT_W / Math.max(1, pairs.length)
    pairs.forEach((p, i) => {
      const x = MARGIN + i * colW + 10
      this.page.drawText(winAnsi(p.label).toUpperCase(), {
        x, y: this.y - 16, size: 7, font: this.bold, color: MUTED,
      })
      this.page.drawText(winAnsi(p.value), {
        x, y: this.y - 33, size: 13, font: this.bold, color: INK,
      })
    })

    this.y -= h + 10
  }
}

// ── the document ──────────────────────────────────────────────────────────────

/**
 * One candidate block: heading row, the reason sentence, then the six metrics the
 * brief calls for. Kept in one function so the block is measured and drawn together
 * and a heading can never be stranded at the foot of a page without its numbers.
 */
function drawCandidate(L: Layout, c: ReplacementCandidate, report: ReplacementReport, bold: PDFFont) {
  const urgent = c.level === 'urgent'
  const heading = `${c.unit_number || 'Unit'}${unitLabel(c) ? ` — ${unitLabel(c)}` : ''}`

  // Demand room for the heading plus the reason line plus two facts, so a block only
  // ever splits somewhere in the middle of its own metrics.
  L.ensure(78)

  const headH = 20
  if (urgent) {
    L.page.drawRectangle({ x: MARGIN, y: L.y - headH, width: CONTENT_W, height: headH, color: URGENT_BG })
    L.page.drawRectangle({ x: MARGIN, y: L.y - headH, width: 4, height: headH, color: URGENT_INK })
  }

  // Caps vs mixed case is one of the three greyscale cues; see the header note.
  const badge = urgent ? 'URGENT' : 'Review'

  L.page.drawText(winAnsi(heading), {
    x: MARGIN + 10, y: L.y - 14, size: 11, font: bold, color: urgent ? URGENT_INK : INK,
  })
  L.page.drawText(badge, {
    x: PAGE_W - MARGIN - bold.widthOfTextAtSize(badge, 8) - 6,
    y: L.y - 13, size: 8, font: bold, color: urgent ? URGENT_INK : MUTED,
  })
  L.y -= headH + 4

  L.text(replacementReason(c, report.thresholds), { size: 9, color: MUTED, x: MARGIN + 10, width: CONTENT_W - 10 })
  L.gap(4)

  L.fact('12-month repair spend', formatMoney(c.cost_12mo))
  L.fact('Estimated current value', c.estimated_value === null
    ? 'Not set — cost rule could not be applied'
    : `${formatMoney(c.estimated_value)}${c.value_updated_at ? ` (as of ${c.value_updated_at})` : ''}`)
  L.fact('Repair cost as % of value', c.cost_ratio_pct === null
    ? '—'
    : `${c.cost_ratio_pct.toFixed(0)}%  (fleet limit ${report.thresholds.cost_ratio_pct}%)`)
  L.fact('Breakdowns in 12 months', `${c.breakdown_count}  (fleet limit ${report.thresholds.breakdown_min})`)
  L.fact('Average days down each', c.avg_days_down === null
    ? 'Not measurable — no dated work orders'
    : `${formatDaysDown(c.avg_days_down)} over ${c.measured_downtime_events} of ${c.breakdown_count}`)
  if (c.open_work_orders > 0) {
    L.fact('Still in the shop', `${c.open_work_orders} open work order${c.open_work_orders === 1 ? '' : 's'} — downtime still accruing`)
  }
  L.fact('Billable repair events', `${c.repair_events} (invoices + outside vendor invoices)`)

  L.gap(8)
  L.ensure(2)
  L.page.drawLine({
    start: { x: MARGIN, y: L.y }, end: { x: PAGE_W - MARGIN, y: L.y },
    thickness: 0.4, color: RULE,
  })
  L.gap(10)
}

async function renderReplacementPdf(report: ReplacementReport): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  pdf.setTitle(`Replacement Recommendations — ${report.fleet_name}`)
  pdf.setProducer('National Wrench Index Fleet Pro')
  pdf.setCreator('National Wrench Index Fleet Pro')

  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)

  const L = new Layout(pdf, font, bold)
  L.setRunningTitle(`${report.fleet_name} — Replacement Recommendations`)
  L.newPage()

  // ── masthead ────────────────────────────────────────────────────────────────
  L.text('NWI FLEET PRO', { size: 8, bold: true, color: ORANGE })
  L.gap(2)
  L.text('Replacement Recommendations', { size: 20, bold: true })
  L.text(report.fleet_name, { size: 12, color: MUTED })
  L.gap(6)
  L.text(
    `Rolling ${report.window_months} months from ${report.window_start}. Generated ${fmtStamp(report.generated_at)}.`,
    { size: 9, color: MUTED },
  )
  // The thresholds are printed on the document itself. Somebody in the meeting will
  // ask why a truck is on the list, and the answer has to be on the paper in front of
  // them rather than in a settings screen nobody present can open.
  L.text(
    `Flagged when 12-month repairs exceed ${report.thresholds.cost_ratio_pct}% of estimated value, `
    + `or the unit has ${report.thresholds.breakdown_min} or more breakdowns.`,
    { size: 9, color: MUTED },
  )
  L.gap(14)

  L.summaryBand([
    { label: 'Units reviewed', value: String(report.unit_count) },
    { label: 'Flagged',        value: String(report.candidate_count) },
    { label: 'Urgent',         value: String(report.urgent_count) },
    { label: 'Their 12-mo spend', value: formatMoney(report.candidate_spend) },
  ])

  // ── candidates ──────────────────────────────────────────────────────────────
  L.blockTitle('Replacement candidates')

  if (report.candidates.length === 0) {
    L.text('No unit crossed either threshold in this window.', { size: 10, color: MUTED })
    L.gap(12)
  } else {
    for (const c of report.candidates) drawCandidate(L, c, report, bold)
  }

  // ── units with no valuation ─────────────────────────────────────────────────
  // Printed even though these are not candidates. A report that silently evaluated
  // only half the fleet is worse than one that says which half it could not reach.
  if (report.missing_value.length > 0) {
    L.gap(6)
    L.blockTitle('Value not on file')
    L.text(
      `${report.missing_value.length} unit${report.missing_value.length === 1 ? ' has' : 's have'} no estimated value recorded, `
      + 'so the cost-vs-value rule could not be applied to them. Their breakdown counts were still checked. '
      + 'Set a value in Fleet Pro to bring them into the cost test.',
      { size: 9, color: MUTED },
    )
    L.gap(8)

    for (const u of report.missing_value) {
      L.ensure(14)
      L.page.drawText(winAnsi(u.unit_number || 'Unit'), {
        x: MARGIN + 10, y: L.y - 9, size: 9.5, font, color: INK,
      })
      const spend = formatMoney(u.cost_12mo)
      L.page.drawText(winAnsi(spend), {
        x: PAGE_W - MARGIN - font.widthOfTextAtSize(spend, 9.5),
        y: L.y - 9, size: 9.5, font, color: MUTED,
      })
      L.y -= 14
    }
  }

  return pdf.save()
}

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return new NextResponse(gate.error, { status: gate.status })

  const { membership } = gate
  // Same refusal as the JSON route: this document is nothing but cost.
  if (!canViewCosts(membership.role)) {
    return new NextResponse('Cost data is not available to read-only viewers', { status: 403 })
  }

  const svc = createServiceClient()

  let bytes: Uint8Array
  let report: ReplacementReport
  try {
    report = await buildReplacementReport(svc, membership)
    bytes  = await renderReplacementPdf(report)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not build the replacement report'
    console.error('[fleet-pro/replacement/pdf]', message)
    return new NextResponse('Could not build the replacement report', { status: 500 })
  }

  const slug = (report.fleet_name || 'fleet')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'fleet'
  const filename = `replacement-recommendations-${slug}-${report.generated_at.slice(0, 10)}.pdf`

  // `attachment`, unlike the PM report's `inline`: this is fetched to be filed with a
  // budget packet and emailed on, not glanced at in a browser tab.
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      String(bytes.length),
      'Cache-Control':       'private, no-store',
    },
  })
}
