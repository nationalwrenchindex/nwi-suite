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
//   heading        one of the counter's headings (Engine, Fuel, ... Electric Standby),
//                  through categoryOf in src/lib/parts/counter.ts - never a new grouping
//
// AN EXACT PART NUMBER IS NEVER FILTERED BY THE UNIT (Nov 6). A tech holding 78-1876
// gets 78-1876 whatever unit is on the document; the result says whether its fitment
// names that unit (fits_unit). Words, a type or a heading stay filtered to the unit.
//
// EVERY RESULT CARRIES ITS TRUST (trust: { tier, verified }), the best of the fitment
// rows that matched it - or the part's own when no unit was asked for - so a row loaded
// "unconfirmed" never looks like one Brock confirmed. Tiers and badges are the
// counter's (src/lib/parts/counter.ts); nothing here invents one.
//
// WHY THE MATCHING IS DONE HERE AND NOT IN THE QUERY
//
// The model comparison is on NORMALIZED values, and Postgres cannot be asked for that
// through PostgREST without a generated column on part_fitment or user text embedded
// in an `or=` filter string. So the candidate set is narrowed in the query by the
// things SQL does exactly - manufacturer, part type - and the normalized comparison
// runs here. part_fitment held 20,636 rows on Nov 5, 2026, read in 21 pages on every
// search; a generated unit_model_normalized column and a migration would let the query
// narrow by model instead, and that is a deliberate trade recorded here rather than a
// surprise later.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  // isCatchAllModel is NOT imported here on purpose: the catch-all exclusion lives
  // inside modelMatches, so this route cannot apply it inconsistently or forget it.
  canonicalManufacturer, manufacturerMatches, modelMatches, normalizePartNumber,
  serialApplies, serialLabel, serialSide, fitmentRank, textMatches, typeMatches,
} from '@/lib/parts/search'
import { partNumberSearchKeys } from '@/lib/parts/part-number'
import { bestTrust, categoryOf, isConfidenceTier, type Trust } from '@/lib/parts/counter'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import type { PostgrestError } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type PageResult<T> = { data: T[] | null; error: PostgrestError | null }

const PART_COLUMNS =
  'id, part_number, part_number_normalized, manufacturer, part_type, description, ' +
  'belt_section, belt_section_canonical, belt_length, belt_profile, notes, verified'
// Migration 175's tier, read beside 148's boolean; retried without it on a database
// that does not have it, which then shows "verified" / "unverified" as before.
const CONFIDENCE = ', confidence'

// No `source` in this response: for the vendor-listing rows it is a store's name, and
// the screens that read this route show a cost beside each part.

const FITMENT_COLUMNS =
  'id, part_id, unit_model, engine_model, compressor_model, serial_from, serial_before, ' +
  'build_date_from, build_date_before, qty_per_unit, note, verified'

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
  confidence?: string | null
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
  confidence?: string | null
}

