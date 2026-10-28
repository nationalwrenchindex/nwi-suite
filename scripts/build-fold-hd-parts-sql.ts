// npx tsx scripts/build-fold-hd-parts-sql.ts
//
// READS the database, WRITES ONE FILE: scripts/fold-hd-parts.sql. Never writes to the
// database. Brock runs the SQL by hand; it ends in ROLLBACK until he changes it.
//
// Folds hd_parts (migration 053, the old /hd/parts lookup) and hd_parts_cross_ref into
// the one parts store (migration 148), as approved Oct 28 from the dry run:
//
//   * every part number goes through src/lib/parts/part-number.ts, so a vendor "37-"
//     is stripped on the way in (37-11-9959 IS 11-9959)
//   * a row whose number is already in the store is MERGED, not added: only the unit
//     models the store row lacks are added as fitment. The store's part type stands.
//   * new parts load verified = false, confidence NULL, source 'nwi-hd-parts-053'
//   * NO notes, NO specs, NO source_url carried - nothing a vendor or store name could
//     ride in on. Descriptions are carried (checked for store names below).
//
// HELD, not loaded (Brock's call): fitment for model strings that are groups
// ("SB-series"), the supersessions 45-2323 -> 45-2324 and 37-11-9098 -> 37-11-9341,
// and the six part-type disagreements (the store's type is never overwritten).
//
// ALSO HELD (found while building this, Oct 28): a new number that differs from a store
// number of the same maker only by a leading zero in a segment (78-0603 vs the store's
// 78-603). Probably one part, but a leading zero is not one of Brock's numbering rules,
// so it is neither merged nor added - adding it would create the duplicate the fold-in
// exists to avoid. The part, its fitment and its crosses wait for his call.

import fs from 'fs'
import { loadEnv } from './lib/smoke-session'
import { parsePartNumber, partNumberKey } from '../src/lib/parts/part-number'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const OUT = 'scripts/fold-hd-parts.sql'
const SOURCE = 'nwi-hd-parts-053'

async function all(t: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${t}?select=*&order=id`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(`${t}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}
const mk = (v: string) => /carrier/i.test(v) ? 'Carrier Transicold' : /thermo|^tk$/i.test(v) ? 'Thermo King' : v
// A number with every segment's leading zeros removed. Used ONLY to hold look-alikes, never to merge.
const zeroless = (canonical: string) => canonical.split('-').map(g => g.replace(/^0+(?=[0-9])/, '')).join('-')
const modelKey = (v: string) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Same rule as public.is_single_model.
function isSingleModel(v: string): boolean {
  if (!v.trim()) return false
  if (v.includes(',') || v.includes('/') || v.includes('+')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v)) return false
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  return true
}

// The category -> part_type mapping proposed in the dry run and approved Oct 28.
function partTypeOf(cat: string, sub: string | null): string {
  const s = sub ?? ''
  switch (cat) {
    case 'belt': return 'Belt'
    case 'filter': return s === 'oil' ? 'Filter - oil (engine)' : s === 'air' ? 'Filter - air' : s === 'fuel' ? 'Filter - fuel' : s === 'compressor' ? 'Filter - oil (compressor)' : `Filter - ${s || 'unknown'}`
    case 'sensor': return `Sensor - ${s || 'unknown'}`
    case 'switch': return `Switch - ${s || 'unknown'}`
    case 'solenoid': return `Solenoid - ${s === 'sv_valve' ? 'SV valve' : s || 'unknown'}`
    case 'starter': return 'Starter'
    case 'alternator': return 'Alternator'
    case 'thermostat': return 'Thermostat'
    case 'water_pump': return 'Water pump'
    case 'egr': return 'EGR'
    case 'gasket': return 'Gasket'
    case 'vibrasorber': return 'Vibrasorber'
    case 'mount': return 'Mount'
    case 'fuel_pump': return 'Fuel pump'
    case 'glow_plug': return 'Glow plug'
    case 'refrigeration': return s === 'txv' ? 'Expansion valve (TXV)' : s === 'drier' ? 'Drier' : s === 'receiver' ? 'Receiver tank' : s === 'condenser' ? 'Condenser' : `Refrigeration - ${s}`
    case 'mechanical': return 'Clutch/coupling'
    default: return cat
  }
}

