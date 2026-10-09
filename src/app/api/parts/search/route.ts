// GET /api/parts/search   find parts, by unit or by number or by description
//
// This is the route that replaces "a Carrier Supra 660 returns 12 parts". The rules it
// applies live in src/lib/parts/search.ts as pure functions; this route only fetches
// and assembles.
//
// Query parameters
//   manufacturer   constrains ABSOLUTELY when present
//   model          a unit model; a catch-all fitment never matches one
//   engine         an engine model, for parts that fit by engine
//   compressor     a compressor model, for parts that fit by compressor
//   serial         narrows a serial split, and says so when it cannot
//   part_type      substring, so "filter" covers "Filter - fuel"
//   q              a number in hand, or words from a description
//   include_unfitted=true  show parts with no fitment at all. IGNORED when a model is
//                  given, because that is exactly the catch-all leak.
//
// WHY THE MATCHING IS DONE HERE AND NOT IN THE QUERY
//
// The model comparison is on NORMALIZED values, and Postgres cannot be asked for that
// through PostgREST without a generated column on part_fitment or user text embedded
// in an `or=` filter string. So the candidate set is narrowed in the query by the
// things SQL does exactly - manufacturer, part type - and the normalized comparison
// runs here. part_fitment holds 215 rows today; when that is tens of thousands this
// needs a generated unit_model_normalized column and a migration, and that is a
// deliberate trade recorded here rather than a surprise later.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  // isCatchAllModel is NOT imported here on purpose: the catch-all exclusion lives
  // inside modelMatches, so this route cannot apply it inconsistently or forget it.
  canonicalManufacturer, manufacturerMatches, modelMatches,
  serialApplies, serialLabel, serialSide, fitmentRank, textMatches, typeMatches,
  normalizePartNumber,
} from '@/lib/parts/search'

export const dynamic = 'force-dynamic'

const PART_COLUMNS =
  'id, part_number, part_number_normalized, manufacturer, part_type, description, ' +
  'belt_section, belt_section_canonical, belt_length, belt_profile, notes, verified, source'

const FITMENT_COLUMNS =
  'id, part_id, unit_model, engine_model, compressor_model, serial_from, serial_before, ' +
  'build_date_from, build_date_before, qty_per_unit, note, verified, source'

interface PartRow {
  id: string
  part_number: string
  part_number_normalized: string
  manufacturer: string
  part_type: string
  description: string | null
  belt_section: string | null
  belt_section_canonical: string | null
  belt_length: string | null
  belt_profile: string | null
  notes: string | null
  verified: boolean
  source: string
  vendor_price?: number | null
}

interface FitmentRow {
  id: string
  part_id: string
  unit_model: string | null
  engine_model: string | null
  compressor_model: string | null
  serial_from: string | null
  serial_before: string | null
  build_date_from: string | null
  build_date_before: string | null
  qty_per_unit: number | null
  note: string | null
  verified: boolean
  source: string
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const p = request.nextUrl.searchParams
  const manufacturer = p.get('manufacturer')?.trim() || null
  const model        = p.get('model')?.trim() || null
  const engine       = p.get('engine')?.trim() || null
  const compressor   = p.get('compressor')?.trim() || null
  const serial       = p.get('serial')?.trim() || null
  const partType     = p.get('part_type')?.trim() || null
  const q            = p.get('q')?.trim() || null
  const hasUnitQuery = !!(model || engine || compressor)

  // include_unfitted cannot be honoured alongside a model. That combination IS the
  // defect: "fits all Thermo King units" answering "what fits my Supra 660".
  const includeUnfitted = p.get('include_unfitted') === 'true' && !hasUnitQuery

  // vendor_price arrives with migration 149 and the code deploys separately, so the
  // select is retried without it rather than failing the search over a column that is
  // on its way.
  let parts: PartRow[] = []
  let pricesAvailable = true
  {
    const first = await supabase.from('parts').select(`${PART_COLUMNS}, vendor_price`).order('part_number')
    if (first.error) {
      pricesAvailable = false
      const retry = await supabase.from('parts').select(PART_COLUMNS).order('part_number')
      if (retry.error) {
        console.error('[parts/search] parts select failed:', retry.error)
        return NextResponse.json({ error: 'Could not read the parts catalog' }, { status: 500 })
      }
      parts = (retry.data ?? []) as unknown as PartRow[]
    } else {
      parts = (first.data ?? []) as unknown as PartRow[]
    }
  }

  const { data: fitmentData, error: fitErr } = await supabase
    .from('part_fitment')
    .select(FITMENT_COLUMNS)
  if (fitErr) {
    console.error('[parts/search] fitment select failed:', fitErr)
    return NextResponse.json({ error: 'Could not read fitment' }, { status: 500 })
  }
  const fitment = (fitmentData ?? []) as unknown as FitmentRow[]

  const { data: superData } = await supabase
    .from('part_supersession')
    .select('old_number, new_number, old_number_normalized, new_number_normalized, manufacturer, note, verified, source')

