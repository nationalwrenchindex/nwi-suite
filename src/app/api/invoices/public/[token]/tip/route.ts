// POST /api/invoices/public/[token]/tip
// Public endpoint — no auth. Customer submits tip + confirms payment.
// Updates tip_amount_cents, flips status to 'paid', fires in-app notification.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()

  let body: { tip_cents?: number }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const tipCents = Math.max(0, Math.round(Number(body.tip_cents) || 0))

  // Fetch invoice to validate state
  const { data: invoice, error: fetchErr } = await sc
    .from('invoices')
    .select('id, invoice_status, total, user_id, invoice_number, customer:customers(first_name, last_name)')
    .eq('public_token', token)
    .single()

  if (fetchErr || !invoice) {
    return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 })
  }

  if (invoice.invoice_status === 'paid' || invoice.invoice_status === 'void') {
    return NextResponse.json({ error: 'Invoice is already closed.' }, { status: 409 })
  }

  const now = new Date().toISOString()

  // Update invoice: record tip and mark paid
  const { data: updated, error: updateErr } = await sc
    .from('invoices')
    .update({
      tip_amount_cents: tipCents,
      invoice_status:   'paid',
      paid_at:          now,
    })
    .eq('public_token', token)
    .select('id, invoice_number, invoice_status, total, tip_amount_cents')
    .single()

  if (updateErr || !updated) {
    console.error('[POST /api/invoices/public/[token]/tip]', updateErr)
    return NextResponse.json({ error: 'Failed to confirm payment.' }, { status: 500 })
  }

  // Fire in-app notification for the tech (fire-and-forget)
  const inv = invoice as Record<string, unknown>
  const customer = inv.customer as { first_name?: string; last_name?: string } | null
  const customerName = customer
    ? `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Customer'
    : 'Customer'
  const totalFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format((Number(inv.total) || 0) + tipCents / 100)
  const tipFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
    .format(tipCents / 100)

  void sc.from('notifications').insert({
    user_id: inv.user_id as string,
    type:    'invoice_paid',
    title:   `${customerName} confirmed payment`,
    body:    tipCents > 0
      ? `Invoice ${inv.invoice_number} — ${totalFmt} (includes ${tipFmt} tip)`
      : `Invoice ${inv.invoice_number} — ${totalFmt}`,
    link:    `/financials?tab=invoices`,
  })

  return NextResponse.json({ invoice: updated })
}
