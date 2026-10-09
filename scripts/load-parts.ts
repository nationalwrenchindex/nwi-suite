// Load data/parts/*.csv into the migration-148 tables.
//
// RULES THIS LOADER HOLDS ITSELF TO
//
//   * Nothing invented. A fitment row whose model is a GROUP ("SB series (all)",
//     "Container", "Supra" with no series) is NOT guessed at and NOT expanded - it is
//     skipped and counted, and the report names every one. The database would refuse
//     it anyway; the point is that the loader refuses to paper over it.
//   * The verified flag is carried through honestly. brock-carrier-chart rows are
//     verified=yes because they came off a manufacturer chart. mincarone.net rows are
//     verified=no because they came off a vendor listing. The loader never promotes
//     one to the other.
//   * Idempotent. Run it twice and the second run changes nothing: parts upsert on
//     (manufacturer, normalized number), fitment and crosses are matched on their
//     natural key before inserting.
//   * Tolerant of migration 149 being unapplied. Migrations here are run by hand and
//     code deploys separately, so vendor_price may not exist yet. The loader notices,
//     loads everything else, and says so - it does not fail the whole load over a
//     column that is coming.
//
// Usage:  npx tsx scripts/load-parts.ts            (report only, writes nothing)
//         npx tsx scripts/load-parts.ts --write    (actually load)

import fs from 'fs'
import path from 'path'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }

const WRITE = process.argv.includes('--write')
const DIR = path.join('data', 'parts')

// ── CSV ─────────────────────────────────────────────────────────────────────
// Hand-rolled because the files are small and adding a dependency to read four
// files is not worth it. Handles quoted fields and escaped quotes, which the notes
// columns need.
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = [] }
    else field += c
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }

  const header = rows.shift()
  if (!header) return []
  return rows
    .filter(r => r.some(v => v.trim() !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

function read(name: string): Record<string, string>[] {
  const file = path.join(DIR, name)
  if (!fs.existsSync(file)) { console.log(`  MISSING: ${file}`); return [] }
  return parseCsv(fs.readFileSync(file, 'utf8'))
}

// ── the same rules the database enforces ────────────────────────────────────
const normalize = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')

// Mirrors public.is_single_model. Kept in step deliberately: if the loader thinks a
// value is fine and the database does not, the insert fails and the row is lost in a
// 400 rather than reported. This way the loader reports it first.
function isSingleModel(v: string | null): boolean {
  if (!v) return true
  if (!v.trim()) return false
  if (v.includes(',') || v.includes('/') || v.includes('+')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v)) return false
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  return true
}

// A model field may legitimately be a LIST that we CAN expand - a comma or slash list
// of complete model names. "Supra 650,Supra 750" expands to two rows. "SB series"
// does not expand, because nothing here knows which models are in it.
function expandModels(v: string): { models: string[]; expandable: boolean } {
  const raw = v.trim()
  if (!raw) return { models: [], expandable: false }
  if (isSingleModel(raw)) return { models: [raw], expandable: true }

  // Only a separator list is expandable. Anything carrying "series", "all", an x-mask
  // or a numeric range is a family, and a family is not a list of known names.
  if (/(^|[^a-z])(series|family|all|various|universal|thru|through)([^a-z]|$)/i.test(raw)) return { models: [], expandable: false }
  if (/[0-9]x{2,}/i.test(raw)) return { models: [], expandable: false }
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(raw)) return { models: [], expandable: false }

  const parts = raw.split(/[,/]/).map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return { models: [], expandable: false }
  if (!parts.every(isSingleModel)) return { models: [], expandable: false }
  return { models: parts, expandable: true }
}

// "BEFORE 11/1985 - build date break" states a date. Reading it is not inventing it;
// guessing at one that is not written down would be.
function buildDateBefore(note: string): string | null {
  const m = note.match(/before\s+([0-9]{1,2})\s*\/\s*([0-9]{4})/i)
  if (!m) return null
  const month = m[1].padStart(2, '0')
  return `${m[2]}-${month}-01`
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v.trim())