  const supersessions = superData ?? []

  // ── supersession, before anything is filtered out ────────────────────────
  //
  // A number typed in from a part in hand may be superseded. The search must find the
  // replacement and SAY what happened, rather than returning nothing for a number
  // that is printed on the part the technician is holding.
  let supersededNote: { from: string; to: string; note: string | null; verified: boolean; source: string } | null = null
  let effectiveQuery = q
  if (q && /[0-9]/.test(q)) {
    const wanted = normalizePartNumber(q)
    const hit = supersessions.find(s => s.old_number_normalized === wanted)
    if (hit) {
      supersededNote = {
        from: String(hit.old_number), to: String(hit.new_number),
        note: (hit.note as string | null) ?? null,
        verified: !!hit.verified, source: String(hit.source),
      }
      // Search for the REPLACEMENT. The old number is kept in the response so the
      // screen can explain why it is showing a different number than was typed.
      effectiveQuery = String(hit.new_number)
    }
  }

  const fitmentByPart = new Map<string, FitmentRow[]>()
  for (const f of fitment) {
    fitmentByPart.set(f.part_id, [...(fitmentByPart.get(f.part_id) ?? []), f])
  }

  interface Result {
    part: PartRow
    fitment: Array<FitmentRow & { serial_label: string | null; serial_side: string }>
    unresolvedSerial: boolean
    matchedBy: 'unit' | 'engine' | 'compressor' | 'text' | 'catalog'
  }
  const results: Result[] = []
  let unresolvedSerialCount = 0

  for (const part of parts) {
    // RULE 1. Absolute.
    if (!manufacturerMatches(part.manufacturer, manufacturer)) continue
    if (!typeMatches(part.part_type, partType)) continue
    if (!textMatches(part, effectiveQuery)) continue

    const rows = fitmentByPart.get(part.id) ?? []

    if (!hasUnitQuery) {
      // No unit asked for: the catalog, filtered by type and text. Parts with no
      // fitment are included here and ONLY here - this is the "show those only when
      // no model is selected" case.
      if (rows.length === 0 && !includeUnfitted && !q && !partType) continue
      results.push({
        part,
        fitment: rows.map(f => ({ ...f, serial_label: serialLabel(f), serial_side: serialSide(f) })),
        unresolvedSerial: false,
        matchedBy: q ? 'text' : 'catalog',
      })
      continue
    }

    // A unit WAS asked for. Only fitment that names it counts. RULE 2 and RULE 3 are
    // both inside modelMatches.
    const matching = rows.filter(f =>
      (model      && modelMatches(f.unit_model, model)) ||
      (engine     && modelMatches(f.engine_model, engine)) ||
      (compressor && modelMatches(f.compressor_model, compressor)))

    if (!matching.length) continue

    // RULE 4. A serial narrows the split; when the serials cannot be compared the row
    // stays in and is flagged, never silently dropped.
    const kept: FitmentRow[] = []
    let unresolved = false
    for (const f of matching) {
      const applies = serialApplies(f, serial)
      if (applies === false) continue
      if (applies === null) unresolved = true
      kept.push(f)
    }
    if (!kept.length) continue
    if (unresolved) unresolvedSerialCount++

    results.push({
      part,
      fitment: kept
        .sort((a, b) => fitmentRank(a) - fitmentRank(b))
        .map(f => ({ ...f, serial_label: serialLabel(f), serial_side: serialSide(f) })),
      unresolvedSerial: unresolved,
      matchedBy: model ? 'unit' : engine ? 'engine' : 'compressor',
    })
  }

  // Verified first, then by number, so the ordering is stable and a technician can
  // see at a glance which rows are vouched for.
  results.sort((a, b) => {
    const av = a.part.verified ? 0 : 1
    const bv = b.part.verified ? 0 : 1
    if (av !== bv) return av - bv
    return a.part.part_number.localeCompare(b.part.part_number)
  })

  // What a superseded part was replaced by, for every result, so the detail panel can
  // say "replaced by" without a second request.
  const supersededByNumber = new Map<string, { to: string; note: string | null }>()
  for (const s of supersessions) {
    supersededByNumber.set(String(s.old_number_normalized), {
      to: String(s.new_number), note: (s.note as string | null) ?? null,
    })
  }

  return NextResponse.json({
    query: {
      manufacturer: canonicalManufacturer(manufacturer), model, engine, compressor,
      serial, part_type: partType, q,
      // Stated plainly so a caller can tell the user WHY nothing came back.
      catch_all_excluded: hasUnitQuery,
      include_unfitted: includeUnfitted,
    },
    superseded: supersededNote,
    prices_available: pricesAvailable,
    count: results.length,
    unresolved_serial_count: unresolvedSerialCount,
    results: results.map(r => ({
      ...r.part,
      superseded_by: supersededByNumber.get(r.part.part_number_normalized) ?? null,
      matched_by: r.matchedBy,
      unresolved_serial: r.unresolvedSerial,
      fitment: r.fitment,
    })),
  })
}
