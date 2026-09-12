// The printable PM report — one generator, two consumers.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The PM report is reachable two ways: the tech opens /api/hd/pm-checklist/[id]/pdf
// and prints it, or the customer receives it attached to the invoice email. Those are
// the same document and must stay the same document, so both call the renderer here
// rather than each assembling their own HTML. A second generator would mean the printed
// copy and the emailed copy could disagree about what was inspected, and the customer
// holds one of them as the record of the job.
//
// ── NO PDF LIBRARY ───────────────────────────────────────────────────────────
// This is a self-contained HTML document with a print button, exactly like
// /api/hd/invoices/[id]/pdf and /api/hd/dot-inspections/[id]/pdf. The browser makes the
// PDF. Styling is deliberately the light print palette of those two documents, not the
// dark HD screen palette — this is paper, and a customer is going to print it.
//
// ── LINKAGE ──────────────────────────────────────────────────────────────────
// A PM reaches an invoice by two different routes and both are real:
//   * hd_pm_checklists.invoice_id — the PM was attached to the invoice directly.
//   * hd_pm_checklists.work_order_id = hd_invoices.work_order_id — the PM and the
//     invoice came off the same job. This writer was added later, and a PM linked only
//     this way was previously invisible on the invoice.
// Both are queried and the results de-duplicated by checklist id, because one PM can
// carry both links and one job can carry several PMs.

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPMReport, type PMReportSummary } from '@/lib/hd/pm-report-items'

type Row = Record<string, unknown>

interface Flagged { id?: string; text?: string; section?: string }

