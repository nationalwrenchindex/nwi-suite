import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isReeferStandaloneUser } from '@/lib/hd-access'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  partitionImportRows, summarizeSkips, isSerialUniqueViolation, type SerialHolder,
} from '@/app/api/hd/fleet-units/serials'
import { getEquipmentCategories } from '@/lib/hd/equipment-categories'
import { summarizeTypes, typeColumns } from '@/lib/hd/equipment-type-match'

type UnitRow = {
  unit_number?: string
  manufacturer?: string
  model?: string
  year?: string
  serial_number?: string
  total_hours?: string
  fleet_name?: string
  /** Equipment type, when the file carries one (the import mapping's "Equipment type"). */
  unit_type?: string
}

// POST /api/hd/import/units  { rows: UnitRow[] }
//   -> { imported, skipped: [{ row, unit_number, serial_number, reason }] }
//
// DUPLICATE SERIALS ARE FOUND BEFORE THE INSERT. hd_units_user_serial_unique (migration
// 161) allows one active unit per serial per shop, and the insert is one batch, so a
// single repeated serial used to fail the whole file with a raw "duplicate key value"
// error. Each row is now checked against the shop's active units and against earlier
// rows of the same file (trim + uppercase, the index's own rule), and the duplicates are
// skipped and listed by line, serial and the unit that already has it. The rest import.
// If every row is skipped the answer is a 409 whose error lists why, because the import
// screens show `error` and nothing else on a failure.
//
// EQUIPMENT TYPE IS READ, NEVER GUESSED. A type in the file that names one of the shop's
// categories sets that category; anything else leaves the unit blank (Uncategorized),
// with unit_type written as null so the column's old 'trailer' default cannot fill it.
// The response's `types` says how many landed blank and which file types matched nothing.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Not part of Reefer Standalone. Only a reefer_standalone account is refused here;
  // every other account gets exactly what it got before.
  if (await isReeferStandaloneUser(user.id)) return NextResponse.json({ error: 'Not available on Reefer Standalone' }, { status: 403 })

  let body: { rows: UnitRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { rows } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  }

  // The shop's active units that carry a serial. Paged: PostgREST caps a response at
  // 1,000 rows, and a truncated list would let a duplicate through to the insert.
  let existing: SerialHolder[]
  try {
    existing = await fetchAllRows<SerialHolder>((from, to) =>
      supabase
        .from('hd_units')
        .select('id, unit_number, manufacturer, model, serial_number, active')
        .eq('user_id', user.id)
        .not('serial_number', 'is', null)
        .or('active.is.null,active.eq.true')
        .order('id')
        .range(from, to),
    )
  } catch (e) {
    console.error('[hd/import/units] existing units read failed:', e)
    return NextResponse.json({ error: 'Could not check existing serial numbers - nothing was imported.' }, { status: 500 })
  }

  const { keep, skipped } = partitionImportRows(rows, existing)

  if (keep.length === 0) {
    const onlyBlank = skipped.every(s => s.reason === 'no unit number or manufacturer')
    return NextResponse.json(
      {
        error: onlyBlank
          ? 'No valid rows (unit_number or manufacturer required)'
          : `Nothing imported - every row was skipped. ${summarizeSkips(skipped)}`,
        imported: 0,
        skipped,
      },
      { status: onlyBlank ? 400 : 409 },
    )
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

  // Resolve or create fleet accounts referenced by name - only for rows being imported,
  // so a skipped row does not leave behind an empty fleet account.
  const uniqueFleetNames = [...new Set(keep.map(r => r.fleet_name?.trim()).filter(Boolean) as string[])]
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

  // Seeds the defaults first, so a shop importing before it ever opened the units screen
  // still matches "Truck", "Trailer", ... from its file.
  const categories = await getEquipmentCategories(supabase, user.id)
  const types = summarizeTypes(keep.map(r => r.unit_type), categories)

  const toInsert = keep.map(r => ({
    ...typeColumns(r.unit_type, categories),
    user_id:         user.id,
    unit_number:     r.unit_number?.trim()   || 'UNKNOWN',
    manufacturer:    r.manufacturer?.trim()  || 'UNKNOWN',
    model:           r.model?.trim()         || null,
    year:            r.year ? parseInt(r.year, 10) || null : null,
    serial_number:   r.serial_number?.trim() || null,
    total_hours:     r.total_hours ? parseFloat(r.total_hours) || null : null,
    fleet_account_id: r.fleet_name ? (fleetCache[r.fleet_name.trim().toLowerCase()] ?? null) : null,
  }))

  const { error } = await supabase.from('hd_units').insert(toInsert)
  if (error) {
    // The pre-check above cannot see a unit saved by someone else while this ran. The
    // insert is one statement, so on a clash nothing from this file went in.
    if (isSerialUniqueViolation(error)) {
      return NextResponse.json(
        {
          error: 'A unit with one of these serial numbers was saved while the import ran, so nothing was imported. ' +
                 'Run the import again - the duplicate will be skipped and listed.',
          imported: 0,
          skipped,
        },
        { status: 409 },
      )
    }
    console.error('[hd/import/units] insert failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    imported: toInsert.length,
    skipped,
    types,
    ...(skipped.length > 0 ? { message: `Skipped ${skipped.length}: ${summarizeSkips(skipped)}` } : {}),
  })
}
