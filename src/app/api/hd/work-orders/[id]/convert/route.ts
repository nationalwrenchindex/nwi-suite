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
// The payload itself is built by lib/hd/convert-build, which the refresh route
// (POST /api/hd/invoices/[id]/refresh) shares - so a refreshed invoice is priced
// exactly as this conversion would price it.
//
// WHAT THIS REPLACES: a client-side query string carrying only labor_hours and
// labor_rate, from which the invoice form synthesized one labor line. Every part line a
// technician entered was dropped. See src/lib/hd/wo-to-invoice.ts for the detail.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { buildWorkOrderInvoice } from '@/lib/hd/convert-build'
import { isInvoiceLocked, lockedMessage } from '@/lib/hd/invoice-lock'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_work_orders'))
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  // Already billed. Hand back the invoice that exists rather than letting the caller
  // create a second one - and the unique index from migration 154 is the guard that
  // makes this more than a courtesy. Whether it can be REFRESHED from this work order
  // (an open invoice: keeps its number and pay link) rides along, so the screen can
  // offer that instead of delete-and-reconvert.
  {
    const { data: existing } = await supabase
      .from('hd_invoices')
      .select('id, invoice_number, status, total, sent_at, last_sent_at')
      .eq('work_order_id', id)
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (existing?.id) {
      const locked = isInvoiceLocked(existing.status)
      return NextResponse.json({
        already_invoiced: true,
        invoice: existing,
        refreshable: !locked,
        ...(locked ? { refresh_refused: lockedMessage(existing as Record<string, unknown>, 'refreshed') } : {}),
        error: `This work order was already billed as ${existing.invoice_number}.`,
      }, { status: 409 })
    }
  }

  const built = await buildWorkOrderInvoice(supabase, user.id, id)
  if (!built.ok) return NextResponse.json(built.body, { status: built.status })

  return NextResponse.json({ invoice_payload: built.payload, source: built.source })
}