/** A PM linked to an invoice, with its counts already joined, for list display. */
export interface PMChecklistListItem {
  id:           string
  pm_type:      string | null
  completed_at: string | null
  created_at:   string | null
  report:       PMReportSummary
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Everything printed here is operator-entered text landing in an HTML document. */
function esc(value: unknown): string {
  if (value == null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function str(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
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
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US')
}

/** A filename has to survive Content-Disposition and a Windows download folder. */
function safeFilePart(value: string): string {
  return value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
}

// ── linkage ───────────────────────────────────────────────────────────────────

const LIST_COLUMNS = 'id, pm_type, completed_at, created_at, checklist_data'

/**
 * Every PM belonging to an invoice, both ways, de-duplicated by checklist id.
 *
 * `workOrderId` is passed in rather than re-read because callers already hold the
 * invoice row; pass null when the invoice has no work order and the second lookup is
 * skipped entirely. Always scoped to `userId` — a PM is the mechanic's record.
 */
export async function findInvoicePMChecklists(
  client:      SupabaseClient,
  userId:      string,
  invoiceId:   string,
  workOrderId: string | null = null,
): Promise<PMChecklistListItem[]> {
  const [byInvoice, byWorkOrder] = await Promise.all([
    client
      .from('hd_pm_checklists')
      .select(LIST_COLUMNS)
      .eq('invoice_id', invoiceId)
      .eq('user_id', userId),
    workOrderId
      ? client
          .from('hd_pm_checklists')
          .select(LIST_COLUMNS)
          .eq('work_order_id', workOrderId)
          .eq('user_id', userId)
      : Promise.resolve({ data: [] as Row[] }),
  ])

  // A PM carrying both links comes back from both queries. Keyed by id, first wins.
  const merged = new Map<string, Row>()
  for (const row of [
    ...((byInvoice.data ?? []) as Row[]),
    ...((byWorkOrder.data ?? []) as Row[]),
  ]) {
    const id = str(row.id)
    if (id && !merged.has(id)) merged.set(id, row)
  }

  return [...merged.values()]
    .map(row => ({
      id:           String(row.id),
      pm_type:      str(row.pm_type),
      completed_at: str(row.completed_at),
      created_at:   str(row.created_at),
      report:       buildPMReport(row.checklist_data),
    }))
    // Oldest first, so a multi-PM job reads in the order it was performed.
    .sort((a, b) =>
      (a.completed_at ?? a.created_at ?? '').localeCompare(b.completed_at ?? b.created_at ?? ''))
}

// ── document ──────────────────────────────────────────────────────────────────

interface LoadedRecord {
  pm:        Row
  unitLabel: string
  unitNumber: string | null
  report:    PMReportSummary
  flagged:   Flagged[]
}

const STATE_CLASS: Record<string, string> = {
  Pass: 'r-pass', Fail: 'r-fail', 'N/A': 'r-na', 'Not recorded': 'r-na',
}

function factGrid(rows: { label: string; value: string }[]): string {
  return `
    <div class="info-grid">
      ${rows.map(f => `
      <div class="fact">
        <div class="fact-label">${esc(f.label)}</div>
        <div class="fact-value">${esc(f.value)}</div>
      </div>`).join('')}
    </div>`
}

/** One PM rendered as a full record: facts, failures, every point, signature. */
function renderRecord(rec: LoadedRecord, index: number, count: number): string {
  const { pm, report, flagged } = rec
  const clean = report.failed === 0
  const battery = pm.battery_cca != null
    ? `${pm.battery_cca} CCA${Number(pm.battery_cca) < 800 ? ' — REPLACE' : ''}`
    : '—'

  const facts = factGrid([
    { label: 'PM Type',             value: str(pm.pm_type) ?? '—' },
    { label: 'Unit',                value: rec.unitLabel || '—' },
    { label: 'Customer',            value: str(pm.customer_name) ?? '—' },
    { label: 'Date Completed',      value: fmtDay(pm.completed_at ?? pm.created_at) },
    { label: 'Technician',          value: str(pm.tech_name) ?? str(pm.tech_initials) ?? '—' },
    { label: 'Items Inspected',     value: String(report.total) },
    { label: 'Passed',              value: String(report.passed) },
    { label: 'Failed',              value: String(report.failed) },
    { label: 'Not Applicable',      value: String(report.na) },
    { label: 'Battery CCA',         value: battery },
    { label: 'Alarm Codes Found',   value: str(pm.alarm_codes_found) ?? '—' },
    { label: 'Alarm Codes Cleared', value: str(pm.alarm_codes_cleared) ?? '—' },
  ])

  const flaggedBlock = flagged.length ? `
  <div class="box box-fail">
    <h3>Flagged Items — Customer Review (${flagged.length})</h3>
    ${flagged.map(f => `
      <p class="viol">
        <span class="fail-mark">&#10007;</span> ${esc(f.text)}
        ${f.section ? `<span class="viol-note">${esc(f.section)}</span>` : ''}
      </p>`).join('')}
  </div>` : `
  <div class="box">
    <h3>Flagged Items — Customer Review</h3>
    <p class="ok">None — every inspected item passed.</p>
  </div>`

  // COMPLETE INSPECTION RECORD. The whole point of the document: the customer can see
  // each of the points the tech actually inspected and what it came back as, instead of
  // a failure list and an implied "everything else was fine".
  const recordBlock = report.sections.length ? `
  <div class="info-box">
    <h3>Complete Inspection Record — ${report.total} Point${report.total === 1 ? '' : 's'}</h3>
    <p class="sub">Every point inspected on this unit, with its result.</p>
    ${report.sections.map(section => `
    <div class="sec-head">${esc(section.title)}</div>
    ${section.items.map(item => `
    <div class="item${item.failed ? ' item-fail' : ''}">
      <span class="item-id">${esc(item.id)}</span>
      <span class="item-text">${esc(item.text)}</span>
      <span class="badge ${STATE_CLASS[item.label] ?? 'r-na'}">${esc(item.label.toUpperCase())}</span>
    </div>`).join('')}`).join('')}
  </div>` : `
  <div class="box">
    <h3>Complete Inspection Record</h3>
    <p class="muted">No inspection points were recorded on this checklist.</p>
  </div>`

  const sig      = str(pm.signature_base64)
  const lockedAt = pm.locked ? fmtStamp(pm.locked_at) : null

  return `
  ${count > 1 ? `<div class="rec-head">PM Record ${index + 1} of ${count}${rec.unitNumber ? ` &mdash; Unit ${esc(rec.unitNumber)}` : ''}</div>` : ''}

  <div class="result-strip ${clean ? 'result-pass' : 'result-fail'}">
    <span class="result-word">${clean ? 'PASS' : 'ATTENTION'}</span>
    <span class="result-note">
      ${report.passed} passed &bull; ${report.failed} failed &bull; ${report.na} N/A
      ${report.unrecorded > 0 ? ` &bull; ${report.unrecorded} not recorded` : ''}
    </span>
  </div>

  <div class="info-box">
    <h3>Unit &amp; Service Information</h3>
    ${facts}
  </div>

  ${flaggedBlock}

  ${recordBlock}

  <div class="sign-box">
    <h3>Technician Certification</h3>
    <div class="sign-body">
      <div class="sign-label">Technician</div>
      <div class="sign-value">${esc(str(pm.tech_name) ?? str(pm.tech_initials) ?? '—')}</div>
      ${sig
        ? `<img class="sign-img" src="${esc(sig)}" alt="Technician signature">`
        : `<span class="unsigned">NO SIGNATURE CAPTURED</span>`}
      <div class="attest">
        ${sig
          ? `Electronically signed${lockedAt ? ` &bull; record locked ${esc(lockedAt)}` : ''}.`
          : 'No signature was captured for this checklist. This document is a record of the inspection results only.'}
        <br>Checklist ID ${esc(String(pm.id).slice(0, 8))}
      </div>
    </div>
  </div>`
}

function renderDocument(
  records: LoadedRecord[],
  meta: { businessName: string; invoiceNumber: string | null },
): string {
  const totals = records.reduce(
    (acc, r) => ({
      total:  acc.total  + r.report.total,
      failed: acc.failed + r.report.failed,
    }),
    { total: 0, failed: 0 },
  )

  const headline = records.length === 1
    ? (records[0].unitLabel || 'Preventive Maintenance')
    : `${records.length} PM Records`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PM Report ${esc(meta.invoiceNumber ?? headline)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 13px; color: #1a1a1a; background: #f5f5f5; }
  .page { background: #fff; max-width: 800px; margin: 24px auto; padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; border-bottom: 3px solid #FF6600; padding-bottom: 20px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand-icon { width: 44px; height: 44px; background: #FF6600; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
  .brand-icon svg { width: 28px; height: 28px; stroke: white; fill: none; stroke-width: 2; }
  .brand-name { font-size: 20px; font-weight: 800; letter-spacing: 1px; color: #1a1a1a; }
  .brand-sub { font-size: 11px; color: #888; margin-top: 2px; }
  .doc-meta { text-align: right; }
  .doc-title { font-size: 15px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 4px; }
  .citation { font-size: 11px; color: #888; letter-spacing: 0.5px; text-transform: uppercase; }
  .doc-number { font-size: 20px; font-weight: 700; color: #FF6600; }
  .doc-meta p { font-size: 12px; color: #555; margin-top: 4px; }
  .rec-head { margin: 28px 0 12px; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #555; border-top: 2px solid #e5e7eb; padding-top: 16px; }
  .result-strip { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 6px; margin-bottom: 20px; }
  .result-pass { background: #dcfce7; border: 2px solid #16a34a40; }
  .result-fail { background: #fee2e2; border: 2px solid #dc262640; }
  .result-word { font-size: 28px; font-weight: 800; letter-spacing: 1px; }
  .result-pass .result-word { color: #16a34a; }
  .result-fail .result-word { color: #dc2626; }
  .result-note { font-size: 12px; color: #555; }
  .info-box { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 20px; overflow: hidden; }
  .info-box h3, .box h3, .sign-box h3 { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; }
  .info-box h3, .sign-box h3 { background: #f9f9f9; padding: 6px 12px; border-bottom: 1px solid #e5e7eb; }
  .sub { padding: 6px 12px 0; font-size: 10px; color: #999; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; }
  .fact { padding: 6px 12px; border-bottom: 1px solid #f1f1f1; border-right: 1px solid #f1f1f1; }
  .fact-label { font-size: 8px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
  .fact-value { font-size: 11px; font-weight: 600; margin-top: 2px; word-break: break-word; }
  .sec-head { background: #f3f4f6; border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 5px 12px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #555; }
  .item { display: flex; align-items: center; gap: 8px; padding: 5px 12px; border-bottom: 1px solid #f6f6f6; }
  .item-fail { background: #fff5f5; }
  .item-id { font-size: 9px; color: #bbb; width: 40px; flex-shrink: 0; }
  .item-text { flex: 1; font-size: 11px; }
  .item-fail .item-text { color: #991b1b; font-weight: 600; }
  .badge { font-size: 9px; font-weight: 700; padding: 2px 8px; border-radius: 9px; flex-shrink: 0; }
  .r-pass { background: #dcfce7; color: #16a34a; }
  .r-fail { background: #fee2e2; color: #dc2626; }
  .r-na   { background: #f3f4f6; color: #6b7280; }
  .box { margin-bottom: 20px; padding: 12px; background: #f9f9f9; border: 1px solid #e5e7eb; border-radius: 6px; }
  .box-fail { background: #fff5f5; border-color: #fecaca; }
  .box h3 { margin-bottom: 8px; }
  .viol { font-size: 12px; color: #b91c1c; line-height: 1.5; margin-bottom: 6px; }
  .viol-note { display: block; color: #999; font-size: 10px; margin-top: 1px; }
  .fail-mark { font-weight: 700; }
  .ok { font-size: 12px; color: #16a34a; font-weight: 600; }
  .muted { font-size: 12px; color: #888; }
  .sign-box { border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 20px; }
  .sign-body { padding: 12px; }
  .sign-label { font-size: 8px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
  .sign-value { font-size: 12px; font-weight: 700; margin-bottom: 8px; }
  .sign-img { max-height: 80px; max-width: 100%; }
  .unsigned { display: inline-block; font-size: 11px; font-weight: 700; color: #b91c1c; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; padding: 4px 10px; }
  .attest { margin-top: 10px; font-size: 9px; color: #888; line-height: 1.4; }
  .footer { margin-top: 28px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #e5e7eb; padding-top: 16px; }
  .no-print { text-align: center; margin-bottom: 24px; }
  .print-btn { background: #FF6600; color: white; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; }
  @media print {
    body { background: white; }
    .page { margin: 0; padding: 32px; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
    img { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .item, .sec-head, .box, .sign-box, .result-strip { break-inside: avoid; }
  }
</style>
</head>
<body>
<div class="no-print">
  <button class="print-btn" onclick="window.print()">Download / Print PDF</button>
</div>
<div class="page">
  <div class="header">
    <div class="brand">
      <div class="brand-icon">
        <svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>
      </div>
      <div>
        <div class="brand-name">NWI HD SUITE</div>
        <div class="brand-sub">${esc(meta.businessName)}</div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">Preventive Maintenance Report</div>
      <div class="citation">Complete inspection record</div>
      ${meta.invoiceNumber ? `<div class="doc-number">${esc(meta.invoiceNumber)}</div>` : ''}
      <p>${esc(headline)}</p>
      <p>${totals.total} point${totals.total === 1 ? '' : 's'} inspected &bull; ${totals.failed} failed</p>
    </div>
  </div>

  ${records.map((rec, i) => renderRecord(rec, i, records.length)).join('')}

  <div class="footer">
    <p>Generated ${esc(fmtStamp(new Date().toISOString()) ?? '')} &bull; National Wrench Index HD Suite</p>
  </div>
</div>
</body>
</html>`

  return html
}

/**
 * Load the given checklists and render them as one printable document.
 *
 * Shared by the PDF route (one id, after it has made its own access decision) and by
 * the invoice email attachment (every id resolved off the invoice), so the printed and
 * the emailed copy are byte-identical for the same input.
 *
 * Rows are read with the client handed in, so the caller's access rules apply — pass a
 * user-scoped client for a request, a service client only after checking ownership.
 */
export async function renderPMReportDocumentForChecklists(
  client:      SupabaseClient,
  checklistIds: string[],
  opts: { invoiceNumber?: string | null } = {},
): Promise<{ filename: string; html: string } | null> {
  if (checklistIds.length === 0) return null

  const { data } = await client
    .from('hd_pm_checklists')
    .select('*')
    .in('id', checklistIds)

  const rows = (data ?? []) as Row[]
  if (rows.length === 0) return null

  // Preserve the caller's order — `.in()` does not guarantee it.
  const byId = new Map(rows.map(r => [String(r.id), r]))
  const ordered = checklistIds.map(id => byId.get(id)).filter(Boolean) as Row[]

  const unitIds = [...new Set(ordered.map(r => str(r.unit_id)).filter(Boolean) as string[])]
  const ownerId = str(ordered[0].user_id) ?? ''

  const [{ data: units }, { data: profile }] = await Promise.all([
    unitIds.length
      ? client.from('hd_units').select('id, unit_number, manufacturer, model').in('id', unitIds)
      : Promise.resolve({ data: [] as Row[] }),
    ownerId
      ? client.from('profiles').select('business_name').eq('id', ownerId).maybeSingle()
      : Promise.resolve({ data: null as Row | null }),
  ])

  const unitById = new Map(((units ?? []) as Row[]).map(u => [String(u.id), u]))

  const records: LoadedRecord[] = ordered.map(pm => {
    const unit = unitById.get(str(pm.unit_id) ?? '')
    return {
      pm,
      unitNumber: str(unit?.unit_number),
      unitLabel:  [str(unit?.unit_number), str(unit?.manufacturer), str(unit?.model)]
        .filter(Boolean).join(' '),
      report:  buildPMReport(pm.checklist_data),
      flagged: Array.isArray(pm.flagged_items) ? (pm.flagged_items as Flagged[]) : [],
    }
  })

  const nameSource =
    records[0].unitNumber
    ?? str(opts.invoiceNumber)
    ?? records[0].unitLabel
    ?? String(records[0].pm.id).slice(0, 8)

  return {
    filename: `PM-Report-${safeFilePart(nameSource || 'record')}.html`,
    html: renderDocument(records, {
      businessName:  str(profile?.business_name) ?? 'Heavy Duty Service',
      invoiceNumber: str(opts.invoiceNumber),
    }),
  }
}

/**
 * The PM report for an invoice, ready to attach to the outgoing email.
 *
 * Returns null when the invoice has no linked PM — the normal case for most invoices,
 * not an error. Never throws: this runs inside the invoice send path, and a problem
 * building a supporting report must never stop an invoice reaching the customer.
 */
export async function buildPMReportAttachment(
  svc:       SupabaseClient,
  userId:    string,
  invoiceId: string,
): Promise<{ filename: string; html: string } | null> {
  try {
    const { data: inv } = await svc
      .from('hd_invoices')
      .select('id, invoice_number, work_order_id')
      .eq('id', invoiceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (!inv) return null

    const linked = await findInvoicePMChecklists(
      svc, userId, invoiceId, str((inv as Row).work_order_id),
    )
    if (linked.length === 0) return null

    return await renderPMReportDocumentForChecklists(
      svc,
      linked.map(p => p.id),
      { invoiceNumber: str((inv as Row).invoice_number) },
    )
  } catch (err) {
    console.error('[pm-report-attachment] build failed:', err instanceof Error ? err.message : err)
    return null
  }
}
