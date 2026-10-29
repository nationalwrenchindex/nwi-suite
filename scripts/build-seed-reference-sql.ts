// npx tsx scripts/build-seed-reference-sql.ts
//
// READS the database, the five Oct 23 seed CSVs and hd_parts_reference. WRITES ONE FILE:
// scripts/load-seed-and-reference.sql. Never writes to the database. Brock runs the SQL
// by hand; it ends in ROLLBACK.
//
// SOURCE A - C:\Users\natio\Downloads\seed-{parts,fitment,crosses,supersessions,engines}.csv
//   (Oct 23). Loaded first: engines, then parts, fitment, supersessions, crosses.
// SOURCE B - hd_parts_reference rows whose number is in no parts row (migration 112 and
//   earlier). Loaded second, deduped against the store AND Source A.
//
// RULES (Brock, Oct 28)
//   * every number goes through parsePartNumber before any comparison
//   * a part already in the store (or added by Source A) is not added again; fitment it
//     carries that the kept row lacks is added to the kept row. Store parts are never edited.
//   * no fitment onto a superseded number: one the store already records as old, or one a
//     confirmed / oem_matrix link in this load retires (the links the counter follows)
//   * HELD, not decided: suffixed numbers, reman / 20- / no-rule shapes, group model strings,
//     cross brands that are retailer house brands (NAPA, NAPA Gold, Carquest)
//
// TRUST
//   * Source A carries its own confidence column (written against 175's vocabulary) for
//     fitment, supersessions and crosses; values off that list are held. verified = false.
//   * Source B: verified = false, confidence NULL. hd_parts_reference.verified is the column
//     DEFAULT true (061) and was written true on every row of 112's bulk load, whose
//     categories were derived from the description by pattern - it records no check.
//   * Not carried from either: notes, source_note, seed-parts.engines (prose), the prose in
//     seed-fitment.engine_code on unit_model rows, unit_series / unit_group / engine_family.

import fs from 'fs'
import { loadEnv } from './lib/smoke-session'
import { parsePartNumber } from '../src/lib/parts/part-number'
import { normalizeModel } from '../src/lib/parts/search'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const DL = 'C:/Users/natio/Downloads/'
const OUT = 'scripts/load-seed-and-reference.sql'
const SRC_A = 'nwi-seed-2026-10-23'
const SRC_B = 'nwi-hd-parts-reference-112'
// Fitment rows scripts/delete-grok-serial-split-conflicts.sql removes. Brock runs that first.
const PENDING_DELETE = [
  '4bdee67b-dfe0-436d-8b50-ada68d19c01d', '0430bedf-9c2e-4416-95cf-e67df68bdeda',
  'c7bb15ca-530f-4b98-a93e-f07963fc7d4e', '723de137-4b81-41e4-bea7-3a45826b9045',
]

async function all(t: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${t}?select=*&order=id`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(`${t}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}
async function allBy(t: string, order: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${t}?select=*&order=${order}`, { headers: { ...H, Range: `${f}-${f + 999}` } })
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
function readCsv(name: string): Record<string, string>[] {
  const rows = parseCsv(fs.readFileSync(DL + name, 'utf8').replace(/^\uFEFF/, ''))
  const header = rows.shift()!.map(h => h.trim())
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])))
}
const mk = (v: string) => /carrier/i.test(v) ? 'Carrier Transicold' : /thermo|^tk$/i.test(v) ? 'Thermo King' : v
const shapeMaker = (p: ReturnType<typeof parsePartNumber>) =>
  p.form === 'thermo_king' ? 'Thermo King' : p.form === 'carrier' ? 'Carrier Transicold' : null

// Same rule as public.is_single_model.
function isSingleModel(v: string): boolean {
  if (!v.trim()) return false
  if (v.includes(',') || v.includes('/') || v.includes('+')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v)) return false
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  return true
}

const TIERS = new Set(['confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'])
const FOLLOWED = new Set(['confirmed', 'oem_matrix'])
// Retailer house brands: never loaded without Brock's answer.
const RETAIL_BRANDS = /^(napa|napa gold|carquest)$/i
const STORE_NAMES = /napa|o'?reilly|autozone|auto zone|advance auto|rockauto|fleetpride|fleet pride|amazon|ebay|mincarone|walmart|carquest|parts ?authority|can\.ca|www\.|https?:/i
// hd_parts_reference cross columns that are part manufacturers. napa_gold is NOT here.
const REF_CROSS: Array<[string, string]> = [
  ['baldwin', 'Baldwin'], ['donaldson', 'Donaldson'], ['fleetguard', 'Fleetguard'], ['wix', 'WIX'],
  ['dayco', 'Dayco'], ['gates', 'Gates'], ['continental', 'Continental'], ['luber_finer', 'Luber-finer'],
]

const lit = (v: string | null | undefined) => {
  if (v == null || v === '') return 'NULL'
  if (/[^\x20-\x7E]/.test(v)) throw new Error(`non-ASCII in ${JSON.stringify(v)}`)
  return `'${v.replace(/'/g, "''")}'`
}

type NewPart = { src: string; maker: string; number: string; type: string; description: string | null; equipment: string | null }
type Fit = { src: string; maker: string; number: string; unit: string | null; engineModel: string | null; engineCode: string | null
  match: 'unit_model' | 'engine'; serialFrom: string | null; serialBefore: string | null; tier: string | null; conf: string | null; onto: 'new' | 'store' }
type Sup = { maker: string; old: string; neu: string; conf: string }
type Cross = { src: string; maker: string; number: string; brand: string; brandNumber: string; conf: string | null }

