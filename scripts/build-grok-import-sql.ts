// npx tsx scripts/build-grok-import-sql.ts [path-to-csv]
//
// READS the database and the Grok parts file, WRITES ONE FILE: scripts/import-grok-parts.sql.
// Never writes to the database. Brock runs the SQL by hand; it ends in ROLLBACK.
//
// Default file: C:\Users\natio\Downloads\can-ca-tk-carrier-parts-oem-only.csv
// (2,692 rows, 830 numbers, Oct 28). Columns USED: maker, part_number, part_name,
// description, unit_model, engine_model. NOT USED: source_url and notes (stripped -
// they name the vendor), part_category (coarser than part_name), number_type (all "oem").
//
// RULES (Brock, Oct 28)
//   * every number goes through parsePartNumber before any comparison
//   * a part already in the store is not added again; fitment it carries that the store
//     row lacks is added to the store row. Store parts are never edited.
//   * every new row: verified = false, confidence NULL. It came off a vendor listing.
//   * TK and Carrier never cross: a row whose digit shape disagrees with its maker is held
//
// HELD, not loaded - each is Brock's decision, listed in the SQL header:
//   * suffixed numbers (SV, K, KIT, SS, FA, E), with their fitment
//   * numbers that fit none of his rules (18-00091-105), kept as written, not loaded
//   * parts the source chart marks as an OLD number ("current: ...") - loading them would
//     put a superseded number on the counter as current; listed as supersession candidates
//   * fitment rows whose (stripped) notes carry a serial or date break - loading them
//     without the break would claim the part fits every serial of the unit
//   * fitment with a group model string (SB-210+); the part loads, the fitment waits
//   * a new part whose own rows disagree on what it is (after the type mapping)
//   * fitment onto a number the store already records as SUPERSEDED - the Oct 28 fold-in
//     put Supra 560-960 onto 30-01121-00 that way, and the parts search then offered the
//     old oil filter beside its replacement
//
// Part types: file part_name mapped onto the store's vocabulary where they mean the same
// thing (PROPOSED - Brock approves by committing); anything else keeps the file's words.

import fs from 'fs'
import { loadEnv } from './lib/smoke-session'
import { parsePartNumber, partNumberKey } from '../src/lib/parts/part-number'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const FILE = process.argv[2] ?? 'C:/Users/natio/Downloads/can-ca-tk-carrier-parts-oem-only.csv'
const OUT = 'scripts/import-grok-parts.sql'
const SOURCE = 'nwi-import-oem-file-2026-10-28'

async function all(t: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${t}?select=*&order=id`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(`${t}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = '' }
    else cur += c
  }
  if (cur || row.length) { row.push(cur); rows.push(row) }
  return rows
}
const mk = (v: string) => /carrier/i.test(v) ? 'Carrier Transicold' : /thermo|^tk$/i.test(v) ? 'Thermo King' : v
const up = (v: string | null) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Same rule as public.is_single_model.
function isSingleModel(v: string): boolean {
  if (!v.trim()) return false
  if (v.includes(',') || v.includes('/') || v.includes('+')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v)) return false
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  return true
}

// PROPOSED: file part_name -> the store's part_type words, only where they are the same thing.
const TYPE_MAP: Array<[RegExp, string]> = [
  [/^air filter$/i, 'Filter - air'],
  [/^oil filter$/i, 'Filter - oil (engine)'],
  [/^oil filter \(bypass\)$/i, 'Filter - oil (bypass)'],
  [/^(fuel filter|fuel filter \(secondary\)|inline fuel filter)$/i, 'Filter - fuel'],
  [/^filter drier$/i, 'Drier'],
  [/^alternator\/generator$/i, 'Alternator'],
  [/^vibration mount$/i, 'Mount'],
  [/^fuel solenoid$/i, 'Solenoid - fuel'],
  [/^tank\/receiver$/i, 'Receiver tank'],
  [/^coolant temperature sensor$/i, 'Sensor - temperature'],
  [/^pressure transducer$/i, 'Sensor - pressure'],
  [/^high pressure cutout switch$/i, 'Switch - pressure'],
  [/^rpm sensor$/i, 'Sensor - rpm'],
  [/\bbelt$/i, 'Belt'],
]
const typeOf = (name: string) => TYPE_MAP.find(([re]) => re.test(name.trim()))?.[1] ?? name.trim()

