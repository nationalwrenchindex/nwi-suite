// GET /api/parts/[id]   one part, with everything known about it
//
// Fitment, cross-references with their source, what superseded it or what it
// supersedes, this shop's stock, and the derived belt cross. Assembled server-side so
// the detail screen is one request rather than six.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizePartNumber } from '@/lib/parts/search'

export const dynamic = 'force-dynamic'

const PART_COLUMNS =
  'id, part_number, part_number_normalized, manufacturer, part_type, description, ' +
  'belt_section, belt_section_canonical, belt_length, belt_profile, notes, verified, source, created_at'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // vendor_price arrives with migration 149; retried without it so the screen works in
  // the window where the code is deployed and the migration is not.
  let part: Record<string, unknown> | null = null
  let pricesAvailable = true
  {
    const first = await supabase.from('parts').select(`${PART_COLUMNS}, vendor_price, vendor_price_source`).eq('id', id).single()
    if (first.error) {
      pricesAvailable = false
      const retry = await supabase.from('parts').select(PART_COLUMNS).eq('id', id).single()
      if (retry.error || !retry.data) return NextResponse.json({ error: 'Part not found' }, { status: 404 })
      part = retry.data as unknown as Record<string, unknown>
    } else {
      part = first.data as Record<string, unknown>
    }
  }

  const normalized = String(part.part_number_normalized ?? normalizePartNumber(String(part.part_number)))

  const [fitment, crosses, stock, supersedes, supersededBy] = await Promise.all([
    supabase.from('part_fitment')
      .select('id, unit_model, engine_model, compressor_model, serial_from, serial_before, build_date_from, build_date_before, qty_per_unit, note, verified, source')
      .eq('part_id', id),
    supabase.from('part_cross_reference')
      .select('id, brand, brand_number, verified, source')
      .eq('part_id', id),
    supabase.from('inventory')
      .select('id, on_hand, min_qty, bin, location_type, location_name, last_cost, sell_price')
      .eq('part_id', id)
      .eq('user_id', user.id),
    // What THIS part replaces.
    supabase.from('part_supersession')
      .select('old_number, new_number, note, verified, source')
      .eq('new_number_normalized', normalized),
    // What replaced THIS part.
    supabase.from('part_supersession')
      .select('old_number, new_number, note, verified, source')
      .eq('old_number_normalized', normalized),
  ])

  // A belt cross needs no table row: a B47 is a B47 at Gates, Dayco or Goodyear. It is
  // DERIVED from the section and length and labelled as derived, so nobody mistakes it
  // for a cross somebody checked.
  const section = part.belt_section_canonical as string | null
  const derivedCross = section && part.part_type && String(part.part_type).toLowerCase().includes('belt')
    ? {
        section,
        length: (part.belt_length as string | null) ?? null,
        profile: (part.belt_profile as string | null) ?? null,
        note: 'Industry-standard section. The same section and length is the same belt at any belt maker - this is derived from the section, not a cross somebody recorded.',
      }
    : null

  return NextResponse.json({
    part,
    prices_available: pricesAvailable,
    fitment: fitment.data ?? [],
    crosses: crosses.data ?? [],
    derived_cross: derivedCross,
    stock: stock.data ?? [],
    supersedes: supersedes.data ?? [],
    superseded_by: supersededBy.data ?? [],
  })
}
