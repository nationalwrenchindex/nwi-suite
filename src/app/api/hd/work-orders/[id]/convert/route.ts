// GET /api/hd/work-orders/[id]/convert
//
// Assembles the invoice payload for an HD work order: its line items, its recorded
// terms, its identity and the authorization that came off the approved quote.
//
// IT DOES NOT INSERT. The caller POSTs the returned payload to /api/hd/invoices, which
// is the one insert path and already carries the migration 119/140/142 column-tolerance
// retries, already deducts stock through the shared ledger, and already flips the work
// order to 'invoiced'. A second insert here would be two places to keep in step and two
// places for the stock deduction to be forgotten.
//
// WHAT THIS REPLACES: a client-side query string carrying only labor_hours and
// labor_rate, from which the invoice form synthesized one labor line. Every part line a
// technician entered was dropped. See src/lib/hd/wo-to-invoice.ts for the detail.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { buildInvoicePayload, type WorkOrderLineRow } from '@/lib/hd/wo-to-invoice'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  // '*' rather than a column list on purpose: this reads the migration-153 columns
  // (tax_percent, customer_po_number, quote_id) and naming them explicitly would make
  // the whole read fail until 153 is applied - which would block invoicing entirely
  // rather than just losing the tax terms.
  const { data: wo, error } = await supabase
    .from('hd_work_orders')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const row = wo as Record<string, unknown>

  // Already billed. Hand back the invoice that exists rather than letting the caller
  // create a second one - and the unique index from migration 154 is the guard that
  // makes this more than a courtesy.
  {
    const { data: existing } = await supabase
      .from('hd_invoices')
      .select('id, invoice_number, status, total')
      .eq('work_order_id', id)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      return NextResponse.json({
        already_invoiced: true,
        invoice: existing,
        error: `This work order was already billed as ${existing.invoice_number}.`,
      }, { status: 409 })
    }
  }

  const { data: lineRows, error: lineErr } = await supabase
    .from('hd_work_order_line_items')
    .select('id, type, description, part_number, quantity, unit_cost, unit_price, markup_percent, total, sort_order')
    .eq('work_order_id', id)
    .order('sort_order', { ascending: true })

  if (lineErr) {
    console.error('[hd convert] could not read line items:', lineErr)
    return NextResponse.json({ error: 'Could not read the work order line items' }, { status: 500 })
  }

  const rows = (lineRows ?? []) as unknown as WorkOrderLineRow[]
  const payload = buildInvoicePayload(row, rows)

  const partCount  = rows.filter(r => String(r.type ?? '').toLowerCase() === 'part').length
  const laborCount = rows.filter(r => String(r.type ?? '').toLowerCase().startsWith('lab')).length

  return NextResponse.json({
    invoice_payload: payload,
    source: {
      work_order_number: row.work_order_number,
      line_count:        rows.length,
      part_lines:        partCount,
      labor_lines:       laborCount,
      // Surfaced so the UI can say "this work order has no lines" rather than silently
      // producing an empty invoice, which is the shape of the bug being fixed.
      has_lines:         rows.length > 0,
      authorized_at:     row.authorized_at ?? null,
      quote_id:          row.quote_id ?? null,
    },
  })
}
