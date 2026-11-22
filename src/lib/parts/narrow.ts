// Narrowing a unit search with Brock's belt and filter chart (Part 4, Nov 22, 2026).
//
// PURE, like search.ts and counter.ts: the counter route and the parts search route both
// call narrowUnitRows, so the two cannot disagree about what fits, and every rule here is
// tested without a database (scripts/verify-parts-narrow.ts).
//
// THE ORDER (Brock): mount, unit model, engine, serial, build date, configuration. The unit
// model is matched before this is called (unitModelMatches, below); the rest happens here.
//
// BROCK'S RULINGS THIS CARRIES
//   * mount_type is the REEFER's mount, read from the fitment row (migration 190). It is
//     never parts.equipment_type: that stays a surface scope filter (inScope) and is not
//     read here at all.
//   * A unit search never returns a row marked contradicted (confidence = 'conflict').
//   * Blank engine is a FALLBACK, not a wildcard: with an engine named, a row naming a
//     different engine is out, and a confirmed blank-engine row ("the standard group") is
//     in ONLY when no confirmed row of that part type names the engine asked for.
//   * Weaker rows lose to the chart: where a settled row covers this unit and part type,
//     an unconfirmed row with no bounds, for a part the chart does not give, is SUPPRESSED -
//     returned separately, never deleted, revealed by "show unconfirmed matches".
//   * A settled row's bounds beat a weaker, broader row for the same part on the same
//     unit: when the chart's own row for a part is ruled out by the serial, date, engine
//     or configuration, no unconfirmed row for that part brings it back.
//   * Parts split only by configuration are named as a choice, never two unexplained hits.
//   * S-600 and Precedent S-600 are one unit, for the nine Precedent models in the chart.
//     Matched at query time; no row is rewritten.

import { modelMatches, normalizeModel, serialApplies } from './search'
import { displayOf, type Trust } from './counter'

// ── unit model: the Precedent names ─────────────────────────────────────────

/** The nine Precedent models in Brock's chart. Rows sit under both "Precedent S-600" and
 *  bare "S-600" (102 rows on the bare name); both are one unit. Not S-610, C-700, G-600 or
 *  the rest - the ruling covers these nine and nothing is guessed beyond them. */
export const PRECEDENT_MODELS = [
  'C-600', 'C-600M', 'S-600', 'S-600DE', 'S-600M', 'S-610DE', 'S-610M', 'S-700', 'S-750i',
] as const

const PRECEDENT_KEYS = new Set<string>(PRECEDENT_MODELS.map(normalizeModel))

function precedentKey(value: string): string | null {
  const n = normalizeModel(value)
  const bare = n.startsWith('PRECEDENT') ? n.slice('PRECEDENT'.length) : n
  return PRECEDENT_KEYS.has(bare) ? bare : null
}

/** modelMatches (exact, normalized, never a catch-all), plus the Precedent names. */
export function unitModelMatches(fitmentModel: string | null | undefined, wanted: string | null | undefined): boolean {
  if (modelMatches(fitmentModel, wanted)) return true
  if (!fitmentModel || !wanted || !wanted.trim()) return false
  const a = precedentKey(fitmentModel)
  return a !== null && a === precedentKey(wanted)
}

// ── build date ──────────────────────────────────────────────────────────────

/** A build date as typed - 2023, 2023-07, 07/2023, 2023-07-15 - as YYYY-MM-DD, or null. */
export function parseBuildDate(value: string | null | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  let m = v.match(/^(\d{4})$/)
  if (m) return `${m[1]}-01-01`
  m = v.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/)
  if (m) return iso(m[1], m[2], m[3] ?? '1')
  m = v.match(/^(\d{1,2})\/(\d{4})$/)
  if (m) return iso(m[2], m[1], '1')
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) return iso(m[3], m[1], m[2])
  return null
}