async function main() {
  const [parts, fitLive, sup, xr, engines, ref] = await Promise.all([
    all('parts'), all('part_fitment'), all('part_supersession'), all('part_cross_reference'),
    allBy('engines', 'engine_code'), all('hd_parts_reference'),
  ])
  // Built against the store AFTER scripts/delete-grok-serial-split-conflicts.sql.
  const fit = fitLive.filter(f => !PENDING_DELETE.includes(f.id))
  if (fitLive.length - fit.length !== PENDING_DELETE.length) throw new Error('the 4 pending deletes are not all in the store - rebuild against the live store')
  const sp = readCsv('seed-parts.csv'), sf = readCsv('seed-fitment.csv'), sc = readCsv('seed-crosses.csv')
  const ss = readCsv('seed-supersessions.csv'), se = readCsv('seed-engines.csv')

  // ── the store, keyed the way every comparison is made ───────────────────────
  const store = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))
  const storeFit = new Map<string, Array<{ u: string; e: string; c: string }>>()
  for (const f of fit) storeFit.set(f.part_id, [...(storeFit.get(f.part_id) ?? []),
    { u: normalizeModel(f.unit_model ?? ''), e: normalizeModel(f.engine_model ?? ''), c: normalizeModel(f.engine_code ?? '') }])
  const storeCross = new Set(xr.map(x => `${x.part_id}|${String(x.brand).toUpperCase()}|${normalizeModel(x.brand_number)}`))
  const storeSup = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}|${s.new_number_normalized}`))
  const retiredByStore = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}`))
  const engineCodes = new Set(engines.map(e => String(e.engine_code)))

  const held: Record<string, string[]> = {}
  const hold = (bucket: string, why: string) => { (held[bucket] ??= []).push(why) }

  // ═══ SOURCE A ════════════════════════════════════════════════════════════════
  // engines
  const newEngines = se.filter(e => !engineCodes.has(e.engine_code))
  for (const e of newEngines) {
    if (!TIERS.has(e.confidence)) throw new Error(`engine ${e.engine_code}: confidence ${e.confidence}`)
    if (STORE_NAMES.test(Object.values(e).join(' '))) throw new Error(`store name in engine ${e.engine_code}`)
  }
  const allEngines = new Set([...engineCodes, ...se.map(e => e.engine_code)])

  // supersessions first (in memory) - they decide which numbers are retired
  const newSups: Sup[] = []
  const seedStatus = new Map(sp.map(r => [`${mk(r.maker)}|${parsePartNumber(r.part_number).key}`, r.status]))
  // Brock held these on Oct 28 (fold-in), not to be loaded without his answer.
  const BROCK_HELD = new Set(['Thermo King|452323|452324', 'Thermo King|119098|119341'])
  for (const r of ss) {
    const maker = mk(r.maker); const o = parsePartNumber(r.old_part), n = parsePartNumber(r.new_part)
    const label = `${r.old_part} -> ${r.new_part} [${r.confidence}]`
    if (o.suffix || n.suffix) { hold('supersession: suffixed number', label); continue }
    if (shapeMaker(o) !== maker || shapeMaker(n) !== maker) { hold('supersession: fits no rule / brand', label); continue }
    if (BROCK_HELD.has(`${maker}|${o.key}|${n.key}`)) { hold('supersession: held by Brock Oct 28', label); continue }
    if (!TIERS.has(r.confidence)) { hold('supersession: confidence off the 175 list', label); continue }
    if (storeSup.has(`${maker}|${o.key}|${n.key}`)) { hold('supersession: already in the store', label); continue }
    if (FOLLOWED.has(r.confidence) && seedStatus.get(`${maker}|${o.key}`) === 'current') {
      hold('supersession: confirmed link but the seed lists the old number as current', label); continue
    }
    if (newSups.some(s => s.maker === maker && s.old === o.canonical && s.neu === n.canonical)) continue
    newSups.push({ maker, old: o.canonical, neu: n.canonical, conf: r.confidence })
  }
  const retired = new Set([...retiredByStore,
    ...newSups.filter(s => FOLLOWED.has(s.conf)).map(s => `${s.maker}|${parsePartNumber(s.old).key}`)])
  const loadedSupOld = new Set(newSups.map(s => `${s.maker}|${parsePartNumber(s.old).key}`))

  // parts
  const newParts: NewPart[] = []
  const added = new Map<string, NewPart>()          // maker|key -> new part (both sources)
  const dupesA: string[] = []; const typeConflicts: string[] = []
  const heldPartKeys = new Set<string>()
  for (const r of sp) {
    const maker = mk(r.maker); const p = parsePartNumber(r.part_number); const k = `${maker}|${p.key}`
    if (p.suffix) { hold('A part: suffixed', r.part_number); heldPartKeys.add(k); continue }
    if (shapeMaker(p) !== maker) { hold('A part: fits no rule / brand', `${r.part_number} (${p.form})`); heldPartKeys.add(k); continue }
    const kept = store.get(k)
    if (kept) {
      dupesA.push(kept.part_number)
      if (r.part_type && r.part_type !== kept.part_type) typeConflicts.push(`${kept.part_number.padEnd(12)} store "${kept.part_type}"  seed "${r.part_type}"`)
      continue
    }
    if (added.has(k)) continue
    // A superseded number loads only if the link that says so loads too; otherwise it
    // would sit on the counter looking current.
    if (r.status === 'superseded' && !loadedSupOld.has(k)) {
      hold('A part: superseded, and its supersession is held', `${p.canonical} -> ${r.superseded_by}`); heldPartKeys.add(k); continue
    }
    if (r.description && STORE_NAMES.test(r.description)) throw new Error(`store name in description of ${r.part_number}`)
    const np: NewPart = { src: SRC_A, maker, number: p.canonical, type: r.part_type, description: r.description || null, equipment: r.equipment_type || null }
    newParts.push(np); added.set(k, np)
  }

  // fitment
  const fits: Fit[] = []
  const fitSeen = new Set<string>()
  const heldFitCount: Record<string, number> = {}
  const holdFit = (bucket: string, why?: string) => { heldFitCount[bucket] = (heldFitCount[bucket] ?? 0) + 1; if (why) hold(`A fitment: ${bucket}`, why) }
  const resolvePart = (maker: string, raw: string) => {
    const p = parsePartNumber(raw); const k = `${maker}|${p.key}`
    const kept = store.get(k); const nw = added.get(k)
    return { p, k, kept, nw }
  }
  const already = (partId: string | undefined, u: string, e: string, c: string) => {
    if (!partId) return false
    const have = storeFit.get(partId) ?? []
    return u ? have.some(h => h.u === u) : have.some(h => (c && (h.c === c || h.e === c)) || (e && (h.e === e || h.c === e)))
  }
  for (const r of sf) {
    const maker = mk(r.maker); const { p, k, kept, nw } = resolvePart(maker, r.part_number)
    if (heldPartKeys.has(k) || (!kept && !nw)) { holdFit(kept || nw ? 'part held' : 'names a part that is not loaded'); continue }
    if (!TIERS.has(r.confidence)) { holdFit('confidence off the 175 list', `${p.canonical} ${r.unit_model || r.engine_code} [${r.confidence}]`); continue }
    if (retired.has(k)) { holdFit('onto a superseded number', `${p.canonical}: ${r.unit_model || r.engine_code}`); continue }
    // The note (not loaded) qualifies the claim. Loading the row without it would say the
    // part fits every unit of the model - the same reason the Grok import held these.
    const note = r.source_note
    const what = `${p.canonical}: ${r.unit_model || r.engine_code} - "${note.slice(0, 80)}"`
    if (/\b(SN|S\/N|serial)\b|\b(before|after|until|up to|from Q|early|later)\b|\bQ[1-4]\s*[0-9]{4}\b|\b[0-9]{1,2}\/[0-9]{2,4}\b|[0-9]{2}\.[0-9]{2}\s*on\b/i.test(note)) {
      holdFit('note carries a serial or date break', what); continue
    }
    if (/superseded by|replaced by/i.test(note)) { holdFit('note says the part is superseded', what); continue }
    if (/CONFLICT/.test(note)) { holdFit('note records a conflict', what); continue }
    if (/\bonly with\b|\boption(al)?\b/i.test(note)) { holdFit('conditional (only with an option)', what); continue }
    let f: Fit
    if (r.match_type === 'engine') {
      if (!allEngines.has(r.engine_code)) { holdFit('engine code not in engines', `${p.canonical}: ${r.engine_code}`); continue }
      f = { src: SRC_A, maker, number: kept ? kept.part_number : p.canonical, unit: null, engineModel: null, engineCode: r.engine_code,
        match: 'engine', serialFrom: r.serial_from || null, serialBefore: r.serial_before || null, tier: r.tier || null, conf: r.confidence, onto: kept ? 'store' : 'new' }
    } else if (r.match_type === 'unit_model') {
      if (!r.unit_model) { holdFit('no unit model (only a group / series)', `${p.canonical}: ${r.unit_group || r.unit_series}`); continue }
      if (!isSingleModel(r.unit_model)) { holdFit('group model string', `${p.canonical}: ${r.unit_model}`); continue }
      // Passes the CHECK but is not a model name a tech would search: a bare Supra number
      // with its family dropped ("322"), prose ("550 (Carrier matrix); 560", "SB-100 to
      // SB-400", "Tier 2 or earlier", "standard TriPac auxiliary power units").
      if (/^[0-9]+$/.test(r.unit_model) || /[();]/.test(r.unit_model) || /(^|\s)(to|with|or|up|earlier|units)(\s|$)/i.test(r.unit_model) || /^tier\b/i.test(r.unit_model)) {
        holdFit('not a clean model name', `${p.canonical}: ${r.unit_model}`); continue
      }
      f = { src: SRC_A, maker, number: kept ? kept.part_number : p.canonical, unit: r.unit_model, engineModel: null, engineCode: null,
        match: 'unit_model', serialFrom: r.serial_from || null, serialBefore: r.serial_before || null, tier: r.tier || null, conf: r.confidence, onto: kept ? 'store' : 'new' }
    } else { holdFit('unknown match_type', `${p.canonical}: ${r.match_type}`); continue }
    const key = `${k}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? '')}|${f.serialFrom ?? ''}|${f.serialBefore ?? ''}`
    if (fitSeen.has(key)) { holdFit('repeated in the file'); continue }
    fitSeen.add(key)
    if (already(kept?.id, normalizeModel(f.unit ?? ''), '', normalizeModel(f.engineCode ?? ''))) { holdFit('already in the store'); continue }
    fits.push(f)
  }

  // The same part and model both with and without a serial break: the file disagrees with
  // itself about which units it fits. Neither row loads.
  const bare = (f: Fit) => `${f.maker}|${parsePartNumber(f.number).key}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? '')}`
  const splitKeys = new Set(fits.filter(f => f.serialFrom || f.serialBefore).map(bare))
  const plainKeys = new Set(fits.filter(f => !f.serialFrom && !f.serialBefore).map(bare))
  for (let i = fits.length - 1; i >= 0; i--) {
    const b = bare(fits[i])
    if (splitKeys.has(b) && plainKeys.has(b)) { holdFit('with and without a serial break in the same file', `${fits[i].number}: ${fits[i].unit ?? fits[i].engineCode} ${fits[i].serialFrom ?? ''}${fits[i].serialBefore ?? ''}`); fits.splice(i, 1) }
  }

  // crosses
  const crosses: Cross[] = []
  const crossSeen = new Set<string>()
  const heldCross: Record<string, number> = {}
  for (const r of sc) {
    const maker = mk(r.maker); const { p, k, kept, nw } = resolvePart(maker, r.part_number)
    const label = `${p.canonical} ${r.cross_mfr} ${r.cross_part} [${r.confidence}]`
    if (RETAIL_BRANDS.test(r.cross_mfr)) { heldCross[`${r.cross_mfr} (retailer house brand)`] = (heldCross[`${r.cross_mfr} (retailer house brand)`] ?? 0) + 1; continue }
    if (heldPartKeys.has(k) || (!kept && !nw)) { hold('A cross: part not loaded', label); continue }
    if (!TIERS.has(r.confidence)) { hold('A cross: confidence off the 175 list', label); continue }
    // The file split some qualified notes across rows: "51334 (derived from NAPA 1334" /
    // "unconfirmed)" - and tagged the fragments with tiers the note contradicts. Only a
    // row whose number is one clean token and whose note says exactly that number loads.
    if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(r.cross_part) || !/[0-9]/.test(r.cross_part) || r.source_note.trim() !== r.cross_part) {
      hold('A cross: qualified or damaged row (note split across rows, tier unreliable)', `${p.canonical} ${r.cross_mfr} "${r.cross_part}"`); continue
    }
    if (STORE_NAMES.test(r.cross_mfr) || STORE_NAMES.test(r.cross_part)) throw new Error(`store name in cross ${label}`)
    const key = `${k}|${r.cross_mfr.toUpperCase()}|${normalizeModel(r.cross_part)}`
    if (crossSeen.has(key)) continue
    crossSeen.add(key)
    if (kept && storeCross.has(`${kept.id}|${r.cross_mfr.toUpperCase()}|${normalizeModel(r.cross_part)}`)) { hold('A cross: already in the store', label); continue }
    crosses.push({ src: SRC_A, maker, number: kept ? kept.part_number : p.canonical, brand: r.cross_mfr, brandNumber: r.cross_part, conf: r.confidence })
  }
  const aParts = newParts.length, aCross = crosses.length

  // ═══ SOURCE B ════════════════════════════════════════════════════════════════
  // Only numbers that are in no parts row today (the inventory's 326).
  const storeKeysAnyMaker = new Set(parts.map(p => p.part_number_normalized))
  const refRows = ref.filter(r => r.oem_part_number && !storeKeysAnyMaker.has(parsePartNumber(r.oem_part_number).key))
  // Known models to tell a model from a family: every unit_model in the store and Source A.
  const knownUnits = new Set([...fit.map(f => f.unit_model), ...sf.map(r => r.unit_model)].filter(Boolean).map(v => normalizeModel(v)))
  const knownUnitsRaw = [...new Set([...fit.map(f => f.unit_model), ...sf.map(r => r.unit_model)].filter(Boolean).map((v: string) => v.toUpperCase().trim()))]
  const knownEngines = new Set([...fit.map(f => f.engine_model), ...fit.map(f => f.engine_code), ...allEngines].filter(Boolean).map(v => normalizeModel(v)))
  // A family name: another known model is this value plus a space and more ("Supra" -> "Supra 660").
  // Equipment words that sit in some unit_model fields but name no model.
  const GENERIC = new Set(['GENSET', 'GENSETS', 'TRUCKUNITS', 'TRAILERUNITS', 'TRUCK', 'TRAILER', 'APU'])
  const isFamily = (v: string) => GENERIC.has(normalizeModel(v)) || knownUnitsRaw.some(m => m.startsWith(v.toUpperCase().trim() + ' '))
  const bFamily: Record<string, number> = {}
  const bCount = { parts: 0, modelFit: 0, engineFit: 0, noFit: 0, partsWithModelFit: 0, partsWithEngineOnly: 0, dupOfA: 0 }
  const bDupOfA: string[] = []
  const heldNapa: string[] = []
  const multiCross: string[] = []
  const bTypes = new Map<string, number>()
  for (const r of refRows) {
    const maker = r.manufacturer === 'TK' ? 'Thermo King' : r.manufacturer === 'Carrier' ? 'Carrier Transicold' : r.manufacturer
    const p = parsePartNumber(r.oem_part_number); const k = `${maker}|${p.key}`
    const why = `${r.oem_part_number} (${r.part_function})`
    if (p.suffix) { hold(`B part: suffixed (${p.form === 'carrier' || p.form === 'thermo_king' ? p.suffix : 'suffix + no rule'})`, why); continue }
    if (p.form === 'thermo_king_reman' || p.form === 'carrier_reman') { hold('B part: reman form (Brock decides)', why); continue }
    if (p.form === 'carrier_for_thermo_king') { hold('B part: 20- Carrier-for-TK form (Brock decides)', why); continue }
    if (shapeMaker(p) !== maker) { hold('B part: fits no rule / brand', `${why} [${p.form}]`); continue }
    if (store.has(k)) continue                    // cannot happen - filtered above - kept as a guard
    const nwA = added.get(k)
    // Fitment from unit_family.
    const fam = String(r.unit_family ?? '').trim()
    let f: Fit | null = null
    if (!fam) { /* none */ }
    else if (!isSingleModel(fam)) { bFamily[`list/group: ${fam}`] = (bFamily[`list/group: ${fam}`] ?? 0) + 1 }
    else if (knownUnits.has(normalizeModel(fam)) && !isFamily(fam) && !knownEngines.has(normalizeModel(fam))) {
      f = { src: SRC_B, maker, number: p.canonical, unit: fam, engineModel: null, engineCode: null, match: 'unit_model', serialFrom: null, serialBefore: null, tier: null, conf: null, onto: nwA ? 'store' : 'new' }
    } else if (knownEngines.has(normalizeModel(fam))) {
      f = { src: SRC_B, maker, number: p.canonical, unit: null, engineModel: fam, engineCode: null, match: 'engine', serialFrom: null, serialBefore: null, tier: null, conf: null, onto: nwA ? 'store' : 'new' }
    } else { bFamily[`family / not a known model: ${fam}`] = (bFamily[`family / not a known model: ${fam}`] ?? 0) + 1 }
    if (f && retired.has(k)) { hold('B fitment: onto a superseded number', `${p.canonical}: ${fam}`); f = null }
    if (nwA) {
      // Source A already adds this part: keep A's row, carry B's fitment if A lacks it.
      bDupOfA.push(p.canonical); bCount.dupOfA++
      if (f && !fits.some(x => x.maker === maker && parsePartNumber(x.number).key === p.key
        && normalizeModel(x.unit ?? x.engineModel ?? x.engineCode ?? '') === normalizeModel(f!.unit ?? f!.engineModel ?? ''))) fits.push(f)
    } else {
      // SQL is plain ASCII: the two non-ASCII characters in hd_parts_reference are spelled out.
      const fn = String(r.part_function ?? '').trim().replace(/°/g, ' deg ').replace(/[–—]/g, '-').replace(/ {2,}/g, ' ')
      const type = r.part_category && r.part_category !== 'Other' ? r.part_category : fn
      const desc = fn || null
      if (desc && STORE_NAMES.test(desc)) throw new Error(`store name in hd_parts_reference description ${why}`)
      if (!type) { hold('B part: no type', why); continue }
      const np: NewPart = { src: SRC_B, maker, number: p.canonical, type, description: desc, equipment: null }
      newParts.push(np); added.set(k, np); bCount.parts++
      bTypes.set(type, (bTypes.get(type) ?? 0) + 1)
      if (f) fits.push(f)
    }
    if (f && f.match === 'unit_model') { bCount.modelFit++; bCount.partsWithModelFit++ }
    else if (f) { bCount.engineFit++; bCount.partsWithEngineOnly++ }
    else bCount.noFit++
    // Crosses: manufacturers only. napa_gold is held for Brock.
    if (r.napa_gold) heldNapa.push(`${p.canonical} NAPA Gold ${r.napa_gold}`)
    for (const [col, brand] of REF_CROSS) {
      const v = String(r[col] ?? '').trim(); if (!v) continue
      if (/[,/;]/.test(v) || /\s(or|and)\s/i.test(v)) { multiCross.push(`${p.canonical} ${brand} "${v}"`); continue }
      if (STORE_NAMES.test(v)) throw new Error(`store name in cross ${p.canonical} ${brand} ${v}`)
      const key = `${k}|${brand.toUpperCase()}|${normalizeModel(v)}`
      if (crossSeen.has(key)) continue
      crossSeen.add(key)
      crosses.push({ src: SRC_B, maker, number: p.canonical, brand, brandNumber: v, conf: null })
    }
  }
  if (multiCross.length) for (const m of multiCross) hold('B cross: cell holds more than one number', m)
  const bCross = crosses.length - aCross

  // ── serial splits: a model + part type the store splits by serial across parts ──
  // An unconditional row on a third part beside the split says it fits every unit, so a
  // model search returns too many and a serial cannot narrow it (the Grok import did this
  // to the Ultra air filters). The reverse - a new split row beside unconditional rows on
  // other parts - is the same contradiction. Both are held.
  const partById0 = new Map(parts.map(p => [p.id, p]))
  const typeOfFit = (f: Fit) => added.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.type
    ?? store.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.part_type
  const splitBy = new Map<string, Set<string>>(), plainBy = new Map<string, Set<string>>()
  for (const f of fit) {
    const p = partById0.get(f.part_id); if (!p || !f.unit_model) continue
    const k = `${p.manufacturer}|${normalizeModel(f.unit_model)}|${p.part_type}`
    const m = f.serial_from || f.serial_before ? splitBy : plainBy
    m.set(k, (m.get(k) ?? new Set()).add(p.part_number_normalized))
  }
  for (let i = fits.length - 1; i >= 0; i--) {
    const f = fits[i]; if (!f.unit) continue
    const k = `${f.maker}|${normalizeModel(f.unit)}|${typeOfFit(f)}`; const own = parsePartNumber(f.number).key
    const isSplit = !!(f.serialFrom || f.serialBefore)
    const others = [...((isSplit ? plainBy : splitBy).get(k) ?? [])].filter(x => x !== own)
    if (others.length) {
      hold(`${f.src === SRC_A ? 'A' : 'B'} fitment: beside a serial split on another part`, `${f.number}: ${f.unit} (${typeOfFit(f)})`)
      if (f.src === SRC_A) heldFitCount['beside a serial split on another part'] = (heldFitCount['beside a serial split on another part'] ?? 0) + 1
      fits.splice(i, 1)
    }
  }

  const aFitRows = fits.filter(f => f.src === SRC_A), bFitRows = fits.filter(f => f.src === SRC_B)
  const aFits = aFitRows.length, bFits = bFitRows.length
  const aOntoStore = aFitRows.filter(f => f.onto === 'store').length
  const bModel = bFitRows.filter(f => f.match === 'unit_model').length, bEngine = bFitRows.filter(f => f.match === 'engine').length

  // ── projected answer for the smoke check "Supra 660 returns exactly 3 filters" ──
  const supra = new Set<string>()
  const partById = new Map(parts.map(p => [p.id, p]))
  for (const f of fit) { const p = partById.get(f.part_id); if (p && p.manufacturer === 'Carrier Transicold' && /filter/i.test(p.part_type) && normalizeModel(f.unit_model ?? '') === 'SUPRA660') supra.add(p.part_number) }
  const supraAdded: string[] = []
  for (const f of fits) {
    if (f.maker !== 'Carrier Transicold' || normalizeModel(f.unit ?? '') !== 'SUPRA660') continue
    const t = (added.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.type) ?? store.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.part_type
    if (t && /filter/i.test(t)) supraAdded.push(f.number)
  }

  // ── existing store fitment that a new FOLLOWED supersession would sit on ──────
  const newlyRetiredWithFit: string[] = []
  for (const s of newSups.filter(x => FOLLOWED.has(x.conf))) {
    const kept = store.get(`${s.maker}|${parsePartNumber(s.old).key}`)
    if (kept && (storeFit.get(kept.id) ?? []).length) newlyRetiredWithFit.push(`${kept.part_number} (${(storeFit.get(kept.id) ?? []).length} fitment rows) -> ${s.neu} [${s.conf}]`)
  }

  // ═══ SQL ═════════════════════════════════════════════════════════════════════
  const nEng = newEngines.length, nParts = newParts.length, nFit = fits.length, nSup = newSups.length, nCross = crosses.length
  const L: string[] = []
  const push = (...s: string[]) => L.push(...s)
  const heldLines = Object.entries(held).flatMap(([b, l]) => [`--   ${b}: ${l.length}`, ...l.map(x => `--       ${x}`)])
  push(
    '-- Load the two parts sources that never reached the store. GENERATED by',
    '-- scripts/build-seed-reference-sql.ts on ' + new Date().toISOString().slice(0, 10) + ' from the live tables, the five Oct 23',
    '-- seed CSVs, and hd_parts_reference.',
    '--',
    '-- ENDS IN ROLLBACK. Read the summary table it prints, then change the last line to',
    '-- COMMIT to keep it. Any check that fails raises an error and nothing is applied.',
    '--',
    `-- store before: ${parts.length} parts, ${fit.length} fitment, ${sup.length} supersessions, ${xr.length} crosses, ${engines.length} engines`,
    '--',
    `-- SOURCE A (seed CSVs, source '${SRC_A}')`,
    `--   engines added ........... ${nEng}`,
    `--   parts added ............. ${aParts}   (${dupesA.length} already in the store, not added)`,
    `--   fitment added ........... ${aFits}   (${aOntoStore} onto store parts)`,
    `--   supersessions added ..... ${nSup}`,
    `--   crosses added ........... ${aCross}`,
    `--   trust: verified = false; confidence = the file's own tier (all on 175's list).`,
    '--',
    `-- SOURCE B (hd_parts_reference, source '${SRC_B}')`,
    `--   numbers in no parts row . ${refRows.length}`,
    `--   parts added ............. ${bCount.parts}   (${bCount.dupOfA} already added by Source A - fitment carried onto it)`,
    `--   fitment added ........... ${bFits}   (${bModel} name one unit model, ${bEngine} name one engine)`,
    `--   crosses added ........... ${bCross}   (manufacturers only; NAPA Gold held)`,
    '--   trust: verified = false, confidence NULL. hd_parts_reference.verified is a column',
    '--   default (true) set on every row of a bulk load; it records no check.',
    '--',
    '-- NOT carried: notes, source_note, seed-parts.engines, engine prose, unit_series,',
    '-- unit_group, engine_family, unit_family strings that are not one known model.',
    '-- Store parts are never edited.',
    '--',
    `-- HELD (not loaded):`,
    ...heldLines,
    `--   A fitment rows held by reason: ${Object.entries(heldFitCount).map(([k, v]) => `${k} ${v}`).join('; ')}`,
    `--   A crosses held: ${Object.entries(heldCross).map(([k, v]) => `${k} ${v}`).join('; ')}`,
    `--   B NAPA Gold crosses held for Brock: ${heldNapa.length}`,
    ...heldNapa.map(x => `--       ${x}`),
    `--   B fitment not loaded (family or list, cannot answer a model search): ${Object.values(bFamily).reduce((s, n) => s + n, 0)}`,
    ...Object.entries(bFamily).sort((a, b) => b[1] - a[1]).map(([k, v]) => `--       ${v}  ${k}`),
    '--',
    `-- PART TYPE: seed disagrees with the store (store type kept, NOT resolved): ${typeConflicts.length}`,
    ...typeConflicts.map(c => `--   ${c}`),
    `-- Existing store fitment that a new confirmed link will sit on (NOT changed): ${newlyRetiredWithFit.length}`,
    ...newlyRetiredWithFit.map(c => `--   ${c}`),
    '',
    'BEGIN;',
    '',
    'CREATE TEMP TABLE _ld_before ON COMMIT DROP AS',
    'SELECT (SELECT count(*) FROM public.parts) AS parts, (SELECT count(*) FROM public.part_fitment) AS part_fitment,',
    '       (SELECT count(*) FROM public.part_supersession) AS part_supersession, (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference,',
    '       (SELECT count(*) FROM public.engines) AS engines;',
    '',
    'CREATE TEMP TABLE _ld_engines (engine_code TEXT, engine_maker TEXT, base_engine TEXT, tier TEXT, confidence TEXT) ON COMMIT DROP;',
    ...(nEng ? ['INSERT INTO _ld_engines VALUES',
      newEngines.map(e => `  (${lit(e.engine_code)}, ${lit(e.engine_maker)}, ${lit(e.base_engine)}, ${lit(e.tier)}, ${lit(e.confidence)})`).join(',\n') + ';'] : []),
    '',
    'CREATE TEMP TABLE _ld_parts (src TEXT, manufacturer TEXT, part_number TEXT, part_type TEXT, description TEXT, equipment_type TEXT) ON COMMIT DROP;',
    'INSERT INTO _ld_parts VALUES',
    newParts.map(p => `  (${lit(p.src)}, ${lit(p.maker)}, ${lit(p.number)}, ${lit(p.type)}, ${lit(p.description)}, ${lit(p.equipment)})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _ld_fitment (src TEXT, manufacturer TEXT, part_number TEXT, unit_model TEXT, engine_model TEXT, engine_code TEXT,',
    '  match_type TEXT, serial_from TEXT, serial_before TEXT, tier TEXT, confidence TEXT) ON COMMIT DROP;',
    'INSERT INTO _ld_fitment VALUES',
    fits.map(f => `  (${lit(f.src)}, ${lit(f.maker)}, ${lit(f.number)}, ${lit(f.unit)}, ${lit(f.engineModel)}, ${lit(f.engineCode)}, ${lit(f.match)}, ${lit(f.serialFrom)}, ${lit(f.serialBefore)}, ${lit(f.tier)}, ${lit(f.conf)})`).join(',\n') + ';',
    '',
    'CREATE TEMP TABLE _ld_sup (manufacturer TEXT, old_number TEXT, new_number TEXT, confidence TEXT) ON COMMIT DROP;',
    ...(nSup ? ['INSERT INTO _ld_sup VALUES',
      newSups.map(s => `  (${lit(s.maker)}, ${lit(s.old)}, ${lit(s.neu)}, ${lit(s.conf)})`).join(',\n') + ';'] : []),
    '',
    'CREATE TEMP TABLE _ld_cross (src TEXT, manufacturer TEXT, part_number TEXT, brand TEXT, brand_number TEXT, confidence TEXT) ON COMMIT DROP;',
    'INSERT INTO _ld_cross VALUES',
    crosses.map(c => `  (${lit(c.src)}, ${lit(c.maker)}, ${lit(c.number)}, ${lit(c.brand)}, ${lit(c.brandNumber)}, ${lit(c.conf)})`).join(',\n') + ';',
    '',
    '-- Checks BEFORE writing. Any failure stops everything.',
    'DO $$',
    'BEGIN',
    `  IF (SELECT count(*) FROM _ld_engines) <> ${nEng} OR (SELECT count(*) FROM _ld_parts) <> ${nParts} OR (SELECT count(*) FROM _ld_fitment) <> ${nFit}`,
    `     OR (SELECT count(*) FROM _ld_sup) <> ${nSup} OR (SELECT count(*) FROM _ld_cross) <> ${nCross} THEN`,
    "    RAISE EXCEPTION 'load: staged row counts are not what the plan says'; END IF;",
    `  IF (SELECT count(*) FROM public.parts) <> ${parts.length} OR (SELECT count(*) FROM public.part_fitment) <> ${fit.length}`,
    `     OR (SELECT count(*) FROM public.part_supersession) <> ${sup.length} OR (SELECT count(*) FROM public.part_cross_reference) <> ${xr.length}`,
    `     OR (SELECT count(*) FROM public.engines) <> ${engines.length} THEN`,
    "    RAISE EXCEPTION 'load: the store is not the size this file was built against - rebuild it'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE id IN (${PENDING_DELETE.map(id => `'${id}'`).join(', ')})) THEN`,
    "    RAISE EXCEPTION 'load: run scripts/delete-grok-serial-split-conflicts.sql first'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_engines e JOIN public.engines x ON x.engine_code = e.engine_code) THEN',
    "    RAISE EXCEPTION 'load: an engine is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_parts f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)) THEN',
    "    RAISE EXCEPTION 'load: a new part is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_parts GROUP BY manufacturer, public.normalize_part_number(part_number) HAVING count(*) > 1) THEN',
    "    RAISE EXCEPTION 'load: a new part is staged twice'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE part_number LIKE '37-%') THEN RAISE EXCEPTION 'load: a 37- number'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE (manufacturer = 'Thermo King' AND part_number !~ '^[0-9]{2}-[0-9]{4}$')",
    "             OR (manufacturer = 'Carrier Transicold' AND part_number !~ '^[0-9]{2}-[0-9]{5}-[0-9]{2}$')",
    "             OR manufacturer NOT IN ('Thermo King', 'Carrier Transicold')) THEN",
    "    RAISE EXCEPTION 'load: a number is missing a zero or does not fit the maker shape'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE description ~* 'napa|reilly|autozone|advance auto|rockauto|fleetpride|amazon|ebay|mincarone|walmart|carquest|www\\.|https?:') THEN",
    "    RAISE EXCEPTION 'load: a store name in a description'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_cross WHERE brand ~* '^(napa|napa gold|carquest)$') THEN",
    "    RAISE EXCEPTION 'load: a retailer house brand cross'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_fitment WHERE NOT public.is_single_model(unit_model) OR NOT public.is_single_model(engine_model)) THEN',
    "    RAISE EXCEPTION 'load: a fitment model is a group'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_fitment f WHERE f.engine_code IS NOT NULL',
    '             AND NOT EXISTS (SELECT 1 FROM public.engines x WHERE x.engine_code = f.engine_code)',
    '             AND NOT EXISTS (SELECT 1 FROM _ld_engines x WHERE x.engine_code = f.engine_code)) THEN',
    "    RAISE EXCEPTION 'load: a fitment engine code is not an engine'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_fitment f WHERE NOT EXISTS (SELECT 1 FROM _ld_parts n WHERE n.manufacturer = f.manufacturer AND n.part_number = f.part_number)',
    '             AND NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
    "    RAISE EXCEPTION 'load: a fitment row names no part'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_cross f WHERE NOT EXISTS (SELECT 1 FROM _ld_parts n WHERE n.manufacturer = f.manufacturer AND n.part_number = f.part_number)',
    '             AND NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
    "    RAISE EXCEPTION 'load: a cross names no part'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_fitment f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)',
    '             JOIN public.part_fitment x ON x.part_id = p.id',
    "              AND upper(coalesce(x.unit_model, '')) = upper(coalesce(f.unit_model, ''))",
    "              AND upper(coalesce(x.engine_model, '')) = upper(coalesce(f.engine_model, ''))",
    "              AND upper(coalesce(x.engine_code, '')) = upper(coalesce(f.engine_code, ''))) THEN",
    "    RAISE EXCEPTION 'load: a fitment row is already in the store'; END IF;",
    '  -- No fitment onto a number the store retires, or a confirmed / oem_matrix link here retires.',
    '  IF EXISTS (SELECT 1 FROM _ld_fitment f JOIN public.part_supersession s',
    '             ON s.manufacturer = f.manufacturer AND s.old_number_normalized = public.normalize_part_number(f.part_number))',
    '  OR EXISTS (SELECT 1 FROM _ld_fitment f JOIN _ld_sup s',
    "             ON s.manufacturer = f.manufacturer AND public.normalize_part_number(s.old_number) = public.normalize_part_number(f.part_number)",
    "             AND s.confidence IN ('confirmed', 'oem_matrix')) THEN",
    "    RAISE EXCEPTION 'load: fitment onto a superseded number'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_sup s JOIN public.part_supersession x ON x.manufacturer = s.manufacturer',
    '             AND x.old_number_normalized = public.normalize_part_number(s.old_number) AND x.new_number_normalized = public.normalize_part_number(s.new_number)) THEN',
    "    RAISE EXCEPTION 'load: a supersession is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_cross c JOIN public.parts p',
    '             ON p.manufacturer = c.manufacturer AND p.part_number_normalized = public.normalize_part_number(c.part_number)',
    '             JOIN public.part_cross_reference x ON x.part_id = p.id AND upper(x.brand) = upper(c.brand)',
    '              AND x.brand_number_normalized = public.normalize_part_number(c.brand_number)) THEN',
    "    RAISE EXCEPTION 'load: a cross is already in the store'; END IF;",
    'END $$;',
    '',
    '-- 1. engines (fitment rows name them)',
    'INSERT INTO public.engines (engine_code, engine_maker, base_engine, tier, confidence, source_note)',
    'SELECT engine_code, engine_maker, base_engine, tier, confidence, NULL FROM _ld_engines;',
    '',
    '-- 2. parts: Source A then Source B',
    'INSERT INTO public.parts (manufacturer, part_number, part_type, description, notes, verified, source, confidence, equipment_type)',
    'SELECT manufacturer, part_number, part_type, description, NULL, FALSE, src, NULL, equipment_type FROM _ld_parts;',
    '',
    '-- 3. fitment (Source A carries its own tier; Source B none)',
    'INSERT INTO public.part_fitment (part_id, unit_model, engine_model, engine_code, match_type, serial_from, serial_before, tier, note, verified, source, confidence)',
    'SELECT p.id, f.unit_model, f.engine_model, f.engine_code, f.match_type, f.serial_from, f.serial_before, f.tier, NULL, FALSE, f.src, f.confidence',
    '  FROM _ld_fitment f',
    '  JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
    '',
    '-- 4. supersessions (Source A)',
    'INSERT INTO public.part_supersession (manufacturer, old_number, new_number, note, verified, source, confidence)',
    `SELECT manufacturer, old_number, new_number, NULL, FALSE, '${SRC_A}', confidence FROM _ld_sup;`,
    '',
    '-- 5. crosses',
    'INSERT INTO public.part_cross_reference (part_id, brand, brand_number, verified, source, confidence)',
    'SELECT p.id, c.brand, c.brand_number, FALSE, c.src, c.confidence',
    '  FROM _ld_cross c',
    '  JOIN public.parts p ON p.manufacturer = c.manufacturer AND p.part_number_normalized = public.normalize_part_number(c.part_number);',
    '',
    '-- Checks AFTER writing: every table moved by exactly the planned amount, nothing else.',
    'DO $$',
    'DECLARE b RECORD;',
    'BEGIN',
    '  SELECT * INTO b FROM _ld_before;',
    `  IF (SELECT count(*) FROM public.engines) - b.engines <> ${nEng} THEN RAISE EXCEPTION 'load: engines did not grow by ${nEng}'; END IF;`,
    `  IF (SELECT count(*) FROM public.parts) - b.parts <> ${nParts} THEN RAISE EXCEPTION 'load: parts did not grow by ${nParts}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_fitment) - b.part_fitment <> ${nFit} THEN RAISE EXCEPTION 'load: part_fitment did not grow by ${nFit}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_supersession) - b.part_supersession <> ${nSup} THEN RAISE EXCEPTION 'load: part_supersession did not grow by ${nSup}'; END IF;`,
    `  IF (SELECT count(*) FROM public.part_cross_reference) - b.part_cross_reference <> ${nCross} THEN RAISE EXCEPTION 'load: part_cross_reference did not grow by ${nCross}'; END IF;`,
    `  IF (SELECT count(*) FROM public.parts WHERE source = '${SRC_A}') <> ${aParts} OR (SELECT count(*) FROM public.parts WHERE source = '${SRC_B}') <> ${bCount.parts} THEN`,
    "    RAISE EXCEPTION 'load: parts per source are not what the plan says'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.parts WHERE source IN ('${SRC_A}', '${SRC_B}') AND (verified OR confidence IS NOT NULL OR notes IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a new part is not verified=false / confidence NULL / notes NULL'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE source IN ('${SRC_A}', '${SRC_B}') AND (verified OR note IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a new fitment row is verified or carries a note'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE source = '${SRC_B}' AND confidence IS NOT NULL)`,
    `  OR EXISTS (SELECT 1 FROM public.part_cross_reference WHERE source = '${SRC_B}' AND (verified OR confidence IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a Source B row carries a trust tier'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_cross_reference WHERE source = '${SRC_A}' AND verified)`,
    `  OR EXISTS (SELECT 1 FROM public.part_supersession WHERE source = '${SRC_A}' AND (verified OR note IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a Source A cross or supersession is verified or carries a note'; END IF;",
    'END $$;',
    '',
    '-- What it did (this is the table the SQL editor shows).',
    `SELECT 'parts' AS table_name, b.parts AS before, (SELECT count(*) FROM public.parts) AS after, ${nParts} AS planned FROM _ld_before b`,
    `UNION ALL SELECT 'part_fitment', b.part_fitment, (SELECT count(*) FROM public.part_fitment), ${nFit} FROM _ld_before b`,
    `UNION ALL SELECT 'part_supersession', b.part_supersession, (SELECT count(*) FROM public.part_supersession), ${nSup} FROM _ld_before b`,
    `UNION ALL SELECT 'part_cross_reference', b.part_cross_reference, (SELECT count(*) FROM public.part_cross_reference), ${nCross} FROM _ld_before b`,
    `UNION ALL SELECT 'engines', b.engines, (SELECT count(*) FROM public.engines), ${nEng} FROM _ld_before b;`,
    '',
    'ROLLBACK;',
    '',
  )
  fs.writeFileSync(OUT, L.join('\n'), { encoding: 'ascii' })

  console.log(`store ${parts.length} parts / ${fit.length} fitment / ${sup.length} sup / ${xr.length} cross / ${engines.length} engines`)
  console.log(`A: engines ${nEng}, parts ${aParts} (dupes ${dupesA.length}), fitment ${aFits} (onto store ${aOntoStore}), sup ${nSup}, cross ${aCross}`)
  console.log(`A fitment held: ${JSON.stringify(heldFitCount)}; A cross held: ${JSON.stringify(heldCross)}`)
  console.log(`B: rows ${refRows.length}, parts ${bCount.parts}, dupOfA ${bCount.dupOfA} ${JSON.stringify(bDupOfA)}, fitment ${bFits} (model ${bModel}, engine ${bEngine}, B parts with no loadable fitment ${bCount.parts - new Set(bFitRows.map(f => f.number)).size}), cross ${bCross}, napa held ${heldNapa.length}`)
  console.log(`B types: ${JSON.stringify([...bTypes].sort((a, b) => b[1] - a[1]))}`)
  console.log(`B fitment by unit_family loaded: ${JSON.stringify(fits.filter(f => f.src === SRC_B).reduce((m, f) => (m[f.unit ?? f.engineModel ?? ''] = (m[f.unit ?? f.engineModel ?? ''] ?? 0) + 1, m), {} as Record<string, number>))}`)
  console.log('HELD:'); for (const [b, l] of Object.entries(held)) console.log(`  ${b}: ${l.length}${l.length <= 12 ? '  ' + l.join(' | ') : ''}`)
  console.log(`B family/list not loaded: ${Object.values(bFamily).reduce((s, n) => s + n, 0)}`)
  console.log(`type conflicts ${typeConflicts.length}`); for (const c of typeConflicts) console.log('  ' + c)
  console.log(`supersessions loaded: ${newSups.map(s => `${s.old}->${s.neu}[${s.conf}]`).join(', ')}`)
  console.log(`store fitment under new followed links: ${newlyRetiredWithFit.join(' | ') || 'none'}`)
  console.log(`Supra 660 filters now: ${[...supra].sort().join(', ')}; this load adds: ${supraAdded.join(', ') || 'none'}`)
  console.log(`wrote ${OUT}`)
}
main().catch(e => { console.error(e); process.exit(1) })
