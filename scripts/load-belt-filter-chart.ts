// Load Brock's TK + Carrier belt and filter chart (scripts/data/nwi-fitment-belts-filters.csv)
// as field-confirmed fitment. Nov 16, 2026. Needs migration 190 (mount_type, configuration).
//
//   npx tsx scripts/load-belt-filter-chart.ts            dry run: builds every row, writes nothing
//   npx tsx scripts/load-belt-filter-chart.ts --write    inserts
//
// ADDITIVE ONLY. Inserts new part_fitment rows (one per CSV line) and new part_supersession
// rows (one per distinct superseded_by pair not already in the table). It never updates or
// deletes an existing row and inserts no parts (all 167 chart parts are already cataloged;
// it refuses to run if one is missing).
//
//   - The CSV column equipment_type holds the reefer's MOUNT (truck | trailer). It goes into
//     part_fitment.mount_type, never parts.equipment_type (Brock, Nov 16).
//   - Dates go into build_date_from / build_date_before: "2023-07" -> 2023-07-01, "2013" ->
//     2013-01-01. Nothing else is invented.
//   - Part numbers and model names are loaded exactly as charted. TK numbers are already
//     normalized in the file; nothing is re-normalized.
//   - Each fitment row: source brock-belt-filter-chart-2026-11-16, source_row = CSV line
//     (header = line 1), confidence confirmed, verified true, match_type unit_model.
//
// Refuses to run twice: if any row with this source exists, it stops.
import { config } from 'dotenv'; config({ path: '.env.local' })
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { partNumberKey } from '../src/lib/parts/part-number'

const SOURCE = 'brock-belt-filter-chart-2026-11-16'
const FILE = 'scripts/data/nwi-fitment-belts-filters.csv'
const MFR: Record<string, string> = { 'Thermo King': 'Thermo King', 'Carrier': 'Carrier Transicold' }
const WRITE = process.argv.includes('--write')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f || row.length) { row.push(f.replace(/\r$/, '')); rows.push(row) }
  return rows.filter(r => r.some(x => x !== ''))
}
function chartDate(v: string, line: number): string | null {
  if (!v) return null
  if (/^\d{4}$/.test(v)) return `${v}-01-01`
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return `${v}-01`
  throw new Error(`line ${line}: date "${v}" is not YYYY or YYYY-MM`)
}
const blank = (v: string) => (v.trim() === '' ? null : v.trim())
const die = (m: string): never => { console.error('REFUSED: ' + m); process.exit(1) }

async function count(table: string, filter?: (q: any) => any) {
  let q = s.from(table).select('id', { count: 'exact', head: true }); if (filter) q = filter(q)
  const { count: n, error } = await q; if (error) die(`${table} count: ${error.message}`); return n as number
}

