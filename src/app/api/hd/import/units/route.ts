import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type UnitRow = {
  unit_number?: string
  manufacturer?: string
  model?: string
  year?: string
  serial_number?: string
  total_hours?: string
  fleet_name?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rows: UnitRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { rows } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  }

  // Build fleet name → id cache to resolve fleet_name references
  const { data: existingFleets } = await supabase
    .from('hd_fleet_accounts')
    .select('id, fleet_name')
    .eq('user_id', user.id)

  const fleetCache: Record<string, string> = {}
  for (const f of existingFleets ?? []) {
    fleetCache[f.fleet_name.toLowerCase()] = f.id
  }

  // Resolve or create fleet accounts referenced by name
  const uniqueFleetNames = [...new Set(rows.map(r => r.fleet_name?.trim()).filter(Boolean) as string[])]
  for (const name of uniqueFleetNames) {
    if (!fleetCache[name.toLowerCase()]) {
      const { data: newFleet } = await supabase
        .from('hd_fleet_accounts')
        .insert({ user_id: user.id, fleet_name: name })
        .select('id, fleet_name')
        .single()
      if (newFleet) fleetCache[newFleet.fleet_name.toLowerCase()] = newFleet.id
    }
  }

  const toInsert = rows
    .filter(r => r.unit_number || r.manufacturer)
    .map(r => ({
      user_id:         user.id,
      unit_number:     r.unit_number?.trim()   || 'UNKNOWN',
      manufacturer:    r.manufacturer?.trim()  || 'UNKNOWN',
      model:           r.model?.trim()         || null,
      year:            r.year ? parseInt(r.year, 10) || null : null,
      serial_number:   r.serial_number?.trim() || null,
      total_hours:     r.total_hours ? parseFloat(r.total_hours) || null : null,
      fleet_account_id: r.fleet_name ? (fleetCache[r.fleet_name.toLowerCase()] ?? null) : null,
    }))

  if (toInsert.length === 0) {
    return NextResponse.json({ error: 'No valid rows (unit_number or manufacturer required)' }, { status: 400 })
  }

  const { error } = await supabase.from('hd_units').insert(toInsert)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ imported: toInsert.length })
}
