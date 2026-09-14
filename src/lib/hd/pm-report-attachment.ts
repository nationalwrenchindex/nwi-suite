// The PM report — one generator, two consumers.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// The PM report is reachable two ways: the tech opens /api/hd/pm-checklist/[id]/pdf
// and prints it, or the customer receives it attached to the invoice email. Those are
// the same document and must stay the same document, so both call the loader here
// rather than each assembling their own. A second generator would mean the printed copy
// and the emailed copy could disagree about what was inspected, and the customer holds
// one of them as the record of the job.
//
// ── A REAL PDF ───────────────────────────────────────────────────────────────
// This used to emit a self-contained HTML document with a print button, like
// /api/hd/invoices/[id]/pdf and /api/hd/dot-inspections/[id]/pdf still do, and let the
// browser make the PDF. That works for a link a human clicks and fails at the thing
// this file mostly does, which is hand a file to an email: a .html attachment is what a
// customer's mail client quarantines or simply will not open on a phone. The drawing
// now lives in ./pm-report-pdf.ts and this file is the data loader in front of it —
// reading the rows, resolving the units, flattening both into the record shape the
// renderer draws.
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
import { renderPMReportPdf, type PMPdfRecord } from '@/lib/hd/pm-report-pdf'

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

function str(value: unknown): string | null {
  const s = value == null ? '' : String(value).trim()
  return s.length ? s : null
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

/**
 * Load the given checklists and render them as one PDF.
 *
 * Shared by the PDF route (one id, after it has made its own access decision) and by
 * the invoice email attachment (every id resolved off the invoice), so the copy the
 * tech prints and the copy the customer receives are the same bytes for the same input.
 *
 * Rows are read with the client handed in, so the caller's access rules apply — pass a
 * user-scoped client for a request, a service client only after checking ownership.
 */
export async function renderPMReportDocumentForChecklists(
  client:       SupabaseClient,
  checklistIds: string[],
  opts: { invoiceNumber?: string | null } = {},
): Promise<{ filename: string; bytes: Uint8Array } | null> {
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
  if (ordered.length === 0) return null

  const unitIds = [...new Set(ordered.map(r => str(r.unit_id)).filter(Boolean) as string[])]
  const ownerId = str(ordered[0].user_id) ?? ''

  const [{ data: units }, { data: profile }] = await Promise.all([
    unitIds.length
      ? client
          .from('hd_units')
          .select('id, unit_number, manufacturer, model, serial_number')
          .in('id', unitIds)
      : Promise.resolve({ data: [] as Row[] }),
    ownerId
      ? client.from('profiles').select('business_name').eq('id', ownerId).maybeSingle()
      : Promise.resolve({ data: null as Row | null }),
  ])

  const unitById = new Map(((units ?? []) as Row[]).map(u => [String(u.id), u]))

  const records: PMPdfRecord[] = ordered.map(pm => {
    const unit = unitById.get(str(pm.unit_id) ?? '')
    return {
      unitNumber:   str(unit?.unit_number),
      manufacturer: str(unit?.manufacturer),
      model:        str(unit?.model),
      // hd_units is the live record; hd_pm_checklists.unit_serial is the copy taken at
      // the time the PM was performed, and is all that survives when the unit row was
      // never linked or has since been removed.
      serial:       str(unit?.serial_number) ?? str(pm.unit_serial),
      pmType:       str(pm.pm_type),
      completedAt:  str(pm.completed_at) ?? str(pm.created_at),
      techName:     str(pm.tech_name) ?? str(pm.tech_initials),
      customerName: str(pm.customer_name),
      checklistId:  String(pm.id),
      report:       buildPMReport(pm.checklist_data),
      flagged:      Array.isArray(pm.flagged_items) ? (pm.flagged_items as Flagged[]) : [],
      lockedAt:     str(pm.locked_at),
      signed:       Boolean(str(pm.signature_base64)),
    }
  })

  // Named for the invoice it supports, because that is the number the customer quotes
  // when they ring up about it. Only a report pulled outside an invoice — the tech
  // printing a PM straight off the checklist — falls back to the unit.
  const nameSource =
    str(opts.invoiceNumber)
    ?? records[0].unitNumber
    ?? records[0].checklistId.slice(0, 8)

  return {
    filename: `PM-Report-${safeFilePart(nameSource) || 'record'}.pdf`,
    bytes: await renderPMReportPdf(records, {
      businessName:  str(profile?.business_name) ?? 'Heavy Duty Service',
      invoiceNumber: str(opts.invoiceNumber),
    }),
  }
}

/**
 * The PM report for an invoice, ready to attach to the outgoing email.
 *
 * `content` is the PDF already base64-encoded, which is the shape every mail provider
 * wants an attachment in. The encoding happens here rather than at the call site so the
 * send path never has to know whether the payload is text or binary — when this file
 * changed from emitting HTML to emitting a PDF, that was the difference between one
 * edit and a silently corrupt attachment.
 *
 * Returns null when the invoice has no linked PM — the normal case for most invoices,
 * not an error. Never throws: this runs inside the invoice send path, and a problem
 * building a supporting report must never stop an invoice reaching the customer.
 */
export async function buildPMReportAttachment(
  svc:       SupabaseClient,
  userId:    string,
  invoiceId: string,
): Promise<{ filename: string; content: string } | null> {
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

    const doc = await renderPMReportDocumentForChecklists(
      svc,
      linked.map(p => p.id),
      { invoiceNumber: str((inv as Row).invoice_number) },
    )
    if (!doc) return null

    return {
      filename: doc.filename,
      content:  Buffer.from(doc.bytes).toString('base64'),
    }
  } catch (err) {
    console.error('[pm-report-attachment] build failed:', err instanceof Error ? err.message : err)
    return null
  }
}
