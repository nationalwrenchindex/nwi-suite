import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { acceptRoadieQuote } from '@/lib/roadie/client'
import { chargeDeliveryFee } from '@/lib/roadie/stripe-charge'

export const maxDuration = 30

interface DispatchBody { deliveryId: string }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: DispatchBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body.deliveryId) return NextResponse.json({ error: 'deliveryId required' }, { status: 400 })

  // Load + verify ownership + state.
  const { data: delivery, error: readErr } = await supabase
    .from('parts_deliveries')
    .select('id, user_id, status, parts_confirmed, roadie_quote_id, roadie_eta_minutes, total_charged_cents, store_name')
    .eq('id', body.deliveryId)
    .maybeSingle()
  if (readErr || !delivery) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
  if (delivery.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (delivery.status !== 'quoted') {
    return NextResponse.json({ error: `Delivery is ${delivery.status}, expected quoted` }, { status: 409 })
  }

  const confirmed = Array.isArray(delivery.parts_confirmed) ? delivery.parts_confirmed : []
  if (confirmed.length === 0) {
    return NextResponse.json({ error: 'Confirm parts with the store before dispatching.' }, { status: 400 })
  }

  const amountCents = delivery.total_charged_cents ?? 0
  if (amountCents <= 0) return NextResponse.json({ error: 'Invalid delivery total.' }, { status: 400 })

  // ── Stripe charge ──
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ error: 'No payment method on file. Add a card in billing first.' }, { status: 402 })
  }

  let payment
  try {
    payment = await chargeDeliveryFee({
      stripeCustomerId: sub.stripe_customer_id,
      amountCents,
      description:      `Parts delivery — ${delivery.store_name ?? 'auto parts store'}`,
      metadata:        { delivery_id: delivery.id, user_id: user.id },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Payment failed'
    console.error('[parts-delivery/dispatch] charge failed', msg)
    await supabase.from('parts_deliveries').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', delivery.id)
    return NextResponse.json({ error: `Payment failed: ${msg}` }, { status: 402 })
  }

  await supabase.from('parts_deliveries').update({
    status:                   'payment_collected',
    stripe_payment_intent_id: payment.paymentIntentId,
    stripe_charge_id:         payment.chargeId,
    payment_collected_at:     new Date().toISOString(),
    updated_at:               new Date().toISOString(),
  }).eq('id', delivery.id)

  // ── Dispatch the Roadie driver ──
  let dispatchResult
  try {
    dispatchResult = await acceptRoadieQuote(delivery.roadie_quote_id ?? '')
  } catch (err) {
    console.error('[parts-delivery/dispatch] Roadie accept failed', err)
    // Payment already collected — flag failed so support/refund can follow up.
    await supabase.from('parts_deliveries').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', delivery.id)
    return NextResponse.json({ error: 'Payment collected but driver dispatch failed. Our team will follow up.' }, { status: 502 })
  }

  await supabase.from('parts_deliveries').update({
    status:              'dispatched',
    roadie_delivery_id:  dispatchResult.deliveryId,
    roadie_tracking_url: dispatchResult.trackingUrl,
    dispatched_at:       new Date().toISOString(),
    updated_at:          new Date().toISOString(),
  }).eq('id', delivery.id)

  // ── Part 9: append the delivery fee to the tech's most recent open HD invoice ──
  try {
    const { data: invoice } = await supabase
      .from('hd_invoices')
      .select('id, line_items, total')
      .eq('user_id', user.id)
      .eq('status', 'unpaid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (invoice) {
      const amount = Math.round(amountCents) / 100
      const lineItems = Array.isArray(invoice.line_items) ? invoice.line_items : []
      lineItems.push({
        id:          crypto.randomUUID(),
        type:        'delivery',
        description: `Parts Delivery — ${delivery.store_name ?? 'auto parts store'}`,
        amount,
      })
      await supabase.from('hd_invoices').update({
        line_items: lineItems,
        total:      Math.round((Number(invoice.total ?? 0) + amount) * 100) / 100,
        updated_at: new Date().toISOString(),
      }).eq('id', invoice.id)
    }
  } catch (e) {
    // Non-fatal — the tech can add the line manually.
    console.error('[parts-delivery/dispatch] invoice line item failed', e)
  }

  return NextResponse.json({
    trackingUrl: dispatchResult.trackingUrl,
    driverName:  null,
    driverPhone: null,
    etaMinutes:  delivery.roadie_eta_minutes ?? null,
  })
}
