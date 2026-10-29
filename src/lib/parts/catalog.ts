// Read the shared parts catalog (migration 148) for the counter, with or without the
// migration 175 columns.
//
// MIGRATIONS ARE APPLIED BY HAND AND CODE DEPLOYS SEPARATELY. So every read here asks
// for the 175 columns first and, if the database does not have them yet, asks again
// without them. The counter works in both states; `tiers` says which one it is in.
//
// Every read pages past PostgREST's 1,000-row cap. part_fitment holds 215 rows today
// and a seed load will put thousands in it; a plain select would silently stop at 1,000.

import type { createClient } from '@/lib/supabase/server'
import type { PostgrestError } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { isConfidenceTier, type ConfidenceTier, type SupersessionLink } from '@/lib/parts/counter'

type Supabase = Awaited<ReturnType<typeof createClient>>
type PageResult<T> = { data: T[] | null; error: PostgrestError | null }

export interface CatalogPart {
  id: string
  part_number: string
  part_number_normalized: string
  manufacturer: string
  part_type: string
  description: string | null
  belt_section_canonical: string | null
  belt_length: string | null
  belt_profile: string | null
  notes: string | null
  verified: boolean
  confidence: ConfidenceTier | null
  equipment_type: string | null
}

export interface CatalogFitment {
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
  confidence: ConfidenceTier | null
  match_type: string | null
  engine_code: string | null
  tier: string | null
  bm_from: string | null
  bm_to: string | null
}

export interface CatalogCross {
  part_id: string
  brand: string
  brand_number: string
  verified: boolean
  confidence: ConfidenceTier | null
}

export interface Catalog {
  parts: CatalogPart[]
  fitment: CatalogFitment[]
  links: SupersessionLink[]
  crosses: CatalogCross[]
  /** True when migration 175's columns exist. */
  tiers: boolean
}

// `source` is deliberately NOT read. It holds where a row came from - for the vendor
// rows that is a store's name - and the counter shows a trust tier, never a source.
const PART_148 = 'id, part_number, part_number_normalized, manufacturer, part_type, description, belt_section_canonical, belt_length, belt_profile, notes, verified'
const FIT_148  = 'id, part_id, unit_model, engine_model, compressor_model, serial_from, serial_before, build_date_from, build_date_before, qty_per_unit, note, verified'
const LINK_148 = 'id, old_number, new_number, old_number_normalized, new_number_normalized, manufacturer, note, verified'
const CROSS_148 = 'id, part_id, brand, brand_number, verified'

/** Read every row, asking for the 175 columns first and retrying without them. */
async function readAll<T>(
  supabase: Supabase, table: string, base: string, extra: string,
): Promise<{ rows: T[]; withExtra: boolean }> {
  const run = (cols: string) => fetchAllRows<T>((from, to) =>
    supabase.from(table).select(cols).order('id').range(from, to) as unknown as PromiseLike<PageResult<T>>)
  try {
    return { rows: await run(`${base}, ${extra}`), withExtra: true }
  } catch {
    // The 175 columns are not there yet (or the read failed for another reason, which
    // the retry will surface by throwing on its own).
    return { rows: await run(base), withExtra: false }
  }
}

const tierOf = (v: unknown): ConfidenceTier | null => (isConfidenceTier(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export async function readCatalog(supabase: Supabase): Promise<Catalog> {
  const [p, f, l, c] = await Promise.all([
    readAll<Record<string, unknown>>(supabase, 'parts', PART_148, 'confidence, equipment_type'),
    readAll<Record<string, unknown>>(supabase, 'part_fitment', FIT_148, 'confidence, match_type, engine_code, tier, bm_from, bm_to'),
    readAll<Record<string, unknown>>(supabase, 'part_supersession', LINK_148, 'confidence'),
    readAll<Record<string, unknown>>(supabase, 'part_cross_reference', CROSS_148, 'confidence'),
  ])

  return {
    tiers: p.withExtra,
    parts: p.rows.map(r => ({
      id: String(r.id),
      part_number: String(r.part_number),
      part_number_normalized: String(r.part_number_normalized ?? ''),
      manufacturer: String(r.manufacturer),
      part_type: String(r.part_type),
      description: str(r.description),
      belt_section_canonical: str(r.belt_section_canonical),
      belt_length: str(r.belt_length),
      belt_profile: str(r.belt_profile),
      notes: str(r.notes),
      verified: !!r.verified,
      confidence: tierOf(r.confidence),
      equipment_type: str(r.equipment_type),
    })),
    fitment: f.rows.map(r => ({
      id: String(r.id),
      part_id: String(r.part_id),
      unit_model: str(r.unit_model),
      engine_model: str(r.engine_model),
      compressor_model: str(r.compressor_model),
      serial_from: str(r.serial_from),
      serial_before: str(r.serial_before),
      build_date_from: str(r.build_date_from),
      build_date_before: str(r.build_date_before),
      qty_per_unit: r.qty_per_unit == null ? null : Number(r.qty_per_unit),
      note: str(r.note),
      verified: !!r.verified,
      confidence: tierOf(r.confidence),
      match_type: str(r.match_type),
      engine_code: str(r.engine_code),
      tier: str(r.tier),
      bm_from: str(r.bm_from),
      bm_to: str(r.bm_to),
    })),
    links: l.rows.map(r => ({
      old_number: String(r.old_number),
      new_number: String(r.new_number),
      old_number_normalized: String(r.old_number_normalized ?? ''),
      new_number_normalized: String(r.new_number_normalized ?? ''),
      manufacturer: String(r.manufacturer),
      note: str(r.note),
      verified: !!r.verified,
      confidence: tierOf(r.confidence),
    })),
    crosses: c.rows.map(r => ({
      part_id: String(r.part_id),
      brand: String(r.brand),
      brand_number: String(r.brand_number),
      verified: !!r.verified,
      confidence: tierOf(r.confidence),
    })),
  }
}

/**
 * This shop's stock per part, summed across its locations, from the ledger's own view.
 * Read with the USER's client: since migration 173 the view runs as the caller, so row
 * level security hands back this shop's rows and nobody else's.
 */
export interface PartStock {
  on_hand: number
  allocated: number
  available: number
  locations: Array<{ location_id: string; location_name: string | null; bin: string | null; on_hand: number; available: number }>
}

export async function readStockByPart(supabase: Supabase, userId: string): Promise<Map<string, PartStock>> {
  const out = new Map<string, PartStock>()
  let rows: Record<string, unknown>[] = []
  try {
    rows = await fetchAllRows<Record<string, unknown>>((from, to) =>
      supabase.from('inventory_position')
        .select('part_id, location_id, location_name, bin, on_hand, allocated, available')
        .eq('user_id', userId)
        .order('part_id')
        .range(from, to) as unknown as PromiseLike<PageResult<Record<string, unknown>>>)
  } catch (err) {
    // Stock is detail on a lookup. Its absence must not fail the counter.
    console.error('[parts/catalog] stock read failed:', err instanceof Error ? err.message : String(err))
    return out
  }
  for (const r of rows) {
    const id = String(r.part_id)
    const cur = out.get(id) ?? { on_hand: 0, allocated: 0, available: 0, locations: [] }
    cur.on_hand   += Number(r.on_hand ?? 0)
    cur.allocated += Number(r.allocated ?? 0)
    cur.available += Number(r.available ?? 0)
    cur.locations.push({
      location_id: String(r.location_id),
      location_name: str(r.location_name),
      bin: str(r.bin),
      on_hand: Number(r.on_hand ?? 0),
      available: Number(r.available ?? 0),
    })
    out.set(id, cur)
  }
  return out
}