function iso(y: string, mo: string, d: string): string | null {
  const month = Number(mo), day = Number(d)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** from <= build < before, the way build_date_from / build_date_before are recorded. */
export function buildDateApplies(
  row: { build_date_from?: string | null; build_date_before?: string | null }, buildDate: string | null,
): boolean {
  if (!buildDate) return true
  const from = row.build_date_from?.slice(0, 10), before = row.build_date_before?.slice(0, 10)
  if (from && buildDate < from) return false
  if (before && buildDate >= before) return false
  return true
}

// ── the rows being narrowed ─────────────────────────────────────────────────

export type Mount = 'truck' | 'trailer'

export interface NarrowRow {
  id: string
  part_id: string
  /** The catalog part type - the "part family" in Brock's rulings. */
  family: string
  /** engine_code, else engine_model. */
  engine: string | null
  serial_from: string | null
  serial_before: string | null
  build_date_from: string | null
  build_date_before: string | null
  mount_type: string | null
  configuration: string | null
  /** What the part does on this unit, as charted (migration 191). Null before 191. */
  role: string | null
  trust: Trust
}

export interface NarrowQuery {
  mount?: Mount | null
  engine?: string | null
  serial?: string | null
  /** YYYY-MM-DD, from parseBuildDate. */
  buildDate?: string | null
  configuration?: string | null
  /** The typed words, when they are words and not a number ("drive belt"). */
  words?: string | null
}

export type NarrowReason =
  | 'conflict' | 'mount' | 'engine' | 'engine_fallback' | 'serial' | 'build_date' | 'configuration' | 'role'

export interface SuppressedRow<R> {
  row: R
  /** Said to the technician when "show unconfirmed matches" is on. */
  reason: string
}

export interface ConfigurationChoice {
  family: string
  role: string | null
  options: Array<{ configuration: string; part_ids: string[] }>
}

export interface NarrowResult<R> {
  kept: R[]
  suppressed: SuppressedRow<R>[]
  /** Row ids whose serial could not be compared with the one given. Kept, and flagged. */
  unresolvedSerial: Set<string>
  /** Rows taken out, by rule - so a response can say what narrowed it. */
  excluded: Record<NarrowReason, number>
  unitMount: Mount | null
  configurationChoices: ConfigurationChoice[]
}

const settled = (t: Trust) => displayOf(t) === 'plain'
const weak    = (t: Trust) => displayOf(t) === 'one_source'
const norm    = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** No engine, serial, build date or configuration: a row that claims the whole unit. */
export function unbounded(r: NarrowRow): boolean {
  return !r.engine && !r.serial_from && !r.serial_before && !r.build_date_from && !r.build_date_before && !r.configuration
}

export function engineMatches(rowEngine: string, wanted: string): boolean {
  const a = normalizeModel(rowEngine), b = normalizeModel(wanted)
  return !!a && a === b
}

/** Do the typed words name this charted role? "drive belt" -> "Drive belt"; "belt" names every belt. */
export function roleMatches(role: string, words: string): boolean {
  const w = norm(words)
  return !!w && norm(role).includes(w)
}

/** The unit's mount, when its rows state exactly one. */
export function unitMountOf(rows: Array<{ mount_type: string | null }>): Mount | null {
  const seen = new Set(rows.map(r => r.mount_type).filter((m): m is string => m === 'truck' || m === 'trailer'))
  return seen.size === 1 ? ([...seen][0] as Mount) : null
}

/** Every mount a part is charted on, across all its rows: part_id -> mounts. */
export function partMountsOf(rows: Array<{ part_id: string; mount_type: string | null }>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.mount_type !== 'truck' && r.mount_type !== 'trailer') continue
    const s = out.get(r.part_id) ?? new Set<string>()
    s.add(r.mount_type)
    out.set(r.part_id, s)
  }
  return out
}

/**
 * Narrow the fitment rows that matched one unit model.
 *
 * `rows` are the candidate rows (already the asked part type / words). `unitRows` are
 * EVERY row matching the unit model, whatever the part type - they decide the unit's mount.
 * `partMounts` comes from partMountsOf over the whole fitment table.
 */