const STORE_NAMES = /napa|o'?reilly|autozone|auto zone|advance auto|rockauto|fleetpride|fleet pride|amazon|ebay|mincarone|walmart|carquest|parts ?authority|can\.ca|www\.|https?:/i
const lit = (v: string | null) => {
  if (v == null) return 'NULL'
  if (/[^\x20-\x7E]/.test(v)) throw new Error(`non-ASCII in ${JSON.stringify(v)}`)
  return `'${v.replace(/'/g, "''")}'`
}

async function main() {
  const [parts, fit, sup] = await Promise.all([all('parts'), all('part_fitment'), all('part_supersession')])
  const superseded = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}`))
  const heldSuperseded: string[] = []
  const text = fs.readFileSync(FILE, 'utf8')
  const rows = parseCsv(text); const header = rows.shift()!.map(h => h.trim())
  const data = rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])))

  const store = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))
  const byKeyAnyMaker = new Map<string, Record<string, any>[]>()
  for (const p of parts) byKeyAnyMaker.set(p.part_number_normalized, [...(byKeyAnyMaker.get(p.part_number_normalized) ?? []), p])
  const storeFit = new Map<string, Array<{ u: string; e: string }>>()
  for (const f of fit) storeFit.set(f.part_id, [...(storeFit.get(f.part_id) ?? []), { u: up(f.unit_model), e: up(f.engine_model) }])

  type Group = { maker: string; raw: string; p: ReturnType<typeof parsePartNumber>; rows: Record<string, string>[] }
  const groups = new Map<string, Group>()
  for (const r of data) {
    const maker = mk(r.maker); const p = parsePartNumber(r.part_number)
    const k = `${maker}|${p.key}`
    const g = groups.get(k) ?? { maker, raw: r.part_number, p, rows: [] }
    g.rows.push(r); groups.set(k, g)
  }

  const held: Record<string, string[]> = { suffix: [], noRule: [], brand: [], oldNumber: [], selfConflict: [] }
  const heldFit = { serial: 0, group: [] as string[], heldParts: 0 }
  const newParts: Array<{ maker: string; number: string; type: string; description: string }> = []
  const dupes: Array<{ number: string; extracted: number }> = []
  const typeConflicts: string[] = []; const makerConflicts: string[] = []; const vendorText: string[] = []
  const fitRows: Array<{ maker: string; number: string; unit: string | null; engine: string | null; onto: 'new' | 'store' }> = []
  const supersessionCandidates: string[] = []
  let noFitmentRows = 0

  for (const g of groups.values()) {
    const { p, maker } = g
    const shapeMaker = p.maker === 'thermo_king' ? 'Thermo King' : p.maker === 'carrier' ? 'Carrier Transicold' : null
    const holdPart = (bucket: string, why: string) => { held[bucket].push(why); heldFit.heldParts += g.rows.filter(r => r.unit_model || r.engine_model).length }
    if (p.suffix) { holdPart('suffix', `${g.raw} (${g.rows.length} rows)`); continue }
    if (p.form !== 'thermo_king' && p.form !== 'carrier') { holdPart('noRule', `${g.raw} (${p.form}, ${g.rows.length} rows)`); continue }
    if (shapeMaker !== maker) { holdPart('brand', `${g.raw}: file says ${maker}, digits say ${shapeMaker ?? 'neither'}`); continue }
    const oldRows = g.rows.filter(r => /old number/i.test(r.notes))
    if (oldRows.length) {
      const cur = [...new Set(oldRows.map(r => ((r.notes.match(/current:\s*([^;]+)/i) ?? [])[1] ?? '?').trim()))]
      holdPart('oldNumber', `${g.raw} -> current ${cur.map(c => c.split(/\s+/).map(n => parsePartNumber(n).canonical).join(' / ')).join(' | ')}`)
      supersessionCandidates.push(`${g.raw} -> ${cur.join(' | ')}`)
      continue
    }
    for (const o of (byKeyAnyMaker.get(p.key) ?? []).filter(x => x.manufacturer !== maker)) makerConflicts.push(`${g.raw}: file ${maker}, store ${o.manufacturer} ${o.part_number}`)

    const types = [...new Set(g.rows.map(r => typeOf(r.part_name)))]
    const kept = store.get(`${maker}|${p.key}`)
    if (!kept && types.length > 1) { holdPart('selfConflict', `${g.raw}: ${[...new Set(g.rows.map(r => r.part_name))].join(' | ')}`); continue }
    if (kept && !types.includes(kept.part_type)) typeConflicts.push(`${kept.part_number.padEnd(12)} store "${kept.part_type}"  file "${[...new Set(g.rows.map(r => r.part_name))].join('" / "')}"`)

    // Fitment, one row per (unit, engine), never one the store row already has.
    const have = kept ? (storeFit.get(kept.id) ?? []) : []
    const seen = new Set<string>()
    let extracted = 0
    const isOld = superseded.has(`${maker}|${p.key}`)
    for (const r of g.rows) {
      if (!r.unit_model && !r.engine_model) { noFitmentRows++; continue }
      if (/serial|SN#|date/i.test(r.notes)) { heldFit.serial++; continue }
      const bad = [r.unit_model, r.engine_model].filter(v => v && !isSingleModel(v))
      if (bad.length) { heldFit.group.push(`${g.raw}: ${bad.join(', ')}`); continue }
      const u = up(r.unit_model), e = up(r.engine_model)
      const k = `${u}|${e}`
      if (seen.has(k)) continue
      seen.add(k)
      if (isOld) { heldSuperseded.push(`${p.canonical}: ${r.unit_model || r.engine_model}`); continue }
      if (u ? have.some(h => h.u === u) : have.some(h => h.e === e)) continue
      fitRows.push({ maker, number: kept ? kept.part_number : p.canonical, unit: r.unit_model || null, engine: r.engine_model || null, onto: kept ? 'store' : 'new' })
      if (kept) extracted++
    }
    if (kept) { dupes.push({ number: kept.part_number, extracted }); continue }

    const first = g.rows[0]
    const description = [first.part_name, first.description].filter(Boolean).join(' - ')
    if (STORE_NAMES.test(description)) { vendorText.push(`${g.raw}: ${description}`); continue }
    newParts.push({ maker, number: p.canonical, type: types[0], description })
  }
  if (vendorText.length) throw new Error(`store name in a description - stop:\n${vendorText.join('\n')}`)

  const fitNew = fitRows.filter(f => f.onto === 'new').length
  const fitStore = fitRows.length - fitNew
  const L: string[] = []
  const push = (...s: string[]) => L.push(...s)
  push(
    '-- Import the Grok OEM parts file into the one parts store (148). GENERATED by',
    '-- scripts/build-grok-import-sql.ts on ' + new Date().toISOString().slice(0, 10) + ' from the live tables and',
    `-- ${FILE.replace(/\\/g, '/').split('/').pop()} (${data.length} rows, ${groups.size} part numbers).`,
    '--',
    '-- ENDS IN ROLLBACK. Read the summary table it prints, then change the last line to',
    '-- COMMIT to keep it. Any check that fails raises an error and nothing is applied.',
    '--',
    `-- store before ......................... ${parts.length} parts, ${fit.length} fitment`,
    `-- NEW parts added ...................... ${newParts.length}`,
    `-- DUPLICATES of a store part (not added) ${dupes.length}  (${dupes.filter(d => d.extracted).length} carry fitment the store row lacks)`,
    `-- fitment rows added ................... ${fitRows.length}  (${fitNew} for new parts, ${fitStore} extracted onto store parts)`,
    '-- supersessions added .................. 0',
    '-- cross-references added ............... 0',
    '--',
    `-- Every new row: verified = false, confidence NULL, source '${SOURCE}'.`,
    '-- NOT carried: source_url, notes, part_category, number_type. Store parts are not edited.',
    '--',
    `-- HELD PARTS (not loaded, with their fitment): ${Object.values(held).reduce((s, l) => s + l.length, 0)}`,
    ...held.suffix.map(s => `--   suffix: ${s}`),
    ...held.noRule.map(s => `--   fits no rule: ${s}`),
    ...held.brand.map(s => `--   brand ambiguous: ${s}`),
    ...held.oldNumber.map(s => `--   marked OLD number: ${s}`),
    ...held.selfConflict.map(s => `--   file disagrees with itself: ${s}`),
    `-- HELD FITMENT on loaded parts: ${heldFit.serial} rows with a serial/date break, ${heldFit.group.length} rows with a group model, ${heldSuperseded.length} onto a superseded number`,
    ...heldSuperseded.map(s => `--   onto superseded: ${s}`),
    ...[...new Set(heldFit.group)].map(s => `--   group: ${s}`),
    '--',
    `-- PART TYPE: file disagrees with the store (store type kept, NOT resolved): ${typeConflicts.length}`,
    ...typeConflicts.map(c => `--   ${c}`),
    `-- MANUFACTURER conflicts: ${makerConflicts.length}`,
    ...makerConflicts.map(c => `--   ${c}`),
    '',
    'BEGIN;',
    '',
    'CREATE TEMP TABLE _imp_before ON COMMIT DROP AS',
    'SELECT (SELECT count(*) FROM public.parts) AS parts, (SELECT count(*) FROM public.part_fitment) AS part_fitment,',
    '       (SELECT count(*) FROM public.part_supersession) AS part_supersession, (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference;',
    '',
    'CREATE TEMP TABLE _imp_parts (manufacturer TEXT, part_number TEXT, part_type TEXT, description TEXT) ON COMMIT DROP;',
    'INSERT INTO _imp_parts VALUES',
    newParts.map(p => `  (${lit(p.maker)}, ${lit(p.number)}, ${lit(p.type)}, ${p.description ? lit(p.description) : 'NULL'})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _imp_fitment (manufacturer TEXT, part_number TEXT, unit_model TEXT, engine_model TEXT) ON COMMIT DROP;',
    'INSERT INTO _imp_fitment VALUES',
    fitRows.map(f => `  (${lit(f.maker)}, ${lit(f.number)}, ${lit(f.unit)}, ${lit(f.engine)})`).join(',\n') + ';',
    '',
    '-- Checks BEFORE writing. Any failure stops everything.',
    'DO $$',
    'BEGIN',
    `  IF (SELECT count(*) FROM _imp_parts) <> ${newParts.length} OR (SELECT count(*) FROM _imp_fitment) <> ${fitRows.length} THEN`,
    "    RAISE EXCEPTION 'import: staged row counts are not what the plan says'; END IF;",
    `  IF (SELECT count(*) FROM public.parts) <> ${parts.length} OR (SELECT count(*) FROM public.part_fitment) <> ${fit.length} THEN`,
    "    RAISE EXCEPTION 'import: the store is not the size this file was built against - rebuild it'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _imp_parts f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)) THEN',
    "    RAISE EXCEPTION 'import: a new part is already in the store'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _imp_parts WHERE part_number LIKE '37-%') THEN RAISE EXCEPTION 'import: a 37- number'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _imp_parts WHERE (manufacturer = 'Thermo King' AND part_number !~ '^[0-9]{2}-[0-9]{4}$')",
    "             OR (manufacturer = 'Carrier Transicold' AND part_number !~ '^[0-9]{2}-[0-9]{5}-[0-9]{2}$')) THEN",
    "    RAISE EXCEPTION 'import: a number is missing a zero or does not fit the maker shape'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _imp_fitment WHERE NOT public.is_single_model(unit_model) OR NOT public.is_single_model(engine_model)) THEN',
    "    RAISE EXCEPTION 'import: a fitment model is a group'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _imp_fitment f WHERE NOT EXISTS (SELECT 1 FROM _imp_parts n WHERE n.manufacturer = f.manufacturer AND n.part_number = f.part_number)',
    '             AND NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
    "    RAISE EXCEPTION 'import: a fitment row names no part'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _imp_fitment f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)',
    '             JOIN public.part_fitment x ON x.part_id = p.id',
    '              AND upper(coalesce(x.unit_model, \'\')) = upper(coalesce(f.unit_model, \'\'))',
    '              AND upper(coalesce(x.engine_model, \'\')) = upper(coalesce(f.engine_model, \'\'))) THEN',
    "    RAISE EXCEPTION 'import: a fitment row is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _imp_fitment f JOIN public.part_supersession s',
    '             ON s.manufacturer = f.manufacturer AND s.old_number_normalized = public.normalize_part_number(f.part_number)) THEN',
    "    RAISE EXCEPTION 'import: fitment onto a superseded number'; END IF;",
    'END $$;',
    '',
    'INSERT INTO public.parts (manufacturer, part_number, part_type, description, notes, verified, source, confidence)',
    `SELECT manufacturer, part_number, part_type, description, NULL, FALSE, '${SOURCE}', NULL FROM _imp_parts;`,
    '',
    'INSERT INTO public.part_fitment (part_id, unit_model, engine_model, verified, source, confidence)',
    `SELECT p.id, f.unit_model, f.engine_model, FALSE, '${SOURCE}', NULL`,
    '  FROM _imp_fitment f',
    '  JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
    '',
    '-- Checks AFTER writing: every table moved by exactly the planned amount, nothing else.',
    'DO $$',
    'DECLARE b RECORD;',
    'BEGIN',
    '  SELECT * INTO b FROM _imp_before;',
    `  IF (SELECT count(*) FROM public.parts) - b.parts <> ${newParts.length} THEN RAISE EXCEPTION 'import: parts did not grow by ${newParts.length}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_fitment) - b.part_fitment <> ${fitRows.length} THEN RAISE EXCEPTION 'import: part_fitment did not grow by ${fitRows.length}'; END IF;`,
    "  IF (SELECT count(*) FROM public.part_supersession) <> b.part_supersession THEN RAISE EXCEPTION 'import: part_supersession changed'; END IF;",
    "  IF (SELECT count(*) FROM public.part_cross_reference) <> b.part_cross_reference THEN RAISE EXCEPTION 'import: part_cross_reference changed'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.parts WHERE source = '${SOURCE}' AND (verified OR confidence IS NOT NULL OR notes IS NOT NULL)) THEN RAISE EXCEPTION 'import: a new part is not verified=false / confidence NULL / notes NULL'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE source = '${SOURCE}' AND (verified OR confidence IS NOT NULL OR note IS NOT NULL)) THEN RAISE EXCEPTION 'import: a new fitment row is not verified=false / confidence NULL / note NULL'; END IF;`,
    'END $$;',
    '',
    '-- What it did (this is the table the SQL editor shows).',
    "SELECT 'parts' AS table_name, b.parts AS before, (SELECT count(*) FROM public.parts) AS after, " + newParts.length + ' AS planned FROM _imp_before b',
    "UNION ALL SELECT 'part_fitment', b.part_fitment, (SELECT count(*) FROM public.part_fitment), " + fitRows.length + ' FROM _imp_before b',
    "UNION ALL SELECT 'part_supersession', b.part_supersession, (SELECT count(*) FROM public.part_supersession), 0 FROM _imp_before b",
    "UNION ALL SELECT 'part_cross_reference', b.part_cross_reference, (SELECT count(*) FROM public.part_cross_reference), 0 FROM _imp_before b;",
    '',
    'ROLLBACK;',
    '',
  )
  fs.writeFileSync(OUT, L.join('\n'), { encoding: 'ascii' })

  console.log(`file ${data.length} rows, ${groups.size} numbers; store ${parts.length} parts / ${fit.length} fitment`)
  console.log(`NEW ${newParts.length} (TK ${newParts.filter(p => p.maker === 'Thermo King').length}, Carrier ${newParts.filter(p => p.maker !== 'Thermo King').length}); DUPES ${dupes.length} (${dupes.filter(d => d.extracted).length} carry fitment)`)
  console.log(`fitment ${fitRows.length}: new-part ${fitNew}, extracted ${fitStore}; rows with no model ${noFitmentRows}`)
  console.log(`held parts: ${Object.entries(held).map(([k, l]) => `${k} ${l.length}`).join(', ')}; their fitment rows ${heldFit.heldParts}`)
  console.log(`held fitment on loaded parts: serial ${heldFit.serial}, group ${heldFit.group.length}, onto superseded ${heldSuperseded.length}`)
  console.log(`type conflicts ${typeConflicts.length}; maker conflicts ${makerConflicts.length}`)
  console.log('OLD', held.oldNumber); console.log('SELF', held.selfConflict); console.log('GROUP', [...new Set(heldFit.group)])
  console.log('TYPE CONFLICTS'); for (const c of typeConflicts) console.log('  ' + c)
  console.log('NEW TYPES', JSON.stringify([...newParts.reduce((m, p) => m.set(p.type, (m.get(p.type) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])))
  console.log(`wrote ${OUT}`)
  void partNumberKey
}
main().catch(e => { console.error(e); process.exit(1) })
