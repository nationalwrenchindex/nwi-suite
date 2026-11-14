// POST /api/hd/invoices/[id]/refresh - re-bill an existing invoice from its work order.
//
// WHY. The convert route refuses (409) whenever a work order already has an invoice,
// so the only way to correct one was to delete it and convert again. On WO-2026-1576
// that spent three invoice numbers (INV-2026-0055, 0056, 0057) and took the parts off
// the shelf three times: deleting an invoice puts nothing back (the ledger outlives the
// document) and each new invoice deducted again.
//
// WHAT IT DOES, in place, on the same row:
//   - KEEPS the invoice number, its pay link (public_token), its status, its send
//     history, its recorded terms, its customer, unit and notes. Only the MONEY and the
//     LINES are taken from the work order.
//   - PRICES them with the converter (lib/hd/convert-build), so the carried tax is
//     re-based on every current line exactly as a fresh conversion would (5a6ec9bc).
//   - MOVES STOCK BY THE DIFFERENCE between what this invoice already took off the
//     shelf and what it now bills (reconcileInvoiceStock) - never a fresh deduction.
//   - REFUSES a paid, partially paid or void invoice outright.
//   - On an invoice already SENT, records that the customer holds an older copy
//     (changed_after_send_at, migration 188, and a dated internal note).
//
// A refresh that changes nothing writes nothing and moves no stock.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { buildWorkOrderInvoice } from '@/lib/hd/convert-build'
import { isInvoiceLocked, lockedMessage, changedAfterSendFields, customerFacingChanges, appendDatedNote, wasSent } from '@/lib/hd/invoice-lock'
import { reconcileInvoiceStock, releaseAllocations } from '@/lib/inventory/ledger'

export const dynamic = 'force-dynamic'

/**
 * What a refresh takes from the work order: the money and the lines. Everything else
 * on the invoice - number, token, status, send stamps, terms snapshot, customer, unit,
 * notes, readings - is the invoice's own and stays.
 */
const REFRESH_KEYS = [
  'line_items', 'subtotal_labor', 'subtotal_parts', 'parts_cost', 'parts_sell', 'total', 'discount',
  'labor_rate', 'labor_hours', 'parts_markup_percent',
  'tax_rate', 'tax_amount', 'tax_breakdown',
  'travel_hours', 'travel_rate', 'travel_amount',
  'mileage_miles', 'mileage_rate', 'mileage_amount',
  'shop_supplies_percent_applied', 'shop_supplies_cap_applied', 'shop_supplies_fee',
  'diagnostic_fee', 'road_call_fee', 'service_call_fee', 'service_call_tax',
] as const

const usd = (n: unknown) => `$${(Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)}`

/** Two line arrays that are the same apart from row ids (line and job). */
function sameLinesIgnoringIds(a: unknown, b: unknown): boolean {
  const strip = (v: unknown) => (Array.isArray(v) ? v : []).map(l => {
    const { id: _id, job_id: _job, ...rest } = (l ?? {}) as Record<string, unknown>
    void _id; void _job
    return Object.fromEntries(Object.entries(rest).sort(([x], [y]) => x.localeCompare(y)))
  })
  return Array.isArray(a) && Array.isArray(b) && JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_invoices'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data: invRow } = await supabase.from('hd_invoices').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (!invRow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const stored = invRow as Record<string, unknown>

  if (isInvoiceLocked(stored.status)) {
    return NextResponse.json({ error: lockedMessage(stored, 'refreshed'), reason: 'locked', status: stored.status }, { status: 409 })
  }
  const woId = typeof stored.work_order_id === 'string' ? stored.work_order_id : ''
  if (!woId) {
    return NextResponse.json({ error: `${String(stored.invoice_number)} was not made from a work order, so there is nothing to refresh it from.`, reason: 'no_work_order' }, { status: 422 })
  }

  const built = await buildWorkOrderInvoice(supabase, user.id, woId)
  if (!built.ok) return NextResponse.json(built.body, { status: built.status })

  // Only the refresh keys, and only columns this invoice row has: the row was read with
  // '*', so a key the database lacks (an unapplied migration) is simply not written.
  const update: Record<string, unknown> = {}
  for (const k of REFRESH_KEYS) if (k in built.payload && k in stored) update[k] = built.payload[k]

  // Every work order line save deletes and re-inserts the rows, so the same lines come
  // back with new ids. Lines that differ only in ids are the SAME lines: the stored
  // array is kept, and a sent invoice is not marked changed over a re-save.
  if (sameLinesIgnoringIds(update.line_items, stored.line_items)) update.line_items = stored.line_items

  const changed = customerFacingChanges(stored, update)
  const moneyChanged = changed.length > 0

  if (moneyChanged) {
    const note = `Refreshed from ${String(stored.work_order_number ?? 'its work order')}: total ${usd(stored.total)} -> ${usd(update.total)}, tax ${usd(stored.tax_amount)} -> ${usd(update.tax_amount)}. Number and pay link kept.`
    update.internal_notes = appendDatedNote(stored.internal_notes, note)
    Object.assign(update, changedAfterSendFields(stored, update, 'refresh'))
    update.updated_at = new Date().toISOString()

    const { error } = await supabase.from('hd_invoices').update(update).eq('id', id).eq('user_id', user.id)
    if (error) {
      console.error('[hd/invoices/:id/refresh] update failed', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  // The work order is billed again (it was reopened to be corrected).
  const { error: woError } = await supabase.from('hd_work_orders')
    .update({ status: 'invoiced' }).eq('id', woId).eq('user_id', user.id).neq('status', 'cancelled')
  if (woError) console.error('[hd/invoices/:id/refresh] work order status flip failed', woError)

  // STOCK: the difference only. Runs even when the money did not move - a refresh is
  // also how an invoice whose stock never matched its lines is brought into line.
  let stock: Awaited<ReturnType<typeof reconcileInvoiceStock>> | null = null
  try {
    stock = await reconcileInvoiceStock({
      userId: user.id, invoiceKind: 'hd', invoiceId: id,
      invoiceRef: (stored.invoice_number as string | null) ?? null,
      lineItems: moneyChanged ? update.line_items : stored.line_items,
      createdBy: user.id,
    })
    await releaseAllocations(user.id, 'hd', woId, 'invoiced')
    if (stock.errors.length) console.error('[hd/invoices/:id/refresh] stock errors', stock.errors)
  } catch (err) {
    console.error('[hd/invoices/:id/refresh] stock reconcile threw, invoice still refreshed:', err instanceof Error ? err.message : String(err))
  }

  const { data: fresh } = await supabase.from('hd_invoices').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  return NextResponse.json({
    invoice: fresh ?? stored,
    changed,
    was: { total: stored.total, tax_amount: stored.tax_amount },
    sent_before: wasSent(stored),
    stock,
  })
}