export function narrowUnitRows<R extends NarrowRow>(
  rows: R[], q: NarrowQuery, partMounts: Map<string, Set<string>>, unitRows: Array<{ mount_type: string | null }> = rows,
): NarrowResult<R> {
  const excluded: Record<NarrowReason, number> = {
    conflict: 0, mount: 0, engine: 0, engine_fallback: 0, serial: 0, build_date: 0, configuration: 0, role: 0,
  }
  const drop = (list: R[], keep: (r: R) => boolean, why: NarrowReason): R[] =>
    list.filter(r => { const k = keep(r); if (!k) excluded[why]++; return k })

  // 0. A row the chart contradicts is never an answer.
  let live = drop(rows, r => r.trust.tier !== 'conflict', 'conflict')

  // 1. Mount. The row's own mount, and the part's: a truck-only part is not offered for a
  //    trailer unit through a row that does not state a mount.
  const unitMount = q.mount ?? unitMountOf(unitRows)
  if (unitMount) {
    live = drop(live, r => {
      if (r.mount_type) return r.mount_type === unitMount
      const mounts = partMounts.get(r.part_id)
      return !mounts || mounts.size === 0 || mounts.has(unitMount)
    }, 'mount')
  }

  // What the chart covers on this unit, decided BEFORE the bounds narrow it: a part type
  // with a settled row, and the parts that have one.
  const coveredFamilies = new Set(live.filter(r => settled(r.trust)).map(r => r.family))
  const settledParts    = new Set(live.filter(r => settled(r.trust)).map(r => `${r.family}|${r.part_id}`))

  // 2. Engine. A row naming another engine is out. A settled blank-engine row is the
  //    standard group: in only when no settled row of its part type names this engine.
  if (q.engine?.trim()) {
    const want = q.engine
    live = drop(live, r => !r.engine || engineMatches(r.engine, want), 'engine')
    const familiesWithEngine = new Set(live.filter(r => settled(r.trust) && r.engine && engineMatches(r.engine, want)).map(r => r.family))
    live = drop(live, r => !(settled(r.trust) && !r.engine && familiesWithEngine.has(r.family)), 'engine_fallback')
  }

  // 3. Serial. Not comparable -> kept and flagged, never silently dropped.
  const unresolvedSerial = new Set<string>()
  if (q.serial?.trim()) {
    live = drop(live, r => {
      const a = serialApplies(r, q.serial)
      if (a === null) unresolvedSerial.add(r.id)
      return a !== false
    }, 'serial')
  }

  // 4. Build date.
  if (q.buildDate) live = drop(live, r => buildDateApplies(r, q.buildDate ?? null), 'build_date')

  // 5. Configuration. A row for every configuration (NULL) stays.
  if (q.configuration?.trim()) {
    const want = norm(q.configuration)
    live = drop(live, r => !r.configuration || norm(r.configuration) === want, 'configuration')
  }

  // 6. Role (191): "drive belt" keeps the parts charted as the drive belt on this unit.
  //    Only when some row is charted with that role - otherwise the words narrowed by part
  //    type already, and nothing is taken out on a column the row does not have.
  if (q.words?.trim()) {
    const words = q.words
    const hit = new Set(live.filter(r => r.role && roleMatches(r.role, words)).map(r => r.part_id))
    if (hit.size) live = drop(live, r => hit.has(r.part_id) && (!r.role || roleMatches(r.role, words)), 'role')
  }

  // 7. Weaker rows lose to the chart.
  const kept: R[] = []
  const suppressed: SuppressedRow<R>[] = []
  const settledLeft = new Set(live.filter(r => settled(r.trust)).map(r => `${r.family}|${r.part_id}`))
  for (const r of live) {
    if (!weak(r.trust)) { kept.push(r); continue }
    const key = `${r.family}|${r.part_id}`
    // The same part has a settled row here: the chart's row is the claim, with ITS bounds.
    // A weaker row - bounded or not - neither adds to it nor brings the part back when the
    // chart's own bounds rule it out.
    if (settledLeft.has(key)) continue
    if (settledParts.has(key)) {
      suppressed.push({ row: r, reason: "The chart's own row for this part does not match the serial, build date, engine or configuration given." })
    } else if (!unbounded(r)) {
      kept.push(r) // a bounded claim for a part the chart does not give: kept, with its bounds shown
    } else if (coveredFamilies.has(r.family)) {
      suppressed.push({ row: r, reason: `The chart covers ${r.family} on this unit and does not list this part.` })
    } else {
      kept.push(r)
    }
  }

  // 8. Parts split only by configuration: a choice to put to the technician.
  const configurationChoices: ConfigurationChoice[] = []
  if (!q.configuration?.trim()) {
    const groups = new Map<string, R[]>()
    for (const r of kept) {
      if (!settled(r.trust) || !r.configuration) continue
      const k = `${r.family}|${r.role ?? ''}`
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    for (const g of groups.values()) {
      const byConfig = new Map<string, Set<string>>()
      for (const r of g) byConfig.set(r.configuration!, (byConfig.get(r.configuration!) ?? new Set()).add(r.part_id))
      const partsInGroup = new Set(g.map(r => r.part_id))
      if (byConfig.size < 2 || partsInGroup.size < 2) continue
      configurationChoices.push({
        family: g[0].family, role: g[0].role,
        options: [...byConfig.entries()].map(([configuration, ids]) => ({ configuration, part_ids: [...ids] }))
          .sort((a, b) => a.configuration.localeCompare(b.configuration)),
      })
    }
  }

  return { kept, suppressed, unresolvedSerial, excluded, unitMount, configurationChoices }
}