// ── REST helpers ────────────────────────────────────────────────────────────
async function get(path: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${S}/rest/v1/${path}`, {
      headers: { ...H, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' },
    })
    if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${(await res.text()).slice(0, 160)}`)
    const page = await res.json() as Record<string, unknown>[]
    out.push(...page)
    if (page.length < 1000) return out
  }
}

async function insert(table: string, rows: unknown[]): Promise<{ ok: number; failed: Array<{ row: unknown; error: string }> }> {
  if (!rows.length) return { ok: 0, failed: [] }
  const failed: Array<{ row: unknown; error: string }> = []
  let ok = 0
  // In batches, but a failed batch is retried row by row so ONE bad row cannot
  // silently discard 99 good ones.
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100)
    const res = await fetch(`${S}/rest/v1/${table}`, {
      method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(batch),
    })
    if (res.ok) { ok += batch.length; continue }
    for (const row of batch) {
      const one = await fetch(`${S}/rest/v1/${table}`, {
        method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify([row]),
      })
      if (one.ok) ok++
      else failed.push({ row, error: (await one.text()).slice(0, 200) })
    }
  }
  return { ok, failed }
}

// ── the load ────────────────────────────────────────────────────────────────
interface Counts { [k: string]: number }
const counts: Counts = {}
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n }
const notSourced: string[] = []

