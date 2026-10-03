// POST /api/work-orders/[id]/convert — bill a completed work order.
//
// Creates an in_progress invoice from the work order and locks the work order to
// it, exactly as api/quotes/[id]/convert does for a quote. The invoice numbering is
// the same parse-the-last-number scheme, so work orders and quotes draw from one
// sequence rather than two that can collide.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { writeToleratingMigration142 } from '@/lib/migration-142'
import { hasWorkOrders } from '@/lib/work-orders'
import { WORK_ORDER_SELECT } from '../../list'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { isBillable } from '@/types/segments'
import { invoiceFromSegments, jobNotesFromSegments } from '@/lib/segments/invoice'
import { parseBreakdown } from '@/lib/tax'

export const dynamic = 'force-dynamic'

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin)
`

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasWorkOrders(supabase, user.id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 403 })
  }

  const { data: wo, error: fetchErr } = await supabase
    .from('work_orders')
    .select(WORK_ORDER_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Billing an unfinished job is almost always a misclick, and the customer gets a
  // bill for work still on the lift.
  if (wo.status !== 'complete') {
    return NextResponse.json(
      { error: 'Only a completed work order can be invoiced.' },
      { status: 400 },
    )
  }

  if (wo.converted_invoice_id) {
    return NextResponse.json(
      { error: 'This work order has already been invoiced.', invoice_id: wo.converted_invoice_id },
      { status: 409 },
    )
  }

  // Same numbering as the quote converter: read recent numbers and continue the
  // sequence, tolerating older invoices whose numbers do not parse.
  const year = new Date().getFullYear()
  const { data: lastInvoices } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  let nextNum = 1
  for (const inv of lastInvoices ?? []) {
    const parts = String(inv.invoice_number).split('-')
    if (parts.length === 3 && parts[1] === String(year)) {
      const n = parseInt(parts[2], 10)
      if (!isNaN(n) && n >= nextNum) nextNum = n + 1
    }
  }
  const invoice_number = `INV-${year}-${String(nextNum).padStart(4, '0')}`

  const today = new Date().toISOString().slice(0, 10)
  const now   = new Date().toISOString()

  // ── Segment-priced or parent-priced ─────────────────────────────────────────
  // A work order is one or the other and never both (the segments route refuses to
  // mix them). With segments, ONLY authorized and complete ones are billed: a
  // declined clutch must not appear on the invoice for the PCM, and a segment still
  // awaiting the customer's OK must not either.
  const { data: segRows } = await supabase
    .from('work_order_segments')
    .select(SEGMENT_SELECT)
    .eq(PARENTS.ld.fkColumn, id)
    .eq('user_id', user.id)
    .order('sequence', { ascending: true })

  const segments = shapeSegments(segRows)
  const billable = segments.filter(seg => isBillable(seg.status))

  if (segments.length > 0 && billable.length === 0) {
    return NextResponse.json(
      { error: 'Nothing on this work order has been authorized yet, so there is nothing to invoice.' },
      { status: 422 },
    )
  }

  const money = segments.length > 0
    ? invoiceFromSegments(billable)
    : {
        // Legacy parent-priced, computed exactly as it was before segments existed.
        line_items: (wo.line_items ?? []) as unknown[],
        subtotal:   Number(wo.parts_subtotal ?? 0) * (1 + Number(wo.parts_markup_percent ?? 0) / 100) + Number(wo.labor_subtotal ?? 0),
        tax_amount: Number(wo.tax_amount ?? 0),
        tax_rate:   Number(wo.tax_percent ?? 0) / 100,
        total:      Number(wo.grand_total ?? 0),
        // A parent-priced work order carries its own breakdown if it was priced after
        // migration 140, and null otherwise.
        tax_breakdown: parseBreakdown((wo as { tax_breakdown?: unknown }).tax_breakdown),
      }

  const invoiceInsert = {
    user_id:          user.id,
    invoice_number,
    invoice_date:     today,
    customer_id:      wo.customer_id ?? null,
    vehicle_id:       wo.vehicle_id  ?? null,
    line_items:       money.line_items,
    subtotal:         money.subtotal,
    tax_rate:         money.tax_rate,
    tax_amount:       money.tax_amount,
    // Carried forward from the segments rather than recomputed: the customer already
    // approved these figures, and re-deriving them here is how two screens start
    // disagreeing about one job.
    tax_breakdown:    money.tax_breakdown,
    discount_amount:  0,
    total:            money.total,
    status:           'draft',
    source:           'work_order',
    // The job description is what the customer authorised; the tech notes are
    // internal and deliberately not carried onto a document the customer reads.
    // The job description is what the customer authorised; the tech notes are
    // internal and deliberately not carried onto a document the customer reads.
    //
    // unit_label is appended when there is no vehicle_id: invoices have no free-text
    // unit field, so an invoice for a "boat trailer" would otherwise name nothing at
    // all for the customer to recognise.
    notes:            [wo.job_description, !wo.vehicle_id && wo.unit_label ? `Unit: ${wo.unit_label}` : null]
                        .filter(Boolean).join(' — ') || null,
    invoice_status:   'in_progress',
    // Everything the work order carried, including the PO the fleet will match the
    // payment against. Retyping it is how invoice and PO stop agreeing.
    po_number:        wo.po_number ?? null,
    // What was DONE, carried from the segments and labelled by segment rather than
    // retyped. Customer-visible (/invoice/[token] renders job_notes) and fully
    // editable afterwards — nothing here is locked. Parent-priced work orders have
    // no segments to describe, so they keep the null they have always had.
    job_notes:        segments.length > 0 ? jobNotesFromSegments(billable) : null,
    shop_supplies:    [],
    additional_parts: [],
    additional_labor: [],
    started_at:       now,

    // ── The pricing terms, recorded on the invoice itself (migration 142) ──
    // Previously reachable only through source_quote_id, which a work-order
    // conversion does not have — so the markup read 0 and gross profit came out
    // as exactly zero on every invoice billed this way.
    parts_markup_percent: wo.parts_markup_percent ?? null,
    parts_subtotal:       wo.parts_subtotal ?? null,
    labor_subtotal:       wo.labor_subtotal ?? null,
    labor_hours:          wo.labor_hours ?? null,
    labor_rate:           wo.labor_rate ?? null,

    unit_number:    wo.unit_number ?? null,
    // 2c: the tech notes finally have somewhere to go that is NOT customer-facing.
    // They used to be dropped entirely, because `notes` and `job_notes` both print.
    internal_notes: wo.tech_notes ?? null,

    // ── Billable extras, carried at the rate that was charged ──
    // Copied, never recomputed: the customer was shown these figures.
    travel_hours:                  wo.travel_hours   ?? 0,
    travel_rate:                   wo.travel_rate    ?? null,
    travel_amount:                 wo.travel_amount  ?? 0,
    mileage_miles:                 wo.mileage_miles  ?? 0,
    mileage_rate:                  wo.mileage_rate   ?? null,
    mileage_amount:                wo.mileage_amount ?? 0,
    shop_supplies_percent_applied: wo.shop_supplies_percent_applied ?? null,
    shop_supplies_cap_applied:     wo.shop_supplies_cap_applied     ?? null,
    shop_supplies_fee:             wo.shop_supplies_fee             ?? 0,
  }

  const { data: invoice, error: insertErr } = await writeToleratingMigration142<
    Record<string, unknown>,
    Record<string, unknown>
  >(
    invoiceInsert as unknown as Record<string, unknown>,
    row => supabase.from('invoices').insert(row).select(INVOICE_SELECT).single(),
  )

  if (insertErr || !invoice) {
    console.error('[POST /api/work-orders/[id]/convert] insert invoice', insertErr)
    const msg = (insertErr as { message?: string } | null)?.message
    return NextResponse.json({ error: msg ?? 'Failed to create invoice' }, { status: 500 })
  }

  // Lock the work order to the invoice. Done after the insert so a failure here
  // cannot lose the invoice; an unlocked work order can be retried, and the
  // already-invoiced guard above is what stops a duplicate.
  const { error: lockErr } = await supabase
    .from('work_orders')
    .update({ converted_invoice_id: invoice.id, converted_at: now })
    .eq('id', id)
    .eq('user_id', user.id)

  if (lockErr) console.error('[work-orders/convert] lock failed', lockErr)

  return NextResponse.json({ invoice, invoice_id: invoice.id }, { status: 201 })
}
