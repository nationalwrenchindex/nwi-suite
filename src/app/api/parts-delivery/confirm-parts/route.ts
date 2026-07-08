import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

interface ConfirmBody {
  deliveryId:     string
  confirmedParts: Array<{ name: string; oem: string; confirmed: boolean; aftermarket?: string; aftermarketBrand?: string }>
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ConfirmBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body.deliveryId) return NextResponse.json({ error: 'deliveryId required' }, { status: 400 })

  // Load + own-check the delivery row (also gives us vehicle context for the catalog).
  const { data: delivery, error: readErr } = await supabase
    .from('parts_deliveries')
    .select('id, user_id, suite, vehicle_year, vehicle_make, vehicle_model, vehicle_engine, vehicle_trim, unit_manufacturer, unit_model')
    .eq('id', body.deliveryId)
    .maybeSingle()
  if (readErr || !delivery) return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
  if (delivery.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const confirmed = (body.confirmedParts ?? []).filter(p => p.confirmed && p.name?.trim())

  const { error: updErr } = await supabase
    .from('parts_deliveries')
    .update({ parts_confirmed: confirmed, status: 'quoted', updated_at: new Date().toISOString() })
    .eq('id', body.deliveryId)
  if (updErr) {
    console.error('[parts-delivery/confirm-parts] update failed', updErr)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Grow the confirmed_parts catalog (service role — table has no user write policy).
  // Keyed on vehicle + OEM number; re-confirmations bump confirmed_count.
  const svc = createServiceClient()
  let contributed = 0
  for (const p of confirmed) {
    const oem = p.oem?.trim() || null
    if (!oem) continue
    try {
      const { data: existing } = await svc
        .from('confirmed_parts')
        .select('id, confirmed_count')
        .eq('suite', delivery.suite)
        .eq('oem_part_number', oem)
        .eq('vehicle_year',   delivery.vehicle_year   ?? '')
        .eq('vehicle_make',   delivery.vehicle_make   ?? '')
        .eq('vehicle_model',  delivery.vehicle_model  ?? '')
        .eq('vehicle_engine', delivery.vehicle_engine ?? '')
        .maybeSingle()

      if (existing) {
        await svc.from('confirmed_parts')
          .update({
            confirmed_count:   (existing.confirmed_count ?? 1) + 1,
            last_confirmed_at: new Date().toISOString(),
            updated_at:        new Date().toISOString(),
          })
          .eq('id', existing.id)
      } else {
        await svc.from('confirmed_parts').insert({
          suite:                   delivery.suite,
          vehicle_year:            delivery.vehicle_year,
          vehicle_make:            delivery.vehicle_make,
          vehicle_model:           delivery.vehicle_model,
          vehicle_engine:          delivery.vehicle_engine,
          vehicle_trim:            delivery.vehicle_trim,
          unit_manufacturer:       delivery.unit_manufacturer,
          unit_model:              delivery.unit_model,
          part_name:               p.name.trim(),
          oem_part_number:         oem,
          aftermarket_part_number: p.aftermarket ?? null,
          aftermarket_brand:       p.aftermarketBrand ?? null,
          confirmed_count:         1,
          first_confirmed_by:      user.id,
        })
      }
      contributed++
    } catch (e) {
      console.error('[parts-delivery/confirm-parts] catalog upsert failed', e)
    }
  }

  if (contributed > 0) {
    await supabase.from('parts_deliveries')
      .update({ parts_verified: true, catalog_contributed: true })
      .eq('id', body.deliveryId)
  }

  return NextResponse.json({ ok: true, confirmedCount: confirmed.length, catalogContributed: contributed })
}
