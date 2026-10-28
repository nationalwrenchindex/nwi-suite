// GET /api/parts/counter/options   what the counter's pickers offer
//
// The models are the models the catalog has fitment for - a typeahead that offers a
// model nothing fits would send the tech to an empty result. The part types come
// grouped under the spec's reefer categories. The units are this shop's own (RLS),
// so step 0 - "pick the unit you already have" - fills in make, model, serial and BM.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { canonicalManufacturer, isCatchAllModel } from '@/lib/parts/search'
import { groupTypes, inScope, type CounterScope } from '@/lib/parts/counter'
import { readCatalog } from '@/lib/parts/catalog'

export const dynamic = 'force-dynamic'

// Not exported: a route file may export only its handlers and route config.
const COUNTER_MAKERS = ['Thermo King', 'Carrier Transicold'] as const

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hdAccess = await checkHDAccess(user.id)
  if (!hdAccess && !(await reeferStandaloneCan(user.id, 'reefer_parts_reference'))) {
    return NextResponse.json({ error: 'A parts subscription is required' }, { status: 403 })
  }
  const scope: CounterScope = !hdAccess || request.nextUrl.searchParams.get('scope') === 'reefer' ? 'reefer' : 'all'

  let catalog
  try {
    catalog = await readCatalog(supabase)
  } catch (err) {
    console.error('[parts/counter/options] catalog read failed:', err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'Could not read the parts catalog' }, { status: 500 })
  }

  const parts = catalog.parts.filter(p => inScope(p.equipment_type, scope))
  const partById = new Map(parts.map(p => [p.id, p]))

  // Models per maker, from fitment on parts this surface sells.
  const models: Record<string, Set<string>> = { thermoking: new Set(), carrier: new Set() }
  for (const f of catalog.fitment) {
    const part = partById.get(f.part_id)
    if (!part || !f.unit_model || isCatchAllModel(f.unit_model)) continue
    const mk = canonicalManufacturer(part.manufacturer)
    if (mk && models[mk]) models[mk].add(f.unit_model)
  }

  const { data: units } = await supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, serial_number, bm_number')
    .eq('user_id', user.id)
    .eq('active', true)
    .order('unit_number')

  return NextResponse.json({
    scope,
    makers: COUNTER_MAKERS,
    models: {
      'Thermo King':        [...models.thermoking].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      'Carrier Transicold': [...models.carrier].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    },
    part_types: groupTypes(parts.map(p => p.part_type)),
    // Only units the counter can answer for: a Thermo King or Carrier box.
    units: (units ?? [])
      .filter(u => ['thermoking', 'carrier'].includes(canonicalManufacturer(u.manufacturer as string | null) ?? ''))
      .map(u => ({
        id: u.id,
        label: [u.unit_number, u.manufacturer, u.model].filter(Boolean).join(' - '),
        maker: canonicalManufacturer(u.manufacturer as string | null) === 'carrier' ? 'Carrier Transicold' : 'Thermo King',
        model: u.model ?? '',
        serial: u.serial_number ?? '',
        bm: u.bm_number ?? '',
      })),
  })
}