// Plain 7-bit ASCII only (CLAUDE.md, SQL). Known typography is mapped; anything else stops the build.
const ASCII_MAP: Record<string, string> = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '°': ' deg', '×': 'x', '•': '-', ' ': ' ' }
function ascii(v: string): string {
  const out = v.replace(/[^\x20-\x7E]/g, c => { if (c in ASCII_MAP) return ASCII_MAP[c]; throw new Error(`unmapped non-ASCII ${JSON.stringify(c)} in ${JSON.stringify(v)}`) })
  return out.replace(/\s+/g, ' ').trim()
}
const lit = (v: string | null) => v == null ? 'NULL' : `'${ascii(v).replace(/'/g, "''")}'`
const STORE_NAMES = /napa|o'?reilly|autozone|auto zone|advance auto|rockauto|fleetpride|fleet pride|amazon|ebay|mincarone|walmart|carquest|parts ?authority|tec ?equipment|vendor|https?:|www\./i

// The six part-type disagreements Brock holds (store vs seed). Never overwritten here.
const HELD_TYPE = ['11-9321', '11-9341', '11-9342', '11-9954', '11-6285', '11-7264']
// Supersessions that touch his seed questions. Not loaded.
const HELD_SUPER = [['45-2323', '45-2324'], ['37-11-9098', '37-11-9341']].map(([a, b]) => `${partNumberKey(parsePartNumber(a).canonical)}>${partNumberKey(parsePartNumber(b).canonical)}`)