async function main() {
  const rows = parseCsv(readFileSync(FILE, 'utf8').replace(/^﻿/, ''))
  const head = rows[0]
  const want = ['manufacturer', 'part_number', 'part_number_as_charted', 'part_type', 'equipment_type', 'unit_model', 'engine_model', 'serial_from', 'serial_before', 'date_from', 'date_before', 'configuration', 'superseded_by', 'notes']
  if (head.join(',') !== want.join(',')) die(`header is not the expected 14 columns: ${head.join(',')}`)
  const csv = rows.slice(1).map((r, i) => { if (r.length !== 14) die(`line ${i + 2} has ${r.length} fields`); return { ...Object.fromEntries(head.map((k, j) => [k, r[j]])), line: i + 2 } as Record<string, any> })
  if (csv.length !== 758) die(`expected 758 data rows, found ${csv.length}`)

  // 190 must be applied.
  const probe = await s.from('part_fitment').select('mount_type, configuration').limit(1)
  if (probe.error) die(`migration 190 columns not readable: ${probe.error.message}`)
  if (await count('part_fitment', q => q.eq('source', SOURCE))) die(`part_fitment already has rows from ${SOURCE}; this load ran before`)
  if (await count('part_supersession', q => q.eq('source', SOURCE))) die(`part_supersession already has rows from ${SOURCE}`)

  // Resolve every part by manufacturer + normalized number (the catalog's unique key).
  // Paged: PostgREST returns at most 1,000 rows per request whatever .limit() says.
  const parts: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error: pe } = await s.from('parts').select('id, part_number, part_number_normalized, manufacturer').in('manufacturer', Object.values(MFR)).order('id').range(from, from + 999)
    if (pe) die(pe.message)
    parts.push(...data!); if (data!.length < 1000) break
  }
  const byKey = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))

  const fitment = csv.map(r => {
    const mfr = MFR[r.manufacturer] ?? die(`line ${r.line}: manufacturer "${r.manufacturer}"`)
    const p = byKey.get(`${mfr}|${partNumberKey(r.part_number)}`) ?? die(`line ${r.line}: ${r.part_number} (${mfr}) is not in parts`)
    if (!['truck', 'trailer'].includes(r.equipment_type)) die(`line ${r.line}: mount "${r.equipment_type}"`)
    if (!blank(r.unit_model)) die(`line ${r.line}: no unit_model`)
    return {
      part_id: p.id,
      unit_model: r.unit_model.trim(),
      engine_model: blank(r.engine_model),
      serial_from: blank(r.serial_from),
      serial_before: blank(r.serial_before),
      build_date_from: chartDate(r.date_from.trim(), r.line),
      build_date_before: chartDate(r.date_before.trim(), r.line),
      mount_type: r.equipment_type,
      configuration: blank(r.configuration),
      note: blank(r.notes),
      match_type: 'unit_model',
      confidence: 'confirmed',
      verified: true,
      source: SOURCE,
      source_row: r.line,
    }
  })

  // Supersessions: distinct (manufacturer, old, new) pairs not already present.
  const { data: sup, error: se } = await s.from('part_supersession').select('manufacturer, old_number_normalized, new_number_normalized').range(0, 999)
  if (se) die(se.message)
  if (sup!.length >= 1000) die('part_supersession read hit 1,000 rows; read in pages')
  const have = new Set(sup!.map(x => `${x.manufacturer}|${x.old_number_normalized}|${x.new_number_normalized}`))
  const pairs = new Map<string, any>(); const skipped: string[] = []
  for (const r of csv) {
    if (!blank(r.superseded_by)) continue
    const mfr = MFR[r.manufacturer]
    const k = `${mfr}|${partNumberKey(r.part_number)}|${partNumberKey(r.superseded_by)}`
    if (have.has(k)) { if (!skipped.includes(`${r.part_number} -> ${r.superseded_by}`)) skipped.push(`${r.part_number} -> ${r.superseded_by}`); continue }
    if (!pairs.has(k)) pairs.set(k, { old_number: r.part_number, new_number: r.superseded_by.trim(), manufacturer: mfr, verified: true, confidence: 'confirmed', source: SOURCE, source_row: r.line, note: null })
  }
  const supRows = [...pairs.values()]

  const before = { fit: await count('part_fitment'), sup: await count('part_supersession'), parts: await count('parts') }
  console.log(`before: part_fitment ${before.fit}, part_supersession ${before.sup}, parts ${before.parts}`)
  console.log(`built: ${fitment.length} fitment rows (truck ${fitment.filter(f => f.mount_type === 'truck').length}, trailer ${fitment.filter(f => f.mount_type === 'trailer').length}; with engine ${fitment.filter(f => f.engine_model).length}, serial ${fitment.filter(f => f.serial_from || f.serial_before).length}, date ${fitment.filter(f => f.build_date_from || f.build_date_before).length}, configuration ${fitment.filter(f => f.configuration).length}, note ${fitment.filter(f => f.note).length})`)
  console.log(`built: ${supRows.length} supersession rows: ${supRows.map(x => `${x.old_number} -> ${x.new_number}`).join(', ')}`)
  console.log(`already present, not inserted: ${skipped.join(', ') || 'none'}`)
  if (!WRITE) { console.log('DRY RUN - nothing written. Pass --write to insert.'); return }

  // One request per table: PostgREST runs each as a single INSERT, all rows or none.
  const { data: insF, error: fe } = await s.from('part_fitment').insert(fitment).select('id')
  if (fe) die(`part_fitment insert failed, nothing inserted: ${fe.message}`)
  const { data: insS, error: sse } = supRows.length ? await s.from('part_supersession').insert(supRows).select('id') : { data: [], error: null }
  if (sse) die(`part_supersession insert failed (the ${insF!.length} fitment rows ARE in): ${sse.message}`)

  const after = { fit: await count('part_fitment'), sup: await count('part_supersession'), parts: await count('parts') }
  const mine = await count('part_fitment', q => q.eq('source', SOURCE))
  console.log(`inserted: ${insF!.length} fitment, ${insS!.length} supersession`)
  console.log(`after: part_fitment ${after.fit} (+${after.fit - before.fit}), part_supersession ${after.sup} (+${after.sup - before.sup}), parts ${after.parts} (+${after.parts - before.parts}); rows with this source: ${mine}`)
  const ok = after.fit - before.fit === fitment.length && after.sup - before.sup === supRows.length && after.parts === before.parts && mine === fitment.length
  console.log(ok ? 'CHECK PASSED' : 'CHECK FAILED')
  if (!ok) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