async function main() {
  console.log(`\nLOAD PARTS  ${WRITE ? 'WRITING' : 'DRY RUN - nothing will be written'}`)
  console.log('='.repeat(100))

  const partsCsv   = read('parts.csv')
  const fitmentCsv = read('fitment.csv')
  const carrierCsv = read('carrier-fitment.csv')
  const supersCsv  = read('supersessions.csv')

  console.log(`\n  parts.csv ............. ${partsCsv.length} rows`)
  console.log(`  fitment.csv ........... ${fitmentCsv.length} rows`)
  console.log(`  carrier-fitment.csv ... ${carrierCsv.length} rows`)
  console.log(`  supersessions.csv ..... ${supersCsv.length} rows`)

  // Does parts.vendor_price exist yet?
  const priceProbe = await fetch(`${S}/rest/v1/parts?select=vendor_price&limit=1`, { headers: H })
  const hasVendorPrice = priceProbe.ok
  console.log(`\n  parts.vendor_price .... ${hasVendorPrice ? 'present' : 'ABSENT - migration 149 not applied, prices will be skipped'}`)

  // ---------------------------------------------------------------- 1. parts
  // The catalog is the union of parts.csv and every part referenced by a fitment
  // file. A part that appears only in the Carrier chart is still a part, and it is
  // sourced - the chart is where it came from.
  type PartRow = {
    part_number: string; manufacturer: string; part_type: string
    description: string | null; belt_section: string | null; belt_length: string | null
    belt_profile: string | null; notes: string | null; verified: boolean; source: string
    vendor_price?: number | null; vendor_price_source?: string | null
  }
  const wanted = new Map<string, PartRow>()
  const key = (mfr: string, num: string) => `${mfr.trim().toUpperCase()}|${normalize(num)}`

  for (const r of partsCsv) {
    const profile = r.belt_profile?.trim().toLowerCase()
    const price = r.vendor_price_usd?.trim() ? Number(r.vendor_price_usd) : null
    const row: PartRow = {
      part_number:  r.part_number.trim(),
      manufacturer: r.manufacturer.trim(),
      part_type:    r.part_type.trim() || 'Unknown',
      description:  r.description?.trim() || null,
      belt_section: r.belt_section?.trim() || null,
      belt_length:  r.belt_length?.trim() || null,
      belt_profile: profile === 'cogged' || profile === 'plain' ? profile : null,
      notes:        null,
      verified:     yes(r.verified),
      source:       r.source?.trim() || 'parts.csv',
    }
    if (hasVendorPrice) {
      row.vendor_price = Number.isFinite(price as number) ? price : null
      row.vendor_price_source = price !== null ? (r.source?.trim() || 'parts.csv') : null
    }
    wanted.set(key(row.manufacturer, row.part_number), row)
  }

  // Parts referenced by the Carrier chart but absent from parts.csv.
  for (const r of carrierCsv) {
    const k = key(r.manufacturer, r.part_number)
    if (wanted.has(k)) continue
    wanted.set(k, {
      part_number:  r.part_number.trim(),
      manufacturer: r.manufacturer.trim(),
      part_type:    r.part_type?.trim() || 'Unknown',
      description:  r.part_type?.trim() || null,
      belt_section: null, belt_length: null, belt_profile: null,
      notes:        'Cataloged from the Carrier fitment chart.',
      verified:     yes(r.verified),
      source:       r.source?.trim() || 'carrier-fitment.csv',
    })
    bump('parts added from the Carrier chart')
  }
  for (const r of fitmentCsv) {
    const k = key(r.manufacturer, r.part_number)
    if (wanted.has(k)) continue
    wanted.set(k, {
      part_number: r.part_number.trim(), manufacturer: r.manufacturer.trim(),
      part_type: 'Unknown', description: null,
      belt_section: null, belt_length: null, belt_profile: null,
      notes: 'Cataloged from the vendor fitment listing.',
      verified: yes(r.verified), source: r.source?.trim() || 'fitment.csv',
    })
    bump('parts added from the vendor fitment listing')
  }

  const existingParts = await get('parts?select=id,part_number,manufacturer,part_number_normalized')
  const haveKey = new Map<string, string>()
  for (const p of existingParts) haveKey.set(key(String(p.manufacturer), String(p.part_number)), String(p.id))

  const newParts = [...wanted.entries()].filter(([k]) => !haveKey.has(k)).map(([, v]) => v)
  console.log(`\n  PARTS`)
  console.log(`    already in the database ... ${existingParts.length}`)
  console.log(`    to insert ................ ${newParts.length}`)
  console.log(`    verified=yes among those . ${newParts.filter(p => p.verified).length}`)
  console.log(`    verified=no among those .. ${newParts.filter(p => !p.verified).length}`)

  if (WRITE && newParts.length) {
    const res = await insert('parts', newParts)
    console.log(`    inserted ................. ${res.ok}`)
    if (res.failed.length) {
      console.log(`    REFUSED .................. ${res.failed.length}`)
      res.failed.slice(0, 10).forEach(f => console.log(`      ${JSON.stringify(f.row).slice(0, 90)}  ${f.error.slice(0, 100)}`))
    }
  }

  // Prices for parts that are ALREADY in the catalog.
  //
  // The first load ran before migration 149 existed, so those rows have no price. A
  // loader that only ever INSERTS would leave them priceless forever and the
  // add-part-to-work-order flow would have nothing to mark up. So the price is filled
  // in on a later run - and only when it is currently NULL, so a price corrected by
  // hand in the product is never overwritten by a stale vendor listing.
  if (hasVendorPrice) {
    const priced = await get('parts?select=id,part_number,manufacturer,vendor_price&vendor_price=is.null')
    const byKey = new Map(priced.map(p => [key(String(p.manufacturer), String(p.part_number)), String(p.id)]))
    const updates: Array<{ id: string; vendor_price: number; vendor_price_source: string }> = []
    for (const r of partsCsv) {
      const raw = r.vendor_price_usd?.trim()
      if (!raw) continue
      const price = Number(raw)
      if (!Number.isFinite(price)) continue
      const id = byKey.get(key(r.manufacturer, r.part_number))
      if (id) updates.push({ id, vendor_price: price, vendor_price_source: r.source?.trim() || 'parts.csv' })
    }
    console.log(`\n  PRICES`)
    console.log(`    catalog rows with no price ..... ${priced.length}`)
    console.log(`    prices available from the CSV ... ${updates.length}`)
    if (WRITE && updates.length) {
      let ok = 0
      for (const u of updates) {
        const res = await fetch(`${S}/rest/v1/parts?id=eq.${u.id}`, {
          method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' },
          body: JSON.stringify({ vendor_price: u.vendor_price, vendor_price_source: u.vendor_price_source }),
        })
        if (res.ok) ok++
      }
      console.log(`    priced ......................... ${ok}`)
    }
  }

  // Re-read so every fitment row can be tied to a real part id.
  const allParts = WRITE ? await get('parts?select=id,part_number,manufacturer') : existingParts
  const idFor = new Map<string, string>()
  for (const p of allParts) idFor.set(key(String(p.manufacturer), String(p.part_number)), String(p.id))

  // On a DRY RUN the parts above have not been inserted, so every fitment row would
  // report "no such part" and the dry run would predict nothing useful. Stand in a
  // placeholder id for each part the write would have created, so the fitment counts
  // and the skip reasons are the ones a real run will produce.
  if (!WRITE) {
    let n = 0
    for (const [k] of wanted) if (!idFor.has(k)) idFor.set(k, `dry-run-${++n}`)
  }

  // ------------------------------------------------------------- 2. fitment
  type FitRow = {
    part_id: string; unit_model?: string | null; engine_model?: string | null
    compressor_model?: string | null; serial_from?: string | null; serial_before?: string | null
    build_date_before?: string | null; note?: string | null; verified: boolean; source: string
  }
  const fitRows: FitRow[] = []
  let expandedFrom = 0
  let expandedTo = 0

  // 2a. The vendor listing: unit models, unverified.
  for (const r of fitmentCsv) {
    const partId = idFor.get(key(r.manufacturer, r.part_number))
    if (!partId) { bump('fitment skipped - part not in the catalog'); notSourced.push(`fitment.csv ${r.part_number} - no such part`); continue }
    const raw = r.unit_model?.trim() ?? ''
    if (!raw) {
      bump('fitment skipped - vendor listed no unit')
      notSourced.push(`${r.part_number} - vendor listed no unit model (${r.fitment_note || 'no note'})`)
      continue
    }
    const { models, expandable } = expandModels(raw)
    if (!expandable) {
      bump('fitment skipped - a GROUP that cannot be expanded from any source')
      notSourced.push(`${r.part_number} - "${raw}" is a group, not a model (${r.fitment_note || 'no note'})`)
      continue
    }
    if (models.length > 1) { expandedFrom++; expandedTo += models.length }
    for (const model of models) {
      fitRows.push({
        part_id: partId, unit_model: model,
        build_date_before: buildDateBefore(r.fitment_note ?? ''),
        note: r.fitment_note?.trim() || null,
        verified: yes(r.verified), source: r.source?.trim() || 'fitment.csv',
      })
    }
  }

  // 2b. The Carrier chart: verified, already one row per model, with serial breaks.
  for (const r of carrierCsv) {
    const partId = idFor.get(key(r.manufacturer, r.part_number))
    if (!partId) { bump('carrier fitment skipped - part not in the catalog'); continue }
    const raw = r.model?.trim() ?? ''
    if (!raw) { bump('carrier fitment skipped - no model'); continue }
    const { models, expandable } = expandModels(raw)
    if (!expandable) {
      bump('carrier fitment skipped - a GROUP')
      notSourced.push(`carrier-fitment.csv ${r.part_number} - "${raw}" is a group`)
      continue
    }
    if (models.length > 1) { expandedFrom++; expandedTo += models.length }
    for (const model of models) {
      fitRows.push({
        part_id: partId, unit_model: model,
        serial_from:   r.serial_from?.trim()   || null,
        serial_before: r.serial_before?.trim() || null,
        note:          r.note?.trim()          || null,
        verified: yes(r.verified), source: r.source?.trim() || 'carrier-fitment.csv',
      })
    }
  }

  // 2c. parts.csv carries an engine_model column. A part that fits BY ENGINE is a
  // fitment row with engine_model set and no unit_model - that is what the column is
  // for, and writing it as a unit model would be a lie about what the part fits.
  for (const r of partsCsv) {
    const engine = r.engine_model?.trim()
    if (!engine) continue
    const partId = idFor.get(key(r.manufacturer, r.part_number))
    if (!partId) continue
    const { models, expandable } = expandModels(engine)
    if (!expandable) { notSourced.push(`${r.part_number} - engine "${engine}" is a group`); continue }
    for (const model of models) {
      fitRows.push({
        part_id: partId, engine_model: model,
        note: 'Fits by engine, not by unit model.',
        verified: yes(r.verified), source: r.source?.trim() || 'parts.csv',
      })
    }
  }

  // Deduplicate against what is already stored, and within this run.
  const existingFit = await get('part_fitment?select=part_id,unit_model,engine_model,compressor_model,serial_from,serial_before')
  const fitKey = (f: { part_id: string; unit_model?: string | null; engine_model?: string | null; compressor_model?: string | null; serial_from?: string | null; serial_before?: string | null }) =>
    [f.part_id, f.unit_model ?? '', f.engine_model ?? '', f.compressor_model ?? '', f.serial_from ?? '', f.serial_before ?? ''].join('|')
  const haveFit = new Set(existingFit.map(f => fitKey(f as never)))
  const seen = new Set<string>()
  const newFit = fitRows.filter(f => {
    const k = fitKey(f)
    if (haveFit.has(k) || seen.has(k)) { bump('fitment already present'); return false }
    seen.add(k)
    return true
  })

  console.log(`\n  FITMENT`)
  console.log(`    rows built from the CSVs ....................... ${fitRows.length}`)
  console.log(`    group strings expanded ......................... ${expandedFrom} -> ${expandedTo} rows`)
  console.log(`    already present ................................ ${fitRows.length - newFit.length}`)
  console.log(`    to insert ...................................... ${newFit.length}`)
  console.log(`      by unit model ................................ ${newFit.filter(f => f.unit_model).length}`)
  console.log(`      by engine model .............................. ${newFit.filter(f => f.engine_model).length}`)
  console.log(`      by compressor model .......................... ${newFit.filter(f => f.compressor_model).length}`)
  console.log(`    verified=yes ................................... ${newFit.filter(f => f.verified).length}`)
  console.log(`    verified=no .................................... ${newFit.filter(f => !f.verified).length}`)
  console.log(`    with a serial break ............................ ${newFit.filter(f => f.serial_from || f.serial_before).length}`)
  console.log(`    with a build-date break read from a note ....... ${newFit.filter(f => f.build_date_before).length}`)

  if (WRITE && newFit.length) {
    const res = await insert('part_fitment', newFit)
    console.log(`    inserted ....................................... ${res.ok}`)
    if (res.failed.length) {
      console.log(`    REFUSED ........................................ ${res.failed.length}`)
      res.failed.slice(0, 10).forEach(f => console.log(`      ${JSON.stringify(f.row).slice(0, 90)}  ${f.error.slice(0, 120)}`))
    }
  }

  // -------------------------------------------------------- 3. supersessions
  const existingSupers = await get('part_supersession?select=manufacturer,old_number_normalized,new_number_normalized')
  const haveSuper = new Set(existingSupers.map(s => `${String(s.manufacturer).toUpperCase()}|${s.old_number_normalized}|${s.new_number_normalized}`))
  const newSupers = supersCsv
    .map(r => ({
      old_number: r.old_number.trim(), new_number: r.new_number.trim(),
      manufacturer: r.manufacturer.trim(), note: r.note?.trim() || null,
      verified: yes(r.verified), source: r.source?.trim() || 'supersessions.csv',
    }))
    .filter(s => !haveSuper.has(`${s.manufacturer.toUpperCase()}|${normalize(s.old_number)}|${normalize(s.new_number)}`))

  console.log(`\n  SUPERSESSIONS`)
  console.log(`    already present ... ${supersCsv.length - newSupers.length}`)
  console.log(`    to insert ......... ${newSupers.length}`)
  newSupers.forEach(s => console.log(`      ${s.old_number} -> ${s.new_number}  (${s.manufacturer}, verified=${s.verified})`))
  if (WRITE && newSupers.length) {
    const res = await insert('part_supersession', newSupers)
    console.log(`    inserted .......... ${res.ok}`)
    res.failed.forEach(f => console.log(`      REFUSED ${JSON.stringify(f.row).slice(0, 80)} ${f.error.slice(0, 120)}`))
  }

  // ----------------------------------------------------------- 4. the report
  console.log(`\n  WHAT WAS SKIPPED, AND WHY`)
  for (const [k, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${k}`)
  }

  if (notSourced.length) {
    console.log(`\n  COULD NOT BE SOURCED - left OUT rather than guessed (${notSourced.length}):`)
    notSourced.forEach(n => console.log(`    ${n}`))
  }

  if (!WRITE) console.log(`\n  DRY RUN. Nothing was written. Re-run with --write.`)
  console.log(`\n${'='.repeat(100)}\n`)
}

main().catch(e => { console.error(e); process.exitCode = 1 })