async function main() {
  const [legacy, xref, parts, fit, sup, cross] = await Promise.all([
    all('hd_parts'), all('hd_parts_cross_ref'), all('parts'), all('part_fitment'), all('part_supersession'), all('part_cross_reference'),
  ])
  const store = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))
  const storeModels = new Map<string, Set<string>>()
  for (const f of fit) for (const v of [f.unit_model, f.engine_model, f.compressor_model]) if (v)
    storeModels.set(f.part_id, (storeModels.get(f.part_id) ?? new Set()).add(modelKey(v)))

  // 1. Through the normalizer; fold any duplicates the normalizer reveals INSIDE hd_parts.
  type Row = { r: Record<string, any>; maker: string; canonical: string; key: string; form: string; models: string[] }
  const byKey = new Map<string, Row>()
  const innerFolds: string[] = []
  for (const r of [...legacy].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))) {
    const p = parsePartNumber(r.part_number)
    const maker = mk(r.manufacturer)
    const k = `${maker}|${p.key}`
    const models = (r.unit_models ?? []).filter((m: string) => m && m.trim())
    const prior = byKey.get(k)
    if (prior) {
      for (const m of models) if (!prior.models.some(x => modelKey(x) === modelKey(m))) prior.models.push(m)
      innerFolds.push(`${r.part_number} folded into ${prior.r.part_number}`)
      continue
    }
    byKey.set(k, { r, maker, canonical: p.canonical, key: p.key, form: p.form, models })
  }

  const storeZeroless = new Map(parts.map(p => [`${p.manufacturer}|${partNumberKey(zeroless(p.part_number))}`, p]))
  const heldZero: Array<{ number: string; store: string; models: number }> = []
  const newParts: Array<Row & { type: string; description: string }> = []
  const merges: Array<{ hd: string; store: string; storeType: string; hdType: string; via37: boolean; extract: string[]; heldType: boolean }> = []
  const newFitment: Array<{ maker: string; number: string; model: string; why: string }> = []
  const groups: Array<{ number: string; models: string[] }> = []
  const noModel: string[] = []
  const vendorish: string[] = []

  for (const row of byKey.values()) {
    const { r, maker } = row
    const loadable = row.models.filter(isSingleModel)
    const unusable = row.models.filter(m => !isSingleModel(m))
    if (unusable.length) groups.push({ number: r.part_number, models: unusable })
    const type = partTypeOf(r.category, r.subcategory)
    const kept = store.get(`${maker}|${row.key}`)
    if (kept) {
      const have = storeModels.get(kept.id) ?? new Set()
      const extract = loadable.filter(m => !have.has(modelKey(m)))
      merges.push({ hd: r.part_number, store: kept.part_number, storeType: kept.part_type, hdType: type, via37: row.form.endsWith('_37'), extract, heldType: HELD_TYPE.includes(kept.part_number) })
      for (const m of extract) newFitment.push({ maker, number: kept.part_number, model: m, why: `merge ${r.part_number}` })
      continue
    }
    const lookAlike = storeZeroless.get(`${maker}|${partNumberKey(zeroless(row.canonical))}`)
    if (lookAlike) { heldZero.push({ number: row.canonical, store: lookAlike.part_number, models: loadable.length }); continue }
    const description = ascii(String(r.description ?? ''))
    if (STORE_NAMES.test(description)) vendorish.push(`${r.part_number}: ${description}`)
    newParts.push({ ...row, type, description })
    if (!loadable.length) noModel.push(row.canonical)
    for (const m of loadable) newFitment.push({ maker, number: row.canonical, model: m, why: 'new' })
  }
  // One fitment row per part per model, ever.
  const fitSeen = new Set<string>()
  for (const f of newFitment) {
    const k = `${f.maker}|${partNumberKey(f.number)}|${modelKey(f.model)}`
    if (fitSeen.has(k)) throw new Error(`duplicate fitment ${k} - fold it before writing SQL`)
    fitSeen.add(k)
  }
  if (vendorish.length) throw new Error(`store/vendor name in a description - stop:\n${vendorish.join('\n')}`)

  // Supersessions: canonical numbers; the two seed-question links held.
  const supers: Array<{ maker: string; old: string; new: string }> = []
  const heldSupers: string[] = []
  for (const row of byKey.values()) {
    if (!row.r.superseded_by) continue
    const to = parsePartNumber(row.r.superseded_by)
    const pair = `${row.key}>${to.key}`
    if (HELD_SUPER.includes(pair)) { heldSupers.push(`${row.r.part_number} -> ${row.r.superseded_by}`); continue }
    if (sup.some(s => s.manufacturer === row.maker && s.old_number_normalized === row.key && s.new_number_normalized === to.key)) continue
    supers.push({ maker: row.maker, old: row.canonical, new: to.canonical })
  }

  // Crosses: onto the part the hd_parts number became (new or merged). Notes not carried.
  const crosses: Array<{ maker: string; number: string; brand: string; brandNumber: string }> = []
  const heldCross: string[] = []
  for (const x of xref) {
    const row = [...byKey.values()].find(v => v.key === parsePartNumber(x.part_number).key)
    if (!row) throw new Error(`cross ${x.part_number} has no hd_parts row`)
    if (STORE_NAMES.test(String(x.cross_mfr))) throw new Error(`cross brand looks like a store: ${x.cross_mfr}`)
    if (heldZero.some(z => partNumberKey(z.number) === row.key)) { heldCross.push(`${x.part_number} ${x.cross_mfr} ${x.cross_part}`); continue }
    const kept = store.get(`${row.maker}|${row.key}`)
    if (kept && cross.some(c => c.part_id === kept.id && c.brand === x.cross_mfr && c.brand_number_normalized === partNumberKey(x.cross_part))) continue
    crosses.push({ maker: row.maker, number: kept ? kept.part_number : row.canonical, brand: x.cross_mfr, brandNumber: x.cross_part })
  }

  const extracted = newFitment.filter(f => f.why !== 'new').length
  const newFit = newFitment.length - extracted
  const L: string[] = []
  const push = (...s: string[]) => L.push(...s)
  push(
    '-- Fold hd_parts (053) into the one parts store (148). GENERATED by',
    '-- scripts/build-fold-hd-parts-sql.ts on ' + new Date().toISOString().slice(0, 10) + ' from the live tables. Approved Oct 28.',
    '--',
    '-- ENDS IN ROLLBACK. Read the summary table it prints, then change the last line to',
    '-- COMMIT to keep it. Any check that fails raises an error and nothing is applied.',
    '--',
    `-- hd_parts rows ......................... ${legacy.length}`,
    `--   folded inside hd_parts by the normalizer ${innerFolds.length}`,
    `--   NEW parts added ...................... ${newParts.length}`,
    `--   MERGED into a store part (not added) . ${merges.length}  (${merges.filter(m => m.via37).length} via a stripped 37-, ${merges.filter(m => !m.via37).length} exact)`,
    `-- fitment rows added .................... ${newFitment.length}  (${newFit} for new parts, ${extracted} extracted onto merged store parts)`,
    `-- supersessions added ................... ${supers.length}  (${heldSupers.length} held)`,
    `-- cross-references added ................ ${crosses.length}`,
    '--',
    '-- Every new row: verified = false, confidence NULL, source ' + `'${SOURCE}'` + '.',
    '-- NOT carried: hd_parts.notes, hd_parts.specs, hd_parts.engine, hd_parts_cross_ref.cross_notes.',
    '-- The store part type is never changed. hd_parts itself is not touched.',
    '--',
    '-- MERGED (hd_parts number = store number; store part type kept):',
    ...merges.map(m => `--   ${m.hd.padEnd(14)} = ${m.store.padEnd(13)} ${m.storeType === m.hdType ? 'same type' : `TYPE KEPT "${m.storeType}" (hd_parts said "${m.hdType}")`}${m.heldType ? '  << one of the six held type items - FLAGGED FOR BROCK' : ''}${m.extract.length ? `  +${m.extract.length} fitment` : ''}`),
    '--',
    '-- HELD, NOT LOADED:',
    ...heldSupers.map(s => `--   supersession ${s}`),
    ...heldZero.map(z => `--   part ${z.number} (and its ${z.models} fitment rows): differs from store part ${z.store} only by a leading zero`),
    ...heldCross.map(c => `--   cross ${c} (its part is held)`),
    ...groups.map(g => `--   group model strings on ${g.number}: ${g.models.map(ascii).join('; ')}`),
    '',
    'BEGIN;',
    '',
    'CREATE TEMP TABLE _fold_before ON COMMIT DROP AS',
    'SELECT (SELECT count(*) FROM public.parts) AS parts, (SELECT count(*) FROM public.part_fitment) AS part_fitment,',
    '       (SELECT count(*) FROM public.part_supersession) AS part_supersession, (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference;',
    '',
    'CREATE TEMP TABLE _fold_parts (manufacturer TEXT, part_number TEXT, part_type TEXT, description TEXT) ON COMMIT DROP;',
    'INSERT INTO _fold_parts VALUES',
    newParts.map(p => `  (${lit(p.maker)}, ${lit(p.canonical)}, ${lit(p.type)}, ${p.description ? lit(p.description) : 'NULL'})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _fold_fitment (manufacturer TEXT, part_number TEXT, unit_model TEXT) ON COMMIT DROP;',
    'INSERT INTO _fold_fitment VALUES',
    newFitment.map(f => `  (${lit(f.maker)}, ${lit(f.number)}, ${lit(f.model)})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _fold_super (manufacturer TEXT, old_number TEXT, new_number TEXT) ON COMMIT DROP;',
    'INSERT INTO _fold_super VALUES',
    supers.map(s => `  (${lit(s.maker)}, ${lit(s.old)}, ${lit(s.new)})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _fold_cross (manufacturer TEXT, part_number TEXT, brand TEXT, brand_number TEXT) ON COMMIT DROP;',
    'INSERT INTO _fold_cross VALUES',
    crosses.map(c => `  (${lit(c.maker)}, ${lit(c.number)}, ${lit(c.brand)}, ${lit(c.brandNumber)})`).join(',\n') + ';',
    '',
    '-- Checks BEFORE writing. Any failure stops everything.',
    'DO $$',
    'BEGIN',
    `  IF (SELECT count(*) FROM _fold_parts) <> ${newParts.length} OR (SELECT count(*) FROM _fold_fitment) <> ${newFitment.length}`,
    `  OR (SELECT count(*) FROM _fold_super) <> ${supers.length} OR (SELECT count(*) FROM _fold_cross) <> ${crosses.length} THEN`,
    "    RAISE EXCEPTION 'fold: staged row counts are not what the plan says';",
    '  END IF;',
    '  IF EXISTS (SELECT 1 FROM _fold_parts f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)) THEN',
    "    RAISE EXCEPTION 'fold: a new part is already in the store - the store changed since this file was built; rebuild it';",
    '  END IF;',
    '  IF EXISTS (SELECT 1 FROM _fold_fitment WHERE NOT public.is_single_model(unit_model)) THEN',
    "    RAISE EXCEPTION 'fold: a fitment model is a group';",
    '  END IF;',
    '  IF EXISTS (SELECT 1 FROM _fold_fitment f WHERE NOT EXISTS (SELECT 1 FROM _fold_parts n WHERE n.manufacturer = f.manufacturer AND n.part_number = f.part_number)',
    '             AND NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
    "    RAISE EXCEPTION 'fold: a fitment row names no part';",
    '  END IF;',
    '  IF EXISTS (SELECT 1 FROM _fold_fitment f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)',
    '             JOIN public.part_fitment x ON x.part_id = p.id AND upper(x.unit_model) = upper(f.unit_model)) THEN',
    "    RAISE EXCEPTION 'fold: a fitment row is already in the store';",
    '  END IF;',
    'END $$;',
    '',
    'INSERT INTO public.parts (manufacturer, part_number, part_type, description, notes, verified, source, confidence)',
    `SELECT manufacturer, part_number, part_type, description, NULL, FALSE, '${SOURCE}', NULL FROM _fold_parts;`,
    '',
    'INSERT INTO public.part_fitment (part_id, unit_model, verified, source, confidence)',
    `SELECT p.id, f.unit_model, FALSE, '${SOURCE}', NULL`,
    '  FROM _fold_fitment f',
    '  JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
    '',
    'INSERT INTO public.part_supersession (manufacturer, old_number, new_number, note, verified, source, confidence)',
    `SELECT manufacturer, old_number, new_number, NULL, FALSE, '${SOURCE}', NULL FROM _fold_super;`,
    '',
    'INSERT INTO public.part_cross_reference (part_id, brand, brand_number, verified, source, confidence)',
    `SELECT p.id, c.brand, c.brand_number, FALSE, '${SOURCE}', NULL`,
    '  FROM _fold_cross c',
    '  JOIN public.parts p ON p.manufacturer = c.manufacturer AND p.part_number_normalized = public.normalize_part_number(c.part_number);',
    '',
    '-- Checks AFTER writing: every table moved by exactly the planned amount, nothing else.',
    'DO $$',
    'DECLARE b RECORD;',
    'BEGIN',
    '  SELECT * INTO b FROM _fold_before;',
    `  IF (SELECT count(*) FROM public.parts) - b.parts <> ${newParts.length} THEN RAISE EXCEPTION 'fold: parts did not grow by ${newParts.length}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_fitment) - b.part_fitment <> ${newFitment.length} THEN RAISE EXCEPTION 'fold: part_fitment did not grow by ${newFitment.length}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_supersession) - b.part_supersession <> ${supers.length} THEN RAISE EXCEPTION 'fold: part_supersession did not grow by ${supers.length}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_cross_reference) - b.part_cross_reference <> ${crosses.length} THEN RAISE EXCEPTION 'fold: part_cross_reference did not grow by ${crosses.length}'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.parts WHERE source = '${SOURCE}' AND (verified OR confidence IS NOT NULL OR notes IS NOT NULL)) THEN RAISE EXCEPTION 'fold: a new part is not verified=false / confidence NULL / notes NULL'; END IF;`,
    `  IF EXISTS (SELECT 1 FROM public.parts WHERE source = '${SOURCE}' AND part_number LIKE '37-%') THEN RAISE EXCEPTION 'fold: a 37- number got in'; END IF;`,
    'END $$;',
    '',
    '-- What it did (this is the table the SQL editor shows).',
    "SELECT 'parts' AS table_name, b.parts AS before, (SELECT count(*) FROM public.parts) AS after, " + newParts.length + ' AS planned FROM _fold_before b',
    "UNION ALL SELECT 'part_fitment', b.part_fitment, (SELECT count(*) FROM public.part_fitment), " + newFitment.length + ' FROM _fold_before b',
    "UNION ALL SELECT 'part_supersession', b.part_supersession, (SELECT count(*) FROM public.part_supersession), " + supers.length + ' FROM _fold_before b',
    "UNION ALL SELECT 'part_cross_reference', b.part_cross_reference, (SELECT count(*) FROM public.part_cross_reference), " + crosses.length + ' FROM _fold_before b;',
    '',
    'ROLLBACK;',
    '',
  )
  fs.writeFileSync(OUT, L.join('\n'), { encoding: 'ascii' })

  console.log(`hd_parts ${legacy.length}; inner folds ${innerFolds.length}${innerFolds.length ? ': ' + innerFolds.join('; ') : ''}`)
  console.log(`new parts ${newParts.length}; merged ${merges.length} (${merges.filter(m => m.via37).length} via 37-, ${merges.filter(m => !m.via37).length} exact; ${merges.filter(m => m.extract.length).length} carry fitment)`)
  console.log(`fitment ${newFitment.length} (${newFit} new-part, ${extracted} extracted); supersessions ${supers.length} (held ${heldSupers.length}); crosses ${crosses.length}`)
  console.log(`new parts with no model ${noModel.length}; group strings ${groups.reduce((s, g) => s + g.models.length, 0)} on ${groups.length} parts`)
  console.log(`stripped 37- on new parts: ${newParts.filter(p => p.form.endsWith('_37')).length}; forms: ${JSON.stringify(newParts.reduce((m: Record<string, number>, p) => (m[p.form] = (m[p.form] ?? 0) + 1, m), {}))}`)
  console.log('MERGES'); for (const m of merges) console.log(`  ${m.hd} = ${m.store}  ${m.storeType === m.hdType ? 'same type' : `store "${m.storeType}" kept, hd_parts "${m.hdType}"`}${m.heldType ? '  FLAG' : ''}  +${m.extract.length}`)
  console.log('HELD LEADING-ZERO', JSON.stringify(heldZero), 'HELD CROSSES', heldCross)
  console.log('HELD SUPERS', heldSupers); console.log('GROUPS', JSON.stringify(groups)); console.log('NO MODEL', noModel.join(' '))
  console.log('NEW 37- / other forms:', newParts.filter(p => p.form !== 'thermo_king' && p.form !== 'carrier').map(p => `${p.r.part_number}->${p.canonical}(${p.form})`).join('  '))
  console.log(`wrote ${OUT}`)
}
main().catch(e => { console.error(e); process.exit(1) })
