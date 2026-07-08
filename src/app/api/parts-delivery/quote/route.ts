import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isRoadieEnabled, getRoadieQuote } from '@/lib/roadie/client'
import { calculateDeliveryFee } from '@/lib/roadie/pricing'

export const maxDuration = 30

interface QuoteBody {
  suite:        'ld' | 'hd'
  parts:        Array<{ name: string; oem: string; aftermarket?: string }>
  storeAddress: string
  storeLat:     number
  storeLng:     number
  storePhone:   string
  storeName:    string
  deliveryLat:  number
  deliveryLng:  number
  techPhone?:   string
  vehicleInfo:  {
    year?: string; make?: string; model?: string; engine?: string; trim?: string; vin?: string
    unitManufacturer?: string; unitModel?: string
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: QuoteBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (body.suite !== 'ld' && body.suite !== 'hd') {
    return NextResponse.json({ error: 'suite must be ld or hd' }, { status: 400 })
  }

  // Roadie feature flag — render the UI but disable dispatch until credentials land.
  if (!isRoadieEnabled()) {
    return NextResponse.json({
      enabled: false,
      message: "Parts delivery coming soon — we're finalizing our delivery partner integration",
    })
  }

  // Stripe customer + contact info for the dropoff.
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name')
    .eq('id', user.id)
    .maybeSingle()
  const dropoffName = profile?.full_name || profile?.business_name || 'Technician'

  const parts = Array.isArray(body.parts) ? body.parts : []
  const itemDescription = parts.length > 0
    ? parts.map(p => p.oem ? `${p.name} (${p.oem})` : p.name).join(', ')
    : 'Auto parts'

  let quote
  try {
    quote = await getRoadieQuote({
      pickupAddress:       body.storeAddress,
      pickupLat:           body.storeLat,
      pickupLng:           body.storeLng,
      dropoffLat:          body.deliveryLat,
      dropoffLng:          body.deliveryLng,
      pickupContactName:   body.storeName,
      pickupContactPhone:  body.storePhone,
      dropoffContactName:  dropoffName,
      dropoffContactPhone: body.techPhone || '',
      itemDescription,
      itemQuantity:        Math.max(1, parts.length),
    })
  } catch (err) {
    console.error('[parts-delivery/quote] Roadie quote failed', err)
    return NextResponse.json({ error: 'Could not get a delivery quote right now.' }, { status: 502 })
  }

  const fee = calculateDeliveryFee(quote.feeCents)

  const { data: delivery, error } = await supabase
    .from('parts_deliveries')
    .insert({
      user_id:            user.id,
      suite:              body.suite,
      status:             'quoted',
      vehicle_year:       body.vehicleInfo?.year ?? null,
      vehicle_make:       body.vehicleInfo?.make ?? null,
      vehicle_model:      body.vehicleInfo?.model ?? null,
      vehicle_engine:     body.vehicleInfo?.engine ?? null,
      vehicle_trim:       body.vehicleInfo?.trim ?? null,
      vin:                body.vehicleInfo?.vin ?? null,
      unit_manufacturer:  body.vehicleInfo?.unitManufacturer ?? null,
      unit_model:         body.vehicleInfo?.unitModel ?? null,
      parts_requested:    parts,
      store_name:         body.storeName ?? null,
      store_address:      body.storeAddress ?? null,
      store_phone:        body.storePhone ?? null,
      delivery_lat:       body.deliveryLat ?? null,
      delivery_lng:       body.deliveryLng ?? null,
      roadie_quote_id:    quote.quoteId,
      roadie_fee_cents:   fee.roadieFeeCents,
      roadie_eta_minutes: quote.etaMinutes,
      platform_fee_cents: fee.platformFeeCents,
      total_charged_cents: fee.totalCents,
      quoted_at:          new Date().toISOString(),
      // stash whether a card is on file so dispatch can fail fast with a clear message
      stripe_payment_intent_id: null,
    })
    .select('id')
    .single()

  if (error || !delivery) {
    console.error('[parts-delivery/quote] insert failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({
    enabled:          true,
    deliveryId:       delivery.id,
    quoteId:          quote.quoteId,
    roadieFeeCents:   fee.roadieFeeCents,
    platformFeeCents: fee.platformFeeCents,
    totalCents:       fee.totalCents,
    etaMinutes:       quote.etaMinutes,
    breakdown:        fee.breakdown,
    hasPaymentMethod: !!sub?.stripe_customer_id,
  })
}