const trustOf = (r: { confidence?: string | null; verified: boolean }): Trust =>
  ({ tier: isConfidenceTier(r.confidence) ? r.confidence : null, verified: !!r.verified })

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
  const heading      = p.get('heading')?.trim() || null
  const hasUnitQuery = !!(model || engine || compressor)

  // include_unfitted cannot be honoured alongside a model. That combination IS the
  // defect: "fits all Thermo King units" answering "what fits my Supra 660".
  const includeUnfitted = p.get('include_unfitted') === 'true' && !hasUnitQuery

  // vendor_price arrives with migration 149 and the code deploys separately, so the
  // select is retried without it rather than failing the search over a column that is
  // on its way.
  //
  // Every read pages past PostgREST's 1,000-row cap, the same way the counter's catalog
  // read does (src/lib/parts/catalog.ts). A plain select stopped at row 1,000 and hid
  // most of the store once it passed 1,000 parts.
  const readParts = (cols: string) => fetchAllRows<PartRow>((from, to) =>
    supabase.from('parts').select(cols).order('part_number').order('id').range(from, to) as unknown as PromiseLike<PageResult<PartRow>>)
  let parts: PartRow[] = []
  let pricesAvailable = true
  const firstOf = async <T,>(tries: Array<() => Promise<T>>): Promise<T> => {
    let last: unknown
    for (const t of tries) { try { return await t() } catch (e) { last = e } }
    throw last
  }
  try {
    parts = await firstOf([
      () => readParts(`${PART_COLUMNS}${CONFIDENCE}, vendor_price`),
      async () => { const r = await readParts(`${PART_COLUMNS}${CONFIDENCE}`); pricesAvailable = false; return r },
      async () => { const r = await readParts(PART_COLUMNS); pricesAvailable = false; return r },
    ])
  } catch (e) {
    console.error('[parts/search] parts select failed:', e)
    return NextResponse.json({ error: 'Could not read the parts catalog' }, { status: 500 })
  }

  const readFitment = (cols: string) => fetchAllRows<FitmentRow>((from, to) =>
    supabase.from('part_fitment').select(cols).order('id').range(from, to) as unknown as PromiseLike<PageResult<FitmentRow>>)
  let fitment: FitmentRow[] = []
  try {
    fitment = await firstOf([() => readFitment(`${FITMENT_COLUMNS}${CONFIDENCE}`), () => readFitment(FITMENT_COLUMNS)])
  } catch (e) {
    console.error('[parts/search] fitment select failed:', e)
    return NextResponse.json({ error: 'Could not read fitment' }, { status: 500 })
  }

  // A failed supersession read leaves the search working without it, as before.
  let supersessions: Array<Record<string, unknown>> = []
  try {
    supersessions = await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase.from('part_supersession')
        .select('id, old_number, new_number, old_number_normalized, new_number_normalized, manufacturer, note, verified')
        .order('id').range(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>)
  } catch { /* searched without supersessions */ }

  // ── supersession, before anything is filtered out ────────────────────────
  //
  // A number typed in from a part in hand may be superseded. The search must find the
  // replacement and SAY what happened, rather than returning nothing for a number
  // that is printed on the part the technician is holding.
  let supersededNote: { from: string; to: string; note: string | null; verified: boolean } | null = null
  let effectiveQuery = q
  if (q && /[0-9]/.test(q)) {
    // Through the one normalizer, so a 37- number finds its supersession too.
    const keys = partNumberSearchKeys(q)
    const hit = supersessions.find(s => keys.includes(String(s.old_number_normalized)))
    if (hit) {
      supersededNote = {
        from: String(hit.old_number), to: String(hit.new_number),
        note: (hit.note as string | null) ?? null,
        verified: !!hit.verified,
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
    matchedBy: 'unit' | 'engine' | 'compressor' | 'text' | 'catalog' | 'number'
    /** Only on an exact-number hit while a unit was asked for: does its fitment name it? */
    fitsUnit?: boolean
    trust: Trust | null
  }
  const results: Result[] = []
  let unresolvedSerialCount = 0

  // The typed text as an exact part number, when it is one (through the one normalizer).
  const exactKeys = effectiveQuery && /[0-9]/.test(effectiveQuery) ? partNumberSearchKeys(effectiveQuery) : []
  const isExact = (part: PartRow) => exactKeys.length > 0 &&
    exactKeys.includes(part.part_number_normalized ?? normalizePartNumber(part.part_number))

  const unitRows = (rows: FitmentRow[]) => rows.filter(f =>
    (model      && modelMatches(f.unit_model, model)) ||
    (engine     && modelMatches(f.engine_model, engine)) ||
    (compressor && modelMatches(f.compressor_model, compressor)))

  for (const part of parts) {
    // RULE 1. Absolute.
    if (!manufacturerMatches(part.manufacturer, manufacturer)) continue
    if (!typeMatches(part.part_type, partType)) continue
    if (heading && categoryOf(part.part_type ?? '') !== heading) continue
    if (!textMatches(part, effectiveQuery)) continue

    const rows = fitmentByPart.get(part.id) ?? []

    // An exact number while a unit is set: returned whatever its fitment, and says so.
    if (hasUnitQuery && isExact(part)) {
      const matching = unitRows(rows)
      results.push({
        part,
        fitment: (matching.length ? matching : rows)
          .sort((a, b) => fitmentRank(a) - fitmentRank(b))
          .map(f => ({ ...f, serial_label: serialLabel(f), serial_side: serialSide(f) })),
        unresolvedSerial: false,
        matchedBy: 'number',
        fitsUnit: matching.length > 0,
        trust: matching.length ? bestTrust(matching.map(trustOf)) : trustOf(part),
      })
      continue
    }

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
        trust: trustOf(part),
      })
      continue
    }

    // A unit WAS asked for. Only fitment that names it counts. RULE 2 and RULE 3 are
    // both inside modelMatches.
    const matching = unitRows(rows)

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
      trust: bestTrust(kept.map(trustOf)),
    })
  }

  // Verified first, then by number, so the ordering is stable and a technician can
  // see at a glance which rows are vouched for.
  results.sort((a, b) => {
    // An exact number the tech typed leads.
    const ae = a.matchedBy === 'number' ? 0 : 1
    const be = b.matchedBy === 'number' ? 0 : 1
    if (ae !== be) return ae - be
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
      serial, part_type: partType, q, heading,
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
      ...(r.fitsUnit !== undefined ? { fits_unit: r.fitsUnit } : {}),
      trust: r.trust,
      category: categoryOf(r.part.part_type ?? ''),
      unresolved_serial: r.unresolvedSerial,
      fitment: r.fitment,
    })),
  })
}
