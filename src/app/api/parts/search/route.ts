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
//   mount, build_date, configuration, show_unconfirmed   as /api/parts/counter
//
// A MODEL SEARCH IS NARROWED BY BROCK'S CHART (Part 4, Nov 22, 2026), through the same
// pure rules as the counter (src/lib/parts/narrow.ts): mount, unit model (S-600 is
// Precedent S-600), engine (blank = standard group, a fallback), serial, build date,
// configuration. Contradicted rows are never returned; unconfirmed unbounded rows the chart
// beats are suppressed (listed in `suppressed`, returned with show_unconfirmed=1).
//
// SUPERSEDED NUMBERS. An old number is never a current result for a unit: its fitment
// moves to its replacement (every replacement, when they are conditional). Searched by
// number it is still found - current: false, with every replacement in replaced_by - and
// the replacement is returned beside it.
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
import {
  badgeOf, bestTrust, categoryOf, followChain, isConfidenceTier, replacementsOf, trustRank,
  type SupersessionLink, type Trust,
} from '@/lib/parts/counter'
import { narrowUnitRows, parseBuildDate, partMountsOf, roleMatches, unitModelMatches, type Mount, type NarrowRow } from '@/lib/parts/narrow'
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
// Newest migration first; each read steps back one when its columns are not there yet.
const FIT_190 = ', mount_type, configuration'
const FIT_191 = `${FIT_190}, role`

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
  mount_type?: string | null
  configuration?: string | null
  role?: string | null
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
  const configuration = p.get('configuration')?.trim() || null
  const buildDateRaw = p.get('build_date')?.trim() || null
  const buildDate    = parseBuildDate(buildDateRaw)
  const mountParam   = p.get('mount')?.trim() || null
  const mount: Mount | null = mountParam === 'truck' || mountParam === 'trailer' ? mountParam : null
  const showUnconfirmed = ['1', 'true', 'yes'].includes((p.get('show_unconfirmed') ?? '').toLowerCase())
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
    fitment = await firstOf([
      () => readFitment(`${FITMENT_COLUMNS}${CONFIDENCE}${FIT_191}`),
      () => readFitment(`${FITMENT_COLUMNS}${CONFIDENCE}${FIT_190}`),
      () => readFitment(`${FITMENT_COLUMNS}${CONFIDENCE}`),
      () => readFitment(FITMENT_COLUMNS),
    ])
  } catch (e) {
    console.error('[parts/search] fitment select failed:', e)
    return NextResponse.json({ error: 'Could not read fitment' }, { status: 500 })
  }

  // A failed supersession read leaves the search working without it, as before.
  let supersessions: Array<Record<string, unknown>> = []
  const readLinks = (cols: string) => fetchAllRows<Record<string, unknown>>((from, to) =>
    supabase.from('part_supersession').select(cols).order('id').range(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>)
  try {
    const LINK = 'id, old_number, new_number, old_number_normalized, new_number_normalized, manufacturer, note, verified'
    supersessions = await firstOf([() => readLinks(`${LINK}, confidence`), () => readLinks(LINK)])
  } catch { /* searched without supersessions */ }
  const links: SupersessionLink[] = supersessions.map(s => ({
    old_number: String(s.old_number), new_number: String(s.new_number),
    old_number_normalized: String(s.old_number_normalized ?? ''), new_number_normalized: String(s.new_number_normalized ?? ''),
    manufacturer: String(s.manufacturer), note: (s.note as string | null) ?? null, verified: !!s.verified,
    confidence: isConfidenceTier(s.confidence) ? s.confidence : null,
  }))

  // ── supersession, before anything is filtered out ────────────────────────
  //
  // A number typed in from a part in hand may be superseded. The search finds the old
  // number AND its replacement(s), and SAYS what happened, rather than returning nothing
  // for a number printed on the part the technician is holding.
  let supersededNote: { from: string; to: string; note: string | null; verified: boolean } | null = null
  let supersededAll: Array<{ from: string; to: string; note: string | null; verified: boolean }> = []
  const effectiveQuery = q
  let replacementNumbers: string[] = []
  if (q && /[0-9]/.test(q)) {
    // Through the one normalizer, so a 37- number finds its supersession too.
    const keys = partNumberSearchKeys(q)
    const hits = supersessions.filter(s => keys.includes(String(s.old_number_normalized)))
    supersededAll = hits.map(hit => ({
      from: String(hit.old_number), to: String(hit.new_number),
      note: (hit.note as string | null) ?? null, verified: !!hit.verified,
    }))
    supersededNote = supersededAll[0] ?? null
    // The replacements are searched for too (every one of them), beside the old number.
    replacementNumbers = hits.map(h => String(h.new_number_normalized))
  }

  const fitmentByPart = new Map<string, FitmentRow[]>()
  for (const f of fitment) {
    fitmentByPart.set(f.part_id, [...(fitmentByPart.get(f.part_id) ?? []), f])
  }

  type Shown = FitmentRow & { serial_label: string | null; serial_side: string }
  interface Result {
    part: PartRow
    fitment: Shown[]
    unresolvedSerial: boolean
    matchedBy: 'unit' | 'engine' | 'compressor' | 'text' | 'catalog' | 'number'
    /** Only on an exact-number hit while a unit was asked for: does its fitment name it? */
    fitsUnit?: boolean
    trust: Trust | null
    /** False for an old number: found and shown, never offered as the answer. */
    current: boolean
    replacedBy: Array<{ to: string; note: string | null; badge: string; followed: boolean }>
    /** The old numbers this result's claim came from. */
    replaces: string[]
    /** The condition on a conditional replacement (the link's note). */
    condition: string | null
    suppressedReason: string | null
  }
  const results: Result[] = []
  let unresolvedSerialCount = 0
  const decorate = (f: FitmentRow): Shown => ({ ...f, serial_label: serialLabel(f), serial_side: serialSide(f) })
  const bare = { current: true, replacedBy: [], replaces: [], condition: null, suppressedReason: null }

  // The typed text as an exact part number, when it is one (through the one normalizer).
  const digitsQ = !!effectiveQuery && /[0-9]/.test(effectiveQuery)
  const words = effectiveQuery && !digitsQ ? effectiveQuery : null
  const exactKeys = digitsQ ? partNumberSearchKeys(effectiveQuery!) : []
  const normOf = (part: PartRow) => part.part_number_normalized ?? normalizePartNumber(part.part_number)
  const isExact = (part: PartRow) => exactKeys.length > 0 && exactKeys.includes(normOf(part))
  // A replacement of the typed old number is found beside it.
  const isReplacement = (part: PartRow) => replacementNumbers.includes(normOf(part))
  const numberOk = (part: PartRow) => textMatches(part, effectiveQuery) || isReplacement(part)

  // Engine or compressor with no model: matched on those, contradicted rows left out.
  const otherUnitRows = (rows: FitmentRow[]) => rows.filter(f => f.confidence !== 'conflict' && (
    (engine     && modelMatches(f.engine_model, engine)) ||
    (compressor && modelMatches(f.compressor_model, compressor))))
  const exactUnitRows = (rows: FitmentRow[]) => model
    ? rows.filter(f => f.confidence !== 'conflict' && unitModelMatches(f.unit_model, model))
    : otherUnitRows(rows)

  for (const part of parts) {
    // RULE 1. Absolute.
    if (!manufacturerMatches(part.manufacturer, manufacturer)) continue
    if (!typeMatches(part.part_type, partType)) continue
    if (heading && categoryOf(part.part_type ?? '') !== heading) continue

    const rows = fitmentByPart.get(part.id) ?? []

    // An exact number while a unit is set: returned whatever its fitment, and says so.
    if (hasUnitQuery && (isExact(part) || isReplacement(part))) {
      const matching = exactUnitRows(rows)
      results.push({
        part,
        fitment: (matching.length ? matching : rows).sort((a, b) => fitmentRank(a) - fitmentRank(b)).map(decorate),
        unresolvedSerial: false,
        matchedBy: 'number',
        fitsUnit: matching.length > 0,
        trust: matching.length ? bestTrust(matching.map(trustOf)) : trustOf(part),
        ...bare,
      })
      continue
    }

    // A model search is narrowed by the chart, below, over every part at once.
    if (model) continue
    if (!numberOk(part)) continue

    if (!hasUnitQuery) {
      // No unit asked for: the catalog, filtered by type and text. Parts with no
      // fitment are included here and ONLY here - this is the "show those only when
      // no model is selected" case.
      if (rows.length === 0 && !includeUnfitted && !q && !partType) continue
      results.push({
        part, fitment: rows.map(decorate), unresolvedSerial: false,
        matchedBy: q ? (isExact(part) || isReplacement(part) ? 'number' : 'text') : 'catalog',
        trust: trustOf(part), ...bare,
      })
      continue
    }

    // Engine or compressor only. RULE 4: a serial narrows the split; when the serials
    // cannot be compared the row stays in and is flagged, never silently dropped.
    const matching = otherUnitRows(rows)
    if (!matching.length) continue
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
      part, fitment: kept.sort((a, b) => fitmentRank(a) - fitmentRank(b)).map(decorate),
      unresolvedSerial: unresolved, matchedBy: engine ? 'engine' : 'compressor',
      trust: bestTrust(kept.map(trustOf)), ...bare,
    })
  }

  // ── a model: the chart's narrowing (src/lib/parts/narrow.ts) ────────────────
  let suppressed: Array<{ part_number: string; part_type: string; reason: string }> = []
  let narrowed: Record<string, unknown> | null = null
  let configurationChoices: Array<{ part_type: string; role: string | null; options: Array<{ configuration: string; part_numbers: string[] }> }> = []
  if (model) {
    const partById = new Map(parts.filter(pt => manufacturerMatches(pt.manufacturer, manufacturer)).map(pt => [pt.id, pt]))
    const already = new Set(results.map(r => r.part.id))
    // Every row for this unit, whatever the part type: they decide its mount.
    const unitAll = fitment.filter(f => partById.has(f.part_id) && unitModelMatches(f.unit_model, model))
    const candidates = unitAll.filter(f => {
      const part = partById.get(f.part_id)!
      if (already.has(part.id)) return false
      if (!typeMatches(part.part_type, partType)) return false
      if (heading && categoryOf(part.part_type ?? '') !== heading) return false
      // Words name a type, a description, or the role a part is charted for on this unit.
      return textMatches(part, effectiveQuery) || (!!words && !!f.role && roleMatches(f.role, words))
    })
    type Row = NarrowRow & { f: FitmentRow }
    const toRow = (f: FitmentRow): Row => ({
      id: f.id, part_id: f.part_id, family: partById.get(f.part_id)!.part_type, engine: f.engine_model,
      serial_from: f.serial_from, serial_before: f.serial_before,
      build_date_from: f.build_date_from, build_date_before: f.build_date_before,
      mount_type: f.mount_type ?? null, configuration: f.configuration ?? null, role: f.role ?? null,
      trust: trustOf(f), f,
    })
    const nr = narrowUnitRows(candidates.map(toRow), { mount, engine, serial, buildDate, configuration, words }, partMountsOf(
      fitment.map(f => ({ part_id: f.part_id, mount_type: f.mount_type ?? null }))), unitAll.map(f => ({ mount_type: f.mount_type ?? null })))
    const group = (rows: Row[]) => {
      const m = new Map<string, Row[]>()
      for (const r of rows) m.set(r.part_id, [...(m.get(r.part_id) ?? []), r])
      return m
    }
    for (const [partId, rows] of group(nr.kept)) {
      const unresolved = rows.some(r => nr.unresolvedSerial.has(r.id))
      if (unresolved) unresolvedSerialCount++
      results.push({
        part: partById.get(partId)!,
        fitment: rows.map(r => r.f).sort((a, b) => fitmentRank(a) - fitmentRank(b)).map(decorate),
        unresolvedSerial: unresolved, matchedBy: 'unit', trust: bestTrust(rows.map(r => r.trust)), ...bare,
      })
    }
    const reasonOf = new Map(nr.suppressed.map(s => [s.row.part_id, s.reason]))
    const suppressedByPart = group(nr.suppressed.map(s => s.row))
    suppressed = [...suppressedByPart.keys()].map(id => ({
      part_number: partById.get(id)!.part_number, part_type: partById.get(id)!.part_type, reason: reasonOf.get(id)!,
    })).sort((a, b) => a.part_number.localeCompare(b.part_number))
    if (showUnconfirmed) {
      for (const [partId, rows] of suppressedByPart) {
        results.push({
          part: partById.get(partId)!, fitment: rows.map(r => r.f).map(decorate), unresolvedSerial: false,
          matchedBy: 'unit', trust: bestTrust(rows.map(r => r.trust)), ...bare, suppressedReason: reasonOf.get(partId)!,
        })
      }
    }
    configurationChoices = nr.configurationChoices.map(c => ({
      part_type: c.family, role: c.role,
      options: c.options.map(o => ({ configuration: o.configuration, part_numbers: o.part_ids.map(id => partById.get(id)!.part_number).sort() })),
    }))
    narrowed = { unit_mount: nr.unitMount, excluded: nr.excluded, suppressed_count: suppressed.length }
  }

  // ── superseded numbers ────────────────────────────────────────────────────
  const partByNumber = new Map(parts.filter(pt => manufacturerMatches(pt.manufacturer, manufacturer)).map(pt => [normOf(pt), pt]))
  const final = new Map<string, Result>()
  const put = (r: Result) => {
    const prior = final.get(r.part.id)
    if (!prior) { final.set(r.part.id, { ...r, fitment: [...r.fitment], replaces: [...r.replaces] }); return }
    const ids = new Set(prior.fitment.map(f => f.id))
    prior.fitment.push(...r.fitment.filter(f => !ids.has(f.id)))
    prior.replaces = [...new Set([...prior.replaces, ...r.replaces])]
    prior.trust = bestTrust([prior.trust, r.trust].filter((t): t is Trust => !!t))
    prior.current ||= r.current
    prior.unresolvedSerial ||= r.unresolvedSerial
    if (r.condition && !prior.condition) prior.condition = r.condition
    if (!r.suppressedReason) prior.suppressedReason = null
    if (r.matchedBy === 'number') prior.matchedBy = 'number'
  }
  for (const r of results) {
    const outs = replacementsOf(normOf(r.part), links)
    if (!outs.length) { put(r); continue }
    const replacedBy = outs.map(o => ({ to: o.to, note: o.note, badge: badgeOf(o.trust), followed: o.followed }))
    const chain = followChain(r.part.part_number, normOf(r.part), links)
    const leads: Array<{ part: PartRow; was: string[]; condition: string | null }> = []
    if (chain.branches.length) {
      for (const b of chain.branches) {
        const pt = partByNumber.get(b.toNormalized)
        if (pt) leads.push({ part: pt, was: [chain.current, ...chain.was], condition: b.note })
      }
    } else if (chain.was.length) {
      const pt = partByNumber.get(chain.currentNormalized)
      if (pt) leads.push({ part: pt, was: chain.was, condition: null })
    }
    const forUnit = r.matchedBy === 'unit' || r.matchedBy === 'engine' || r.matchedBy === 'compressor'
    if (forUnit) {
      // The old number is never the answer for a unit; its fitment moves to the replacement.
      if (leads.length) for (const l of leads) put({ ...r, part: l.part, replaces: l.was, condition: l.condition, current: true, replacedBy: [] })
      else put({ ...r, current: false, replacedBy })
    } else {
      // Searched by number or words: still found, marked not current, with every replacement ...
      put({ ...r, current: false, replacedBy })
      // ... and the replacement is returned beside it.
      for (const l of leads) {
        put({
          part: l.part, fitment: (fitmentByPart.get(l.part.id) ?? []).map(decorate), unresolvedSerial: false,
          matchedBy: 'number', trust: trustOf(l.part), ...bare, replaces: l.was, condition: l.condition,
        })
      }
    }
  }
  const out = [...final.values()]

  // Current answers first; an exact number the tech typed leads; then vouched-for rows.
  out.sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    if (!!a.suppressedReason !== !!b.suppressedReason) return a.suppressedReason ? 1 : -1
    const ae = a.matchedBy === 'number' ? 0 : 1
    const be = b.matchedBy === 'number' ? 0 : 1
    if (ae !== be) return ae - be
    const at = a.trust ? trustRank(a.trust) : 99, bt = b.trust ? trustRank(b.trust) : 99
    if (at !== bt) return at - bt
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
      serial, part_type: partType, q, heading, configuration, build_date: buildDate, mount,
      // Stated plainly so a caller can tell the user WHY nothing came back.
      catch_all_excluded: hasUnitQuery,
      include_unfitted: includeUnfitted,
      show_unconfirmed: showUnconfirmed,
    },
    superseded: supersededNote,
    superseded_all: supersededAll,
    prices_available: pricesAvailable,
    count: out.length,
    unresolved_serial_count: unresolvedSerialCount,
    build_date_note: buildDateRaw && !buildDate ? `"${buildDateRaw}" is not a build date this can read (use 2023-07 or 07/2023), so it did not narrow the list.` : null,
    narrowed,
    suppressed,
    configuration_choices: configurationChoices,
    results: out.map(r => ({
      ...r.part,
      superseded_by: supersededByNumber.get(r.part.part_number_normalized) ?? null,
      current: r.current,
      replaced_by: r.replacedBy,
      replaces: r.replaces,
      condition: r.condition,
      suppressed: !!r.suppressedReason,
      suppressed_reason: r.suppressedReason,
      matched_by: r.matchedBy,
      ...(r.fitsUnit !== undefined ? { fits_unit: r.fitsUnit } : {}),
      trust: r.trust,
      category: categoryOf(r.part.part_type ?? ''),
      unresolved_serial: r.unresolvedSerial,
      fitment: r.fitment,
    })),
  })
}
