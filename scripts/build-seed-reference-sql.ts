// npx tsx scripts/build-seed-reference-sql.ts
//
// READS the database, the five Oct 23 seed CSVs and hd_parts_reference. WRITES TWO FILES:
//   scripts/load-seed-and-reference.sql         the load, ends in ROLLBACK
//   scripts/load-seed-and-reference-report.txt  every item not loaded, with the exact reason
// Never writes to the database. Brock runs the SQL by hand.
//
// SOURCE A - C:\Users\natio\Downloads\seed-{parts,fitment,crosses,supersessions,engines}.csv
// SOURCE B - hd_parts_reference: rows whose number is in no parts row (new parts and their
//            fitment), and EVERY row's cross columns (matched to its OEM part).
//
// RULES (Brock, Oct 28-29)
//   * every number goes through parsePartNumber; listing numbers through parseListingNumber
//     (rule 7: -U -R -RB -K SV, CA- CTK- come off - the condition is reported, never a part)
//   * no duplicate parts; fitment a kept row lacks is added to it; store parts never edited
//   * no fitment onto a superseded number. Where a FOLLOWED link (confirmed / oem_matrix,
//     or a verified store link) retires the number, the fitment is carried to the
//     replacement as confidence 'derived', with a note saying so.
//   * no fitment that straddles a split (serial OR build date) already in the store or in
//     this load: an unconditional row beside a split on another part, or the reverse
//   * every cross loads, retailer house brands included (NAPA, NAPA Gold, Carquest) - the
//     brand is stored with the number; display is a UI decision
//   * serial and date breaks go INTO serial_from / serial_before / build_date_from /
//     build_date_before. Conditions with no column go into the fitment note, worded from
//     the source, with no vendor or retailer name.
//   * STILL HELD for Brock: group / prose model strings, 45-2323 -> 45-2324,
//     11-9098 -> 11-9341, the type disagreements (store types are never changed here)
//
// TRUST: Source A carries its own confidence (175's vocabulary); verified = false.
//   Source B: verified = false, confidence NULL - hd_parts_reference.verified is a column
//   default set on every row of a bulk load and records no check.

import fs from 'fs'
import { loadEnv } from './lib/smoke-session'
import { parsePartNumber, parseListingNumber, type ParsedPartNumber } from '../src/lib/parts/part-number'
import { normalizeModel } from '../src/lib/parts/search'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const DL = 'C:/Users/natio/Downloads/'
const OUT = 'scripts/load-seed-and-reference.sql'
const REPORT = 'scripts/load-seed-and-reference-report.txt'
const SRC_A = 'nwi-seed-2026-10-23'
const SRC_B = 'nwi-hd-parts-reference-112'

async function all(t: string, order = 'id'): Promise<Record<string, any>[]> {
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
const shapeMaker = (p: ParsedPartNumber) =>
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
// Passes the CHECK but is not a model name a tech would search.
const proseModel = (v: string) => /^[0-9]+$/.test(v) || /[();]/.test(v) || /(^|\s)(to|with|or|up|earlier|units)(\s|$)/i.test(v) || /^tier\b/i.test(v)

const TIERS = new Set(['confirmed', 'oem_matrix', 'field_observed', 'dealer', 'derived', 'unconfirmed', 'conflict'])
const FOLLOWED = new Set(['confirmed', 'oem_matrix'])
// Vendor / retailer / aggregator names that may never reach a non-brand column.
const VENDOR = /napa|o'?reilly|autozone|auto zone|advance auto|rockauto|fleetpride|fleet pride|amazon|ebay|mincarone|walmart|carquest|parts ?authority|can\.ca|swisclima|kingreat|fuerdun|total parts|thermo-by-products|aftermark|smithco|mengyang|myriad|fridayparts|ct west|motor city|allsize|inline|oilfilter-crossreference|www\.|https?:/i
// hd_parts_reference cross columns -> brand as stored. Every one loads (Brock, Oct 29).
const REF_CROSS: Array<[string, string]> = [
  ['baldwin', 'Baldwin'], ['donaldson', 'Donaldson'], ['fleetguard', 'Fleetguard'], ['wix', 'WIX'],
  ['dayco', 'Dayco'], ['gates', 'Gates'], ['continental', 'Continental'], ['luber_finer', 'Luber-finer'],
  ['napa_gold', 'NAPA Gold'],
]

const lit = (v: string | null | undefined) => {
  if (v == null || v === '') return 'NULL'
  if (/[^\x20-\x7E]/.test(v)) throw new Error(`non-ASCII in ${JSON.stringify(v)}`)
  return `'${v.replace(/'/g, "''")}'`
}

// ── serial and date breaks, read out of the (unloaded) source note ────────────
type Break = { serialFrom?: string; serialBefore?: string; dateFrom?: string; dateBefore?: string }
const yr = (y: string) => y.length === 4 ? Number(y) : (Number(y) >= 50 ? 1900 : 2000) + Number(y)
const day = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`
// A month boundary is one date for both sides: "before 6/2021" and "after 6/2021" meet at
// 2021-06-01, so the two halves of a changeover partition cleanly.
function readBreak(note: string): Break | null {
  const b: Break = {}
  let m
  if ((m = note.match(/before SN ([A-Z0-9]+)/i))) b.serialBefore = m[1]
  if ((m = note.match(/s\/n ([A-Z0-9]+)\+/i))) b.serialFrom = m[1]
  if ((m = note.match(/up to Q([1-4]) ([0-9]{4})/i))) { const q = Number(m[1]); const y = Number(m[2]); b.dateBefore = q === 4 ? day(y + 1, 1) : day(y, q * 3 + 1) }
  if ((m = note.match(/from Q([1-4]) ([0-9]{4})/i))) b.dateFrom = day(Number(m[2]), (Number(m[1]) - 1) * 3 + 1)
  if ((m = note.match(/\b(before|after)\s+([0-9]{1,2})\/([0-9]{2,4})\b/i))) {
    const d = day(yr(m[3]), Number(m[2])); if (/before/i.test(m[1])) b.dateBefore = d; else b.dateFrom = d
  }
  if ((m = note.match(/before '([0-9]{2})\b/))) b.dateBefore = day(yr(m[1]), 1)
  if ((m = note.match(/\b([0-9]{2})\.([0-9]{2})\s*on\b/))) b.dateFrom = day(yr(m[2]), Number(m[1]))
  if ((m = note.match(/up to ([0-9]{2})\.([0-9]{2})\b/))) b.dateBefore = day(yr(m[2]), Number(m[1]))
  return Object.keys(b).length ? b : null
}
// A break word with nothing readable after it ("early units", "later DI 2.2 units").
const vagueBreak = (note: string) => /\b(early|later)\b/i.test(note) || /\b(SN|S\/N|serial)\b/i.test(note)
  || /\b(before|after|until)\b/i.test(note) || /up to (?![0-9,]+ ?hr)/i.test(note)

// The fitment note, worded from the source, with no vendor name. Null when nothing applies.
function fitNote(note: string): string | null {
  const parts: string[] = []
  if (/severe duty/i.test(note)) parts.push('Severe duty.')
  else if (/standard duty/i.test(note)) parts.push('Standard duty.')
  if (/only with (the )?(fuel )?pre-filter/i.test(note)) parts.push('Only with the fuel pre-filter.')
  if (/optional DAVCO fuel heater/i.test(note)) parts.push('In the optional DAVCO fuel heater/filter.')
  else if (/\boptional\b/i.test(note)) parts.push('Optional.')
  if (/from Q1 2001 \/ SR units/i.test(note)) parts.push('Also SR units.')
  const c = note.match(/listed in TK SLXi kit ([0-9]+) \(CONFLICT with ([0-9-]+)/i)
  if (c) parts.push(`Listed in TK SLXi kit ${c[1]}; conflicts with ${c[2]}.`)
  const h = note.match(/up to ([0-9,]+) ?hr/i)
  if (h) parts.push(`Up to ${h[1]} hr.`)
  return parts.length ? parts.join(' ') : null
}

// What a part DOES, for the split guard. Parts that share a type but not a job (a bypass and
// a full-flow oil filter, a fuel pre-filter and the main fuel filter) are not alternatives, so
// one dated and one undated is not a straddle. The SQL check applies the same CASE (FUNC_SQL).
function funcKey(type: string, desc: string | null): string {
  const d = desc ?? ''
  if (/^filter - oil/i.test(type)) return /bypass/i.test(d) ? 'oil-bypass' : 'oil'
  if (/^filter - fuel/i.test(type)) return /pre-filter|strainer/i.test(d) ? 'fuel-pre' : /secondary/i.test(d) ? 'fuel-secondary'
    : /primary/i.test(d) ? 'fuel-primary' : /davco|heater/i.test(d) ? 'fuel-heater' : 'fuel'
  if (/^filter - (cab )?air/i.test(type)) return /cab/i.test(type) || /cab|evaporator/i.test(d) ? 'air-cab' : 'air'
  return type
}
const FUNC_SQL = (t: string, d: string) => `CASE WHEN ${t} ~* '^filter - oil' THEN CASE WHEN coalesce(${d}, '') ~* 'bypass' THEN 'oil-bypass' ELSE 'oil' END`
  + ` WHEN ${t} ~* '^filter - fuel' THEN CASE WHEN coalesce(${d}, '') ~* 'pre-filter|strainer' THEN 'fuel-pre' WHEN coalesce(${d}, '') ~* 'secondary' THEN 'fuel-secondary'`
  + ` WHEN coalesce(${d}, '') ~* 'primary' THEN 'fuel-primary' WHEN coalesce(${d}, '') ~* 'davco|heater' THEN 'fuel-heater' ELSE 'fuel' END`
  + ` WHEN ${t} ~* '^filter - (cab )?air' THEN CASE WHEN ${t} ~* 'cab' OR coalesce(${d}, '') ~* 'cab|evaporator' THEN 'air-cab' ELSE 'air' END`
  + ` ELSE ${t} END`

type NewPart = { src: string; maker: string; number: string; type: string; description: string | null; equipment: string | null }
type Fit = { src: string; maker: string; number: string; unit: string | null; engineModel: string | null; engineCode: string | null
  match: 'unit_model' | 'engine'; serialFrom: string | null; serialBefore: string | null; dateFrom: string | null; dateBefore: string | null
  tier: string | null; conf: string | null; note: string | null; how: string }
type Sup = { maker: string; old: string; neu: string; conf: string }
type Cross = { src: string; maker: string; number: string; brand: string; brandNumber: string; conf: string | null; how: string }

async function main() {
  const [parts, fit, sup, xr, engines, ref] = await Promise.all([
    all('parts'), all('part_fitment'), all('part_supersession'), all('part_cross_reference'),
    all('engines', 'engine_code'), all('hd_parts_reference'),
  ])
  const sp = readCsv('seed-parts.csv'), sf = readCsv('seed-fitment.csv'), sc = readCsv('seed-crosses.csv')
  const ss = readCsv('seed-supersessions.csv'), se = readCsv('seed-engines.csv')

  // ── report: every item that does not load as-is, and what became of it ──────
  const R: Record<string, string[]> = {}
  const rep = (section: string, line: string) => { (R[section] ??= []).push(line) }
  const tally: Record<string, number> = {}
  const tick = (k: string) => { tally[k] = (tally[k] ?? 0) + 1 }

  // ── the store ─────────────────────────────────────────────────────────────
  // Store numbers the normalizer now writes differently (rule 6 on TK NNN-NNN, Oct 29) are
  // REPAIRED first in the SQL, so every comparison here uses the canonical key.
  const repairs: Array<{ id: string; maker: string; from: string; to: string }> = []
  for (const p of parts) {
    const c = parsePartNumber(p.part_number)
    if (c.padded && c.canonical !== p.part_number && shapeMaker(c) === p.manufacturer) {
      repairs.push({ id: p.id, maker: p.manufacturer, from: p.part_number, to: c.canonical })
      p.part_number = c.canonical; p.part_number_normalized = c.key
    }
  }
  for (const r of repairs) rep('Store repairs', `${r.from} -> ${r.to} (${r.maker}) - rule 6 on the TK NNN-NNNN form`)
  const store = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))
  if (store.size !== parts.length) throw new Error('a repair collides with another store part')
  const storeFit = new Map<string, Array<{ u: string; e: string; c: string }>>()
  for (const f of fit) storeFit.set(f.part_id, [...(storeFit.get(f.part_id) ?? []),
    { u: normalizeModel(f.unit_model ?? ''), e: normalizeModel(f.engine_model ?? ''), c: normalizeModel(f.engine_code ?? '') }])
  const storeCross = new Set(xr.map(x => `${x.part_id}|${String(x.brand).toUpperCase()}|${normalizeModel(x.brand_number)}`))
  const storeSup = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}|${s.new_number_normalized}`))
  const engineCodes = new Set(engines.map(e => String(e.engine_code)))

  // ═══ SOURCE A ════════════════════════════════════════════════════════════════
  const newEngines = se.filter(e => !engineCodes.has(e.engine_code))
  for (const e of newEngines) if (!TIERS.has(e.confidence)) throw new Error(`engine ${e.engine_code}: confidence ${e.confidence}`)
  const allEngines = new Set([...engineCodes, ...se.map(e => e.engine_code)])

  // supersessions (they decide which numbers are retired)
  const newSups: Sup[] = []
  const seedStatus = new Map(sp.map(r => [`${mk(r.maker)}|${parsePartNumber(r.part_number).key}`, r.status]))
  const BROCK_HELD = new Set(['Thermo King|452323|452324', 'Thermo King|119098|119341'])
  for (const r of ss) {
    const maker = mk(r.maker)
    const lo = parseListingNumber(r.old_part), ln = parseListingNumber(r.new_part)
    const o = lo.base, n = ln.base
    const label = `${r.old_part} -> ${r.new_part} [${r.confidence}]`
    const cond = lo.condition ? ` (old number's ${lo.marker} marker = ${lo.condition}, base ${o.canonical})` : ''
    if (BROCK_HELD.has(`${maker}|${o.key}|${n.key}`)) { rep('A supersessions', `HELD  ${label} - your decision (held Oct 28)`); continue }
    if (o.suffix || n.suffix) { rep('A supersessions', `HELD  ${label} - suffix ${o.suffix ?? n.suffix} is not one of the rule-7 markers`); continue }
    if (shapeMaker(o) !== maker || shapeMaker(n) !== maker) { rep('A supersessions', `HELD  ${label} - fits no rule`); continue }
    if (o.key === n.key) { rep('A supersessions', `RESOLVED  ${label} - ${lo.marker} is the ${lo.condition} marker on ${n.canonical} itself; one part, nothing to link`); continue }
    if (!TIERS.has(r.confidence)) { rep('A supersessions', `HELD  ${label} - confidence off the 175 list`); continue }
    if (storeSup.has(`${maker}|${o.key}|${n.key}`)) { rep('A supersessions', `DUPLICATE  ${label} - already in the store`); continue }
    if (FOLLOWED.has(r.confidence) && seedStatus.get(`${maker}|${o.key}`) === 'current') {
      rep('A supersessions', `HELD  ${label} - a confirmed link, but the seed lists ${o.canonical} as current`); continue
    }
    if (newSups.some(s => s.maker === maker && s.old === o.canonical && s.neu === n.canonical)) continue
    newSups.push({ maker, old: o.canonical, neu: n.canonical, conf: r.confidence })
    if (cond) rep('A supersessions', `RECOVERED  ${label}${cond} - loads as ${o.canonical} -> ${n.canonical}`)
  }
  // retired numbers, and where a followed link sends them
  const retired = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}`))
  const followTo = new Map<string, string>()
  for (const s of sup) if (s.confidence ? FOLLOWED.has(s.confidence) : s.verified) followTo.set(`${s.manufacturer}|${s.old_number_normalized}`, s.new_number)
  for (const s of newSups) if (FOLLOWED.has(s.conf)) {
    const k = `${s.maker}|${parsePartNumber(s.old).key}`; retired.add(k); followTo.set(k, s.neu)
  }
  const loadedSupOld = new Set(newSups.map(s => `${s.maker}|${parsePartNumber(s.old).key}`))

  // parts
  const newParts: NewPart[] = []
  const added = new Map<string, NewPart>()
  const dupesA: string[] = []; const typeConflicts: string[] = []
  const heldPartKeys = new Set<string>()
  for (const r of sp) {
    const maker = mk(r.maker); const p = parsePartNumber(r.part_number); const k = `${maker}|${p.key}`
    if (p.suffix) { rep('A parts', `HELD  ${r.part_number} - suffix ${p.suffix}`); heldPartKeys.add(k); continue }
    if (shapeMaker(p) !== maker) { rep('A parts', `HELD  ${r.part_number} - fits no rule (${p.form})`); heldPartKeys.add(k); continue }
    const kept = store.get(k)
    if (kept) {
      dupesA.push(kept.part_number)
      if (r.part_type && r.part_type !== kept.part_type) typeConflicts.push(`${kept.part_number.padEnd(12)} store "${kept.part_type}"  seed "${r.part_type}"`)
      continue
    }
    if (added.has(k)) continue
    if (r.status === 'superseded' && !loadedSupOld.has(k)) {
      rep('A parts', `HELD  ${p.canonical} - superseded by ${r.superseded_by}, and that supersession is your decision`); heldPartKeys.add(k); continue
    }
    if (r.description && VENDOR.test(r.description)) throw new Error(`vendor name in description of ${r.part_number}`)
    const np: NewPart = { src: SRC_A, maker, number: p.canonical, type: r.part_type, description: r.description || null, equipment: r.equipment_type || null }
    newParts.push(np); added.set(k, np)
  }

  // fitment
  const fits: Fit[] = []
  const fitSeen = new Set<string>()
  const resolve = (maker: string, raw: string) => {
    const p = parsePartNumber(raw); const k = `${maker}|${p.key}`
    return { p, k, kept: store.get(k), nw: added.get(k) }
  }
  const already = (partId: string | undefined, u: string, c: string) => {
    if (!partId) return false
    const have = storeFit.get(partId) ?? []
    return u ? have.some(h => h.u === u) : have.some(h => h.c === c || h.e === c)
  }
  const pushFit = (f: Fit, partKey: string, partId: string | undefined, label: string): boolean => {
    const key = `${partKey}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? f.engineModel ?? '')}|${f.serialFrom ?? ''}|${f.serialBefore ?? ''}|${f.dateFrom ?? ''}|${f.dateBefore ?? ''}`
    if (fitSeen.has(key)) { tick('A fitment: repeated in the file'); return false }
    fitSeen.add(key)
    if (already(partId, normalizeModel(f.unit ?? ''), normalizeModel(f.engineCode ?? f.engineModel ?? ''))) { tick('A fitment: already in the store'); return false }
    fits.push(f); void label; return true
  }
  for (const r of sf) {
    const maker = mk(r.maker); let { p, k, kept, nw } = resolve(maker, r.part_number)
    const model = r.unit_model || r.engine_code
    const label = `${p.canonical}: ${model}`
    const note = r.source_note
    if (heldPartKeys.has(k)) { rep('A fitment', `HELD  ${label} - its part is held (see A parts)`); tick('A fitment: part held'); continue }
    if (!kept && !nw) { rep('A fitment', `HELD  ${label} - names a part in no source`); tick('A fitment: no part'); continue }
    if (!TIERS.has(r.confidence)) { rep('A fitment', `HELD  ${label} - confidence ${r.confidence} is off the 175 list`); continue }
    // model
    if (r.match_type === 'unit_model') {
      if (!r.unit_model) { rep('A fitment', `HELD  ${p.canonical}: only a group "${r.unit_group || r.unit_series}" - your decision`); tick('A fitment: group / prose model'); continue }
      if (!isSingleModel(r.unit_model) || proseModel(r.unit_model)) { rep('A fitment', `HELD  ${label} - group or prose model string - your decision`); tick('A fitment: group / prose model'); continue }
    } else if (r.match_type === 'engine') {
      if (!allEngines.has(r.engine_code)) { rep('A fitment', `HELD  ${label} - engine code not in engines`); continue }
    } else { rep('A fitment', `HELD  ${label} - match_type ${r.match_type}`); continue }
    // what the note says
    let conf = r.confidence, how = 'as given'
    const brk = readBreak(note)
    if (/superseded by|replaced by/i.test(note) && !brk) {
      rep('A fitment', `HELD  ${label} - note: "${note.slice(0, 70)}"; the part is retired and that supersession is your decision`); tick('A fitment: note says superseded'); continue
    }
    if (!brk && vagueBreak(note) && !/up to [0-9,]+ ?hr/i.test(note)) {
      rep('A fitment', `HELD  ${label} - note gives a break with no serial or date: "${note.slice(0, 80)}"`); tick('A fitment: break with no serial or date'); continue
    }
    if (/CONFLICT/.test(note)) { conf = 'conflict'; how = 'conflict recorded' }
    let serialFrom = r.serial_from || null, serialBefore = r.serial_before || null
    let dateFrom: string | null = null, dateBefore: string | null = null
    if (brk) {
      serialFrom = serialFrom ?? brk.serialFrom ?? null; serialBefore = serialBefore ?? brk.serialBefore ?? null
      dateFrom = brk.dateFrom ?? null; dateBefore = brk.dateBefore ?? null
      how = `break from note: ${[serialFrom && `serial from ${serialFrom}`, serialBefore && `serial before ${serialBefore}`, dateFrom && `built from ${dateFrom}`, dateBefore && `built before ${dateBefore}`].filter(Boolean).join(', ')}`
      tick('A fitment: break recovered into columns')
    }
    // superseded number: carry to the followed replacement, or hold
    let onto = p.canonical
    if (retired.has(k)) {
      const to = followTo.get(k)
      const tgt = to ? resolve(maker, to) : null
      if (!to || !tgt || (!tgt.kept && !tgt.nw)) {
        rep('A fitment', `HELD  ${label} - ${p.canonical} is superseded and the link is not one the counter follows`); tick('A fitment: onto superseded, not carried'); continue
      }
      onto = tgt.kept ? tgt.kept.part_number : tgt.p.canonical; k = tgt.k; kept = tgt.kept; nw = tgt.nw
      conf = 'derived'; how = `carried from superseded ${p.canonical}`
      tick('A fitment: carried to the replacement')
    }
    let fnote = fitNote(note)
    if (how.startsWith('carried')) fnote = [`Carried from superseded ${p.canonical}.`, fnote].filter(Boolean).join(' ')
    if (fnote && VENDOR.test(fnote)) throw new Error(`vendor name in a fitment note: ${fnote}`)
    const f: Fit = r.match_type === 'engine'
      ? { src: SRC_A, maker, number: kept ? kept.part_number : onto, unit: null, engineModel: null, engineCode: r.engine_code, match: 'engine',
          serialFrom, serialBefore, dateFrom, dateBefore, tier: r.tier || null, conf, note: fnote, how }
      : { src: SRC_A, maker, number: kept ? kept.part_number : onto, unit: r.unit_model, engineModel: null, engineCode: null, match: 'unit_model',
          serialFrom, serialBefore, dateFrom, dateBefore, tier: r.tier || null, conf, note: fnote, how }
    if (pushFit(f, k, kept?.id, label) && (brk || how !== 'as given' || fnote)) rep('A fitment', `LOADED  ${label} -> ${f.number} - ${how}${fnote ? `; note "${fnote}"` : ''}`)
  }
  // the same part + model with and without a split in one file: it disagrees with itself
  const splitOf = (f: Fit) => !!(f.serialFrom || f.serialBefore || f.dateFrom || f.dateBefore)
  const bare = (f: Fit) => `${f.maker}|${parsePartNumber(f.number).key}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? '')}`
  {
    const sk = new Set(fits.filter(splitOf).map(bare)), pk = new Set(fits.filter(f => !splitOf(f)).map(bare))
    for (let i = fits.length - 1; i >= 0; i--) {
      const f = fits[i]
      if (sk.has(bare(f)) && pk.has(bare(f))) {
        rep('A fitment', `HELD  ${f.number}: ${f.unit ?? f.engineCode} - the file lists it both with and without a break (${f.how})`)
        tick('A fitment: listed with and without a break'); fits.splice(i, 1)
      }
    }
  }

  // ── crosses: clean rows, and rows reassembled from split notes ─────────────
  const crosses: Cross[] = []
  const crossSeen = new Set<string>()
  const pushCross = (c: Cross, partId: string | undefined, label: string, section: string) => {
    const key = `${c.maker}|${parsePartNumber(c.number).key}|${c.brand.toUpperCase()}|${normalizeModel(c.brandNumber)}`
    if (crossSeen.has(key)) return
    crossSeen.add(key)
    if (partId && storeCross.has(`${partId}|${c.brand.toUpperCase()}|${normalizeModel(c.brandNumber)}`)) { rep(section, `DUPLICATE  ${label} - already in the store`); return }
    if (VENDOR.test(c.brandNumber) || /[()]/.test(c.brandNumber)) throw new Error(`cross number is not a number: ${label}`)
    crosses.push(c)
  }
  // Group the seed rows by (part, brand, note): the note is the original, whole claim.
  const groups = new Map<string, Record<string, string>[]>()
  for (const r of sc) { const k = `${mk(r.maker)}|${r.part_number}|${r.cross_mfr}|${r.source_note}`; groups.set(k, [...(groups.get(k) ?? []), r]) }
  for (const rows of groups.values()) {
    const r0 = rows[0]; const maker = mk(r0.maker)
    const { p, kept, nw } = resolve(maker, r0.part_number)
    const note = r0.source_note.trim()
    const brand = r0.cross_mfr
    const label = `${p.canonical} ${brand} "${note.slice(0, 90)}"`
    const clean = rows.length === 1 && /^[A-Z0-9][A-Z0-9-]*$/i.test(r0.cross_part) && /[0-9]/.test(r0.cross_part) && note === r0.cross_part
    // Which numbers the note claims, and at what tier.
    let nums: Array<{ n: string; conf: string | null }> = []
    let how = 'clean row'
    if (clean) nums = [{ n: r0.cross_part, conf: r0.confidence }]
    else {
      how = rows.length > 1 ? `reassembled from ${rows.length} split rows` : 'qualified row'
      const cautious = /CONFLICT/.test(note) ? 'conflict' : /unconfirmed/i.test(note) ? 'unconfirmed' : /derived/i.test(note) ? 'derived'
        : /aftermarket only/i.test(note) ? null : /obsolete/i.test(rows.map(x => x.confidence).join(' ')) ? 'obsolete' : (TIERS.has(r0.confidence) ? r0.confidence : null)
      let m
      if (/^CONFLICT: none\b/i.test(note)) {
        rep('A crosses', `NO CROSS  ${label} - the source says there is none; nothing to load`); continue
      } else if ((m = note.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)[^]*?- use ([A-Z0-9-]+)/i))) {
        nums = [{ n: m[3], conf: 'conflict' }]; how += `; the note says use ${m[3]} over ${m[3] === m[1] ? m[2] : m[1]}`
      } else if ((m = note.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)/i))) {
        nums = [{ n: m[1], conf: 'conflict' }, { n: m[2], conf: 'conflict' }]; how += '; both sides of the conflict'
      } else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9][A-Z0-9-]*)\s*\(Inline also lists ([A-Z0-9-]+)\)/i))) {
        nums = [{ n: m[1], conf: rows.find(x => x.cross_part === m![1])?.confidence ?? null }, { n: m[2], conf: 'unconfirmed' }]
      } else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9])((?:\s*\/\s*[A-Z0-9-]+)+)\s*(\(|$)/i))) {
        const first = m[1]; nums = [{ n: first, conf: cautious }]
        for (const v of m[2].split('/').map(x => x.trim()).filter(Boolean)) {
          const full = v.startsWith('-') ? first.replace(/-[^-]+$/, v) : v
          nums.push({ n: full, conf: cautious })
        }
        how += '; one cell, several numbers'
      } else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9][A-Z0-9-]*)(\s+KIT)?\s*(\(|$)/i))) {
        nums = [{ n: m[1] + (m[2] ?? ''), conf: cautious }]
      } else { rep('A crosses', `UNREADABLE  ${label}`); continue }
      if (cautious === 'obsolete') {
        rep('A crosses', `HELD  ${label} - the cross number is OBSOLETE and part_cross_reference has no column for that; it needs a status column (a migration adding part_cross_reference.status TEXT CHECK (status IN ('current','obsolete')))`)
        continue
      }
    }
    if (heldPartKeys.has(`${maker}|${p.key}`) || (!kept && !nw)) {
      rep('A crosses', `HELD  ${label} - its OEM part ${p.canonical} does not load (see A parts)`); continue
    }
    for (const x of nums) {
      const conf = x.conf && TIERS.has(x.conf) ? x.conf : null
      const c: Cross = { src: SRC_A, maker, number: kept ? kept.part_number : p.canonical, brand, brandNumber: x.n, conf, how }
      pushCross(c, kept?.id, `${p.canonical} ${brand} ${x.n}`, 'A crosses')
      if (!clean) rep('A crosses', `REPAIRED  ${p.canonical} ${brand} ${x.n} [${conf ?? 'no tier'}] - ${how}`)
    }
  }
  const aParts = newParts.length, aCross = crosses.length

  // ═══ SOURCE B ════════════════════════════════════════════════════════════════
  const storeKeysAnyMaker = new Set(parts.map(p => p.part_number_normalized))
  // A store row or a part this load adds; either way read its number through part_number ?? number.
  const known = (maker: string, key: string): Record<string, any> | undefined => store.get(`${maker}|${key}`) ?? added.get(`${maker}|${key}`)
  const knownUnits = new Set([...fit.map(f => f.unit_model), ...sf.map(r => r.unit_model)].filter(Boolean).map(v => normalizeModel(v)))
  const knownUnitsRaw = [...new Set([...fit.map(f => f.unit_model), ...sf.map(r => r.unit_model)].filter(Boolean).map((v: string) => v.toUpperCase().trim()))]
  const knownEngines = new Set([...fit.map(f => f.engine_model), ...fit.map(f => f.engine_code), ...allEngines].filter(Boolean).map(v => normalizeModel(v)))
  const GENERIC = new Set(['GENSET', 'GENSETS', 'TRUCKUNITS', 'TRAILERUNITS', 'TRUCK', 'TRAILER', 'APU'])
  const isFamily = (v: string) => GENERIC.has(normalizeModel(v)) || knownUnitsRaw.some(m => m.startsWith(v.toUpperCase().trim() + ' '))
  const bFamily: Record<string, number> = {}
  let bParts = 0
  const conditionTally: Record<string, number> = {}

  // Numbers a seed note records as replaced ("Itself replaced 11-3726 / 11-3693", "Replaces
  // 11-5712 / 11-5522"): old numbers with no supersession row. Never loaded as current parts.
  const oldInNotes = new Map<string, string>()
  for (const r of sp) {
    const m = String(r.notes ?? '').match(/replace[sd]?\s+((?:[0-9]{2}-[0-9]{4,5}(?:-[0-9]{2})?\s*\/?\s*)+)/i)
    if (m) for (const n of m[1].split('/').map(x => x.trim()).filter(Boolean))
      oldInNotes.set(`${mk(r.maker)}|${parsePartNumber(n).key}`, `${r.part_number}: ${m[0].trim()}`)
  }

  // Split a cell into its numbers. "25-39236-00 / -01" -> 25-39236-00, 25-39236-01.
  const pieces = (cell: string) => {
    const raw = cell.split('/').map(x => x.trim()).filter(Boolean)
    return raw.map(x => x.startsWith('-') ? raw[0].replace(/-[^-]+$/, x) : x)
  }
  // The part a reference row is FOR, after rule 7 and pair handling. Null when none loads.
  const primary = new Map<string, { maker: string; number: string; why: string } | null>()

  for (const r of ref) {
    if (!r.oem_part_number) continue
    const maker = r.manufacturer === 'TK' ? 'Thermo King' : r.manufacturer === 'Carrier' ? 'Carrier Transicold' : r.manufacturer
    const cell = String(r.oem_part_number)
    const isNew = !storeKeysAnyMaker.has(parsePartNumber(cell).key)
    const fn = String(r.part_function ?? '').trim().replace(/\u00b0/g, ' deg ').replace(/[\u2013\u2014]/g, '-').replace(/ {2,}/g, ' ')
    const label = `${cell} (${fn})`
    const ps = pieces(cell)
    const lines: string[] = []
    let chosen: { maker: string; number: string; key: string } | null = null
    const seenKeys = new Set<string>()
    for (let i = 0; i < ps.length; i++) {
      const L = parseListingNumber(ps[i]); const p = L.base
      if (seenKeys.has(p.key)) { lines.push(`${ps[i]} is the same number as ${ps[0]}`); continue }
      seenKeys.add(p.key)
      const cond = L.condition ? `, condition ${L.condition} (${L.marker})` : ''
      if (L.condition) conditionTally[L.marker!] = (conditionTally[L.marker!] ?? 0) + 1
      // Rule 5 (corrected Oct 29): reman ONLY when the part is an alternator or a starter.
      const remanOf = p.remanOf ?? (p.form === 'carrier_reman' ? p.relatesTo : null)
      if (remanOf && /alternator|starter/i.test(`${r.part_category} ${fn}`)) {
        const base = known(p.maker === 'carrier' ? 'Carrier Transicold' : 'Thermo King', parsePartNumber(remanOf).key)
        lines.push(`${ps[i]}: a ${/starter/i.test(fn) ? 'starter' : 'alternator'}, so the reman of ${remanOf} (rule 5)${cond}; base ${base ? `IS in the store as ${base.part_number ?? base.number}` : 'is NOT in the store'}. HELD - reman and OEM-new are related, never merged, and there is no table to link two parts (it needs one: part_relation (part_id, related_part_id, relation 'reman_of' / 'aftermarket_for'))`)
        continue
      }
      if (p.form === 'carrier_reman') { lines.push(`${ps[i]}: an 8 on a Carrier number, and not an alternator or starter - fits no rule. HELD`); continue }
      const notReman = remanOf ? ` (not an alternator or starter, so NOT the reman of ${remanOf} - an ordinary TK number)` : ''
      if (p.form === 'carrier_for_thermo_king') {
        const base = known('Thermo King', parsePartNumber(p.relatesTo!).key)
        lines.push(`${ps[i]}: Carrier aftermarket for TK ${p.relatesTo} (rule 4); ${p.relatesTo} ${base ? 'IS in the store' : 'is NOT in the store'}${p.relatesTo!.startsWith('12-') ? ` (11-${p.relatesTo!.slice(3)} ${known('Thermo King', parsePartNumber('11-' + p.relatesTo!.slice(3)).key) ? 'is' : 'is not'} - see the 11/12 note)` : ''}. HELD - linking needs the part_relation table`)
        continue
      }
      if (p.suffix || shapeMaker(p) !== maker) {
        const tried = [L.vendorPrefix && `stripped prefix ${L.vendorPrefix}`, L.marker && `stripped marker ${L.marker}`, `parsed "${p.canonical}" as ${p.form}${p.shortSegment ? ` (short: ${p.shortSegment})` : ''}`].filter(Boolean).join(', ')
        const why = p.suffix ? `suffix ${p.suffix} is not a rule-7 marker` : shapeMaker(p) && shapeMaker(p) !== maker ? `digits say ${shapeMaker(p)}, the row says ${maker}` : 'fits no rule'
        lines.push(`${ps[i]}: tried ${tried}; failed - ${why}`)
        continue
      }
      // 11-xxxx / 12-xxxx pairs: the 12- number exists nowhere; it reads as the 11- number with 12 in place of 11.
      if (i > 0 && maker === 'Thermo King' && /^12-/.test(p.canonical)) {
        const as11 = '11-' + p.canonical.slice(3)
        const k11 = known(maker, parsePartNumber(as11).key)
        if (!known(maker, p.key)) { lines.push(`${ps[i]}: ${p.canonical} is in no source; it reads as ${as11} with 12 for 11 (${as11} ${k11 ? 'IS in the store' : 'is not in the store'}). HELD - a corrupted number is not loaded`); continue }
      }
      if (chosen && i > 0) {
        const variant = p.canonical.slice(0, -3) === chosen.number.slice(0, -3)
        if (!variant && !known(maker, p.key)) { lines.push(`${ps[i]}: ${p.canonical} fits the rule but how it relates to ${chosen.number} (alias or old number) is not in the source. HELD`); continue }
      }
      const kept = known(maker, p.key)
      if (!kept && oldInNotes.has(`${maker}|${p.key}`)) {
        lines.push(`${ps[i]}: ${p.canonical} fits the rule, but the seed records it as an OLD number ("${oldInNotes.get(`${maker}|${p.key}`)}") with no supersession row. HELD - loading it would show an old number as current`)
        continue
      }
      if (!chosen) chosen = { maker, number: kept ? (kept.part_number ?? kept.number) : p.canonical, key: p.key }
      if (kept) { lines.push(`${ps[i]} -> ${kept.part_number ?? kept.number}${cond}${notReman}: matched to ${store.has(`${maker}|${p.key}`) ? `the store${repairs.some(x => x.to === (kept.part_number ?? kept.number)) ? ' (after its zero is restored)' : ''}` : 'a Source A part'}`); continue }
      if (!isNew) { lines.push(`${ps[i]} -> ${p.canonical}${cond}`); continue }
      // a new part (rule 7: the base, never the condition)
      const desc = L.condition ? fn.replace(/,?\s*\b(rebuilt|rebuild|used)\b/gi, '').replace(/\s{2,}/g, ' ').replace(/^,\s*|,\s*$/g, '').trim() : fn
      const type = r.part_category && r.part_category !== 'Other' ? r.part_category : desc
      if (VENDOR.test(desc)) throw new Error(`vendor name in hd_parts_reference description ${label}`)
      const np: NewPart = { src: SRC_B, maker, number: p.canonical, type, description: desc || null, equipment: null }
      newParts.push(np); added.set(`${maker}|${p.key}`, np); bParts++
      lines.push(`${ps[i]} -> ${p.canonical}${cond}${notReman}: NEW part`)
    }
    // The part a row's crosses and fitment belong to. A retired number hands them on.
    if (chosen) {
      const k = `${chosen.maker}|${chosen.key}`
      if (retired.has(k) && followTo.get(k)) primary.set(cell, { maker, number: followTo.get(k)!, why: `${chosen.number} is superseded by ${followTo.get(k)}` })
      else primary.set(cell, { maker, number: chosen.number, why: '' })
    } else primary.set(cell, null)
    if (isNew && (ps.length > 1 || lines.some(l => !/NEW part$/.test(l) || /condition/.test(l)))) rep('B numbers', `${label}\n      ${lines.join('\n      ')}`)

    // fitment (new numbers only - Source B is the 326)
    if (!isNew || !chosen) continue
    const fam = String(r.unit_family ?? '').trim()
    let f: Fit | null = null
    const base = { src: SRC_B, maker, number: chosen.number, engineCode: null, serialFrom: null, serialBefore: null, dateFrom: null, dateBefore: null, tier: null, conf: null, note: null, how: 'unit_family' }
    if (!fam) { /* none */ }
    else if (!isSingleModel(fam)) bFamily[`list or group: ${fam}`] = (bFamily[`list or group: ${fam}`] ?? 0) + 1
    else if (knownUnits.has(normalizeModel(fam)) && !isFamily(fam) && !knownEngines.has(normalizeModel(fam))) f = { ...base, unit: fam, engineModel: null, match: 'unit_model' }
    else if (knownEngines.has(normalizeModel(fam))) f = { ...base, unit: null, engineModel: fam, match: 'engine' }
    else bFamily[`family or not a known model: ${fam}`] = (bFamily[`family or not a known model: ${fam}`] ?? 0) + 1
    if (f && retired.has(`${maker}|${chosen.key}`)) { rep('B fitment', `HELD  ${chosen.number}: ${fam} - superseded number`); f = null }
    if (f) {
      const ownKept = store.get(`${maker}|${chosen.key}`)
      pushFit(f, `${maker}|${chosen.key}`, ownKept?.id, `${chosen.number}: ${fam}`)
    }
  }

  // B crosses: EVERY reference row, matched to its OEM part.
  for (const r of ref) {
    const vals = REF_CROSS.filter(([col]) => String(r[col] ?? '').trim())
    if (!vals.length || !r.oem_part_number) continue
    const tgt = primary.get(String(r.oem_part_number))
    const label = `${r.oem_part_number}`
    if (!tgt) {
      rep('B crosses', `HELD  ${label}: ${vals.map(([c, b]) => `${b} ${r[c]}`).join(', ')} - the OEM number does not load (see B numbers)`); continue
    }
    const tk = parsePartNumber(tgt.number).key
    const kept = store.get(`${tgt.maker}|${tk}`), nw = added.get(`${tgt.maker}|${tk}`)
    if (!kept && !nw) { rep('B crosses', `HELD  ${label}: OEM part ${tgt.number} is in no table`); continue }
    for (const [col, brand] of vals) {
      for (const v of String(r[col]).split(/\s*[/,;]\s*/).map(x => x.trim()).filter(Boolean)) {
        const c: Cross = { src: SRC_B, maker: tgt.maker, number: kept ? kept.part_number : tgt.number, brand, brandNumber: v, conf: tgt.why ? 'derived' : null, how: tgt.why || 'hd_parts_reference' }
        pushCross(c, kept?.id, `${tgt.number} ${brand} ${v}`, 'B crosses')
        if (tgt.why) rep('B crosses', `CARRIED  ${label} ${brand} ${v} -> ${tgt.number} (${tgt.why})`)
      }
    }
  }

  // ── splits: no fitment that straddles a serial or build-date split ──────────
  const partById = new Map(parts.map(p => [p.id, p]))
  const typeOfFit = (f: Fit) => added.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.type ?? store.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.part_type
  const descOfFit = (f: Fit) => added.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.description ?? store.get(`${f.maker}|${parsePartNumber(f.number).key}`)?.description ?? null
  const funcOfFit = (f: Fit) => funcKey(typeOfFit(f) ?? '', descOfFit(f))
  // A CHANGEOVER (Brock, Oct 29): "each successor runs FROM the same break its predecessor
  // runs BEFORE - no gap and no overlap." A model + job split between exactly TWO parts, one
  // with a single break and one with none, is read that way: the undated part gets the other
  // side of the same break. Anything else - three parts, two different breaks, a part both
  // dated and undated on one model - is not a clean changeover and is held, parts named.
  const NO_CHANGEOVER = new Map<string, string>()
  for (const t of typeConflicts) { const n = t.split(/\s+/)[0]; NO_CHANGEOVER.set(n, `has a part-type disagreement (${t.replace(/\s+/g, ' ').slice(n.length).trim()})`) }
  for (const k of BROCK_HELD) for (const key of k.split('|').slice(1)) {
    const n = [...store.values()].find(p => p.part_number_normalized === key)?.part_number ?? added.get(`Thermo King|${key}`)?.number
    if (n && !NO_CHANGEOVER.has(n)) NO_CHANGEOVER.set(n, 'is in a supersession you are holding')
  }
  type BreakField ='serial_from' | 'serial_before' | 'build_date_from' | 'build_date_before'
  const OPPOSITE: Record<BreakField, BreakField> = { serial_from: 'serial_before', serial_before: 'serial_from', build_date_from: 'build_date_before', build_date_before: 'build_date_from' }
  const loadBreak = (f: Fit): Array<[BreakField, string]> => ([['serial_from', f.serialFrom], ['serial_before', f.serialBefore], ['build_date_from', f.dateFrom], ['build_date_before', f.dateBefore]] as Array<[BreakField, string | null]>).filter((x): x is [BreakField, string] => !!x[1])
  const storeBreak = (f: Record<string, any>): Array<[BreakField, string]> => (['serial_from', 'serial_before', 'build_date_from', 'build_date_before'] as BreakField[]).filter(k => f[k]).map(k => [k, String(f[k])])
  type Side = { number: string; load: Fit[]; storeRows: Record<string, any>[] }
  const groupsBy = new Map<string, Map<string, Side>>()
  const sideOf = (k: string, pk: string, number: string) => {
    const g = groupsBy.get(k) ?? new Map<string, Side>(); groupsBy.set(k, g)
    const s = g.get(pk) ?? { number, load: [], storeRows: [] }; g.set(pk, s); return s
  }
  for (const f of fit) {
    const p = partById.get(f.part_id); if (!p || !f.unit_model) continue
    sideOf(`${p.manufacturer}|${normalizeModel(f.unit_model)}|${funcKey(p.part_type, p.description)}`, p.part_number_normalized, p.part_number).storeRows.push(f)
  }
  for (const f of fits) if (f.unit) sideOf(`${f.maker}|${normalizeModel(f.unit)}|${funcOfFit(f)}`, parsePartNumber(f.number).key, f.number).load.push(f)
  const storeUpdates: Array<{ id: string; number: string; model: string; field: BreakField; value: string }> = []
  const changeovers = new Map<string, { pred: string; succ: string; brk: string; models: string[]; storeRows: number }>()
  const heldRows = new Set<Fit>()
  for (const [k, g] of groupsBy) {
    const sides = [...g.values()].map(s => {
      const brks = [...s.load.map(loadBreak), ...s.storeRows.map(storeBreak)]
      return { s, dated: brks.filter(b => b.length).length, plain: brks.filter(b => !b.length).length,
        distinct: [...new Set(brks.filter(b => b.length).map(b => b.map(([f, v]) => `${f}=${v}`).join('&')))] }
    })
    const anyDated = sides.some(x => x.dated), anyPlain = sides.some(x => x.plain)
    if (!anyDated || !anyPlain) continue                                   // no split here, or already split on every part
    if (sides.length < 2) continue                                         // one part, dated and undated: the with/without check's
    const model = (sides[0].s.load[0]?.unit ?? sides[0].s.storeRows[0]?.unit_model) as string
    const dated = sides.filter(x => x.dated && !x.plain), plain = sides.filter(x => x.plain && !x.dated)
    // A part whose type the store and the seed disagree on, or one of a pair Brock is holding,
    // cannot anchor a changeover: the pairing itself may be the mistake.
    const blocked = sides.map(x => x.s.number).filter(n => NO_CHANGEOVER.has(n))
    const clean = !blocked.length && sides.length === 2 && dated.length === 1 && plain.length === 1 && dated[0].distinct.length === 1 && !dated[0].distinct[0].includes('&')
    if (clean) {
      const [field, value] = dated[0].distinct[0].split('=') as [BreakField, string]
      const give = OPPOSITE[field]
      const succ = plain[0].s
      for (const f of succ.load) {
        if (give === 'serial_from') f.serialFrom = value; else if (give === 'serial_before') f.serialBefore = value
        else if (give === 'build_date_from') f.dateFrom = value; else f.dateBefore = value
        f.how = `${f.how}; changeover: ${give.replace(/_/g, ' ')} ${value} (the other side of ${dated[0].s.number})`
      }
      for (const r of succ.storeRows) storeUpdates.push({ id: r.id, number: succ.number, model: r.unit_model, field: give, value })
      const ck = `${dated[0].s.number}|${succ.number}|${field}=${value}`
      const c = changeovers.get(ck) ?? { pred: dated[0].s.number, succ: succ.number, brk: `${dated[0].s.number} ${field.replace(/_/g, ' ')} ${value}  ->  ${succ.number} ${give.replace(/_/g, ' ')} ${value}`, models: [], storeRows: 0 }
      c.models.push(model); c.storeRows += succ.storeRows.length; changeovers.set(ck, c)
      continue
    }
    // Not a clean changeover: hold every load row on this model + job that the split would straddle.
    const why = sides.map(x => `${x.s.number} ${x.dated ? (x.distinct.join(' / ') || 'dated') : ''}${x.dated && x.plain ? ' + ' : ''}${x.plain ? 'no break' : ''}`).join('; ')
    for (const x of sides) for (const f of x.s.load) {
      const others = sides.filter(o => o !== x)
      if ((splitOf(f) && others.some(o => o.plain)) || (!splitOf(f) && others.some(o => o.dated))) heldRows.add(f)
    }
    rep('Changeovers held', `${k.split('|')[0]} ${model} (${k.split('|')[2]}): ${why} - not a clean changeover (${sides.length} parts${dated.length !== 1 ? `, ${dated.length} dated` : ''}${dated[0] && dated[0].distinct.length > 1 ? ', more than one break' : ''}${blocked.length ? `; ${blocked.map(n => `${n} ${NO_CHANGEOVER.get(n)}`).join('; ')}` : ''})`)
  }
  for (let i = fits.length - 1; i >= 0; i--) if (heldRows.has(fits[i])) { tick(`${fits[i].src === SRC_A ? 'A' : 'B'} fitment: not a clean changeover`); fits.splice(i, 1) }
  for (const c of changeovers.values()) rep('Changeovers dated', `${c.brk}   on ${c.models.length} model(s): ${c.models.join(', ')}${c.storeRows ? `   [${c.storeRows} existing store row(s) get the break]` : ''}`)

  // ── counts ────────────────────────────────────────────────────────────────
  const aFitRows = fits.filter(f => f.src === SRC_A), bFitRows = fits.filter(f => f.src === SRC_B)
  const nEng = newEngines.length, nParts = newParts.length, nFit = fits.length, nSup = newSups.length, nCross = crosses.length
  const crossByBrand = crosses.reduce((m, c) => (m[`${c.brand}`] = (m[`${c.brand}`] ?? 0) + 1, m), {} as Record<string, number>)

  // projected smoke checks
  const filtersFor = (model: string, typeRe: RegExp) => {
    const set = new Set<string>()
    for (const f of fit) { const p = partById.get(f.part_id); if (p && p.manufacturer === 'Carrier Transicold' && typeRe.test(p.part_type) && normalizeModel(f.unit_model ?? '') === model) set.add(p.part_number) }
    for (const f of fits) if (f.maker === 'Carrier Transicold' && normalizeModel(f.unit ?? '') === model && typeRe.test(typeOfFit(f) ?? '')) set.add(f.number)
    return [...set].sort()
  }

  // ═══ SQL ═════════════════════════════════════════════════════════════════════
  const L: string[] = []
  const push = (...s: string[]) => L.push(...s)
  push(
    '-- Load the Oct 23 seed CSVs and hd_parts_reference into the one parts store. GENERATED by',
    '-- scripts/build-seed-reference-sql.ts on ' + new Date().toISOString().slice(0, 10) + ' from the live tables. Every item that does',
    '-- not load as-is - recovered, matched or still held, with the reason - is in',
    '-- scripts/load-seed-and-reference-report.txt.',
    '--',
    '-- ENDS IN ROLLBACK. Read the summary table it prints, then change the last line to',
    '-- COMMIT to keep it. Any check that fails raises an error and nothing is applied.',
    '--',
    `-- store before: ${parts.length} parts, ${fit.length} fitment, ${sup.length} supersessions, ${xr.length} crosses, ${engines.length} engines`,
    `-- adds: ${nParts} parts (A ${aParts}, B ${bParts}), ${nFit} fitment (A ${aFitRows.length}, B ${bFitRows.length}), ${nSup} supersessions, ${nCross} crosses (A ${aCross}, B ${nCross - aCross}), ${nEng} engines`,
    `-- crosses by brand: ${Object.entries(crossByBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(', ')}`,
    '--',
    '-- Trust: verified = false on every row. Source A carries its own confidence; fitment',
    "-- carried from a superseded number is 'derived'; Source B carries none.",
    '-- Not carried: source notes, source_url, unit_series / unit_group / engine_family.',
    `-- Store rows touched, and only these: ${repairs.length} part numbers given their zero back (step 0a) and`,
    `-- ${storeUpdates.length} fitment rows given the other side of a changeover break (step 0b). No part type changes.`,
    '-- Changeovers dated:',
    ...[...changeovers.values()].map(c => `--   ${c.brk}  (${c.models.length} models)`),
    '',
    'BEGIN;',
    '',
    'CREATE TEMP TABLE _ld_before ON COMMIT DROP AS',
    'SELECT (SELECT count(*) FROM public.parts) AS parts, (SELECT count(*) FROM public.part_fitment) AS part_fitment,',
    '       (SELECT count(*) FROM public.part_supersession) AS part_supersession, (SELECT count(*) FROM public.part_cross_reference) AS part_cross_reference,',
    '       (SELECT count(*) FROM public.engines) AS engines;',
    '',
    `-- 0a. Repair ${repairs.length} store number(s) rule 6 now writes with their zero (TK NNN-NNN -> NNN-0NNN).`,
    `-- 0b. Give ${storeUpdates.length} existing store fitment row(s) the other side of a changeover break.`,
    '--     Each row is named by id and must still have no break, or nothing is applied.',
    'DO $$',
    'DECLARE n INTEGER;',
    'BEGIN',
    ...(repairs.length ? [
      `  IF (SELECT count(*) FROM public.parts WHERE (id, part_number) IN (${repairs.map(r => `('${r.id}'::uuid, ${lit(r.from)})`).join(', ')})) <> ${repairs.length} THEN`,
      "    RAISE EXCEPTION 'repair: a store number is not what this file was built against'; END IF;",
      ...repairs.map(r => `  UPDATE public.parts SET part_number = ${lit(r.to)}, updated_at = now() WHERE id = '${r.id}' AND part_number = ${lit(r.from)};`),
      `  IF (SELECT count(*) FROM public.parts WHERE (id, part_number) IN (${repairs.map(r => `('${r.id}'::uuid, ${lit(r.to)})`).join(', ')})) <> ${repairs.length} THEN`,
      "    RAISE EXCEPTION 'repair: not every number was restored'; END IF;"] : []),
    ...(storeUpdates.length ? [
      `  IF (SELECT count(*) FROM public.part_fitment WHERE id IN (${storeUpdates.map(u => `'${u.id}'`).join(', ')})`,
      '        AND serial_from IS NULL AND serial_before IS NULL AND build_date_from IS NULL AND build_date_before IS NULL) <> ' + storeUpdates.length + ' THEN',
      "    RAISE EXCEPTION 'changeover: a store fitment row is missing or already has a break'; END IF;",
      ...storeUpdates.map(u => `  UPDATE public.part_fitment SET ${u.field} = ${lit(u.value)}${u.field.startsWith('build') ? '::date' : ''} WHERE id = '${u.id}';   -- ${u.number} ${u.model}`.replace(/[^\x20-\x7e]/g, '?')),
      `  SELECT count(*) INTO n FROM public.part_fitment WHERE id IN (${storeUpdates.map(u => `'${u.id}'`).join(', ')})`,
      '    AND (serial_from IS NOT NULL OR serial_before IS NOT NULL OR build_date_from IS NOT NULL OR build_date_before IS NOT NULL);',
      `  IF n <> ${storeUpdates.length} THEN RAISE EXCEPTION 'changeover: % of ${storeUpdates.length} store rows got their break', n; END IF;`] : []),
    '  NULL;',
    'END $$;',
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
    '  match_type TEXT, serial_from TEXT, serial_before TEXT, build_date_from DATE, build_date_before DATE, tier TEXT, confidence TEXT, note TEXT) ON COMMIT DROP;',
    'INSERT INTO _ld_fitment VALUES',
    fits.map(f => `  (${lit(f.src)}, ${lit(f.maker)}, ${lit(f.number)}, ${lit(f.unit)}, ${lit(f.engineModel)}, ${lit(f.engineCode)}, ${lit(f.match)}, ${lit(f.serialFrom)}, ${lit(f.serialBefore)}, ${lit(f.dateFrom)}, ${lit(f.dateBefore)}, ${lit(f.tier)}, ${lit(f.conf)}, ${lit(f.note)})`).join(',\n') + ';',
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
    '  IF EXISTS (SELECT 1 FROM _ld_engines e JOIN public.engines x ON x.engine_code = e.engine_code) THEN',
    "    RAISE EXCEPTION 'load: an engine is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_parts f JOIN public.parts p',
    '             ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)) THEN',
    "    RAISE EXCEPTION 'load: a new part is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_parts GROUP BY manufacturer, public.normalize_part_number(part_number) HAVING count(*) > 1) THEN',
    "    RAISE EXCEPTION 'load: a new part is staged twice'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE part_number LIKE '37-%') THEN RAISE EXCEPTION 'load: a 37- number'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE (manufacturer = 'Thermo King' AND part_number !~ '^[0-9]{2,3}-[0-9]{4}$')",
    "             OR (manufacturer = 'Carrier Transicold' AND part_number !~ '^[0-9]{2}-[0-9]{5}-[0-9]{2}$')",
    "             OR manufacturer NOT IN ('Thermo King', 'Carrier Transicold')) THEN",
    "    RAISE EXCEPTION 'load: a number is missing a zero, carries a marker, or does not fit the maker shape'; END IF;",
    "  IF EXISTS (SELECT 1 FROM _ld_parts WHERE description ~* 'napa|reilly|autozone|advance auto|rockauto|fleetpride|amazon|ebay|mincarone|walmart|carquest|swisclima|kingreat|fuerdun|www\\.|https?:')",
    "  OR EXISTS (SELECT 1 FROM _ld_parts WHERE part_type ~* 'napa|reilly|autozone|amazon|ebay|mincarone|carquest|swisclima|kingreat|fuerdun')",
    "  OR EXISTS (SELECT 1 FROM _ld_fitment WHERE note ~* 'napa|reilly|autozone|amazon|ebay|mincarone|carquest|swisclima|kingreat|fuerdun|www\\.|https?:') THEN",
    "    RAISE EXCEPTION 'load: a vendor or retailer name outside a cross brand'; END IF;",
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
    '  -- No fitment onto a retired number: one the store retires, or a confirmed / oem_matrix link here retires.',
    '  IF EXISTS (SELECT 1 FROM _ld_fitment f JOIN public.part_supersession s',
    '             ON s.manufacturer = f.manufacturer AND s.old_number_normalized = public.normalize_part_number(f.part_number))',
    '  OR EXISTS (SELECT 1 FROM _ld_fitment f JOIN _ld_sup s',
    "             ON s.manufacturer = f.manufacturer AND public.normalize_part_number(s.old_number) = public.normalize_part_number(f.part_number)",
    "             AND s.confidence IN ('confirmed', 'oem_matrix')) THEN",
    "    RAISE EXCEPTION 'load: fitment onto a superseded number'; END IF;",
    '  -- No fitment that straddles a split: an unconditional row beside a serial / build-date',
    '  -- split for the same maker + model + part type on another part, or the reverse.',
    '  IF EXISTS (',
    '    WITH staged AS (',
    '      SELECT f.manufacturer, upper(regexp_replace(f.unit_model, \'[^A-Za-z0-9]\', \'\', \'g\')) AS model,',
    `             ${FUNC_SQL('coalesce(p.part_type, n.part_type)', 'coalesce(p.description, n.description)')} AS part_type, public.normalize_part_number(f.part_number) AS pn,`,
    '             (f.serial_from IS NOT NULL OR f.serial_before IS NOT NULL OR f.build_date_from IS NOT NULL OR f.build_date_before IS NOT NULL) AS split',
    '        FROM _ld_fitment f',
    '        LEFT JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)',
    '        LEFT JOIN _ld_parts n ON n.manufacturer = f.manufacturer AND n.part_number = f.part_number',
    '       WHERE f.unit_model IS NOT NULL),',
    '    existing AS (',
    `      SELECT p.manufacturer, upper(regexp_replace(x.unit_model, '[^A-Za-z0-9]', '', 'g')) AS model, ${FUNC_SQL('p.part_type', 'p.description')} AS part_type, p.part_number_normalized AS pn,`,
    '             (x.serial_from IS NOT NULL OR x.serial_before IS NOT NULL OR x.build_date_from IS NOT NULL OR x.build_date_before IS NOT NULL) AS split',
    '        FROM public.part_fitment x JOIN public.parts p ON p.id = x.part_id WHERE x.unit_model IS NOT NULL),',
    '    every AS (SELECT * FROM staged UNION ALL SELECT * FROM existing)',
    '    SELECT 1 FROM staged s JOIN every e ON e.manufacturer = s.manufacturer AND e.model = s.model AND e.part_type = s.part_type',
    '     WHERE e.pn <> s.pn AND e.split <> s.split) THEN',
    "    RAISE EXCEPTION 'load: a fitment row straddles a serial or build-date split'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_sup s JOIN public.part_supersession x ON x.manufacturer = s.manufacturer',
    '             AND x.old_number_normalized = public.normalize_part_number(s.old_number) AND x.new_number_normalized = public.normalize_part_number(s.new_number)) THEN',
    "    RAISE EXCEPTION 'load: a supersession is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_cross c JOIN public.parts p',
    '             ON p.manufacturer = c.manufacturer AND p.part_number_normalized = public.normalize_part_number(c.part_number)',
    '             JOIN public.part_cross_reference x ON x.part_id = p.id AND upper(x.brand) = upper(c.brand)',
    '              AND x.brand_number_normalized = public.normalize_part_number(c.brand_number)) THEN',
    "    RAISE EXCEPTION 'load: a cross is already in the store'; END IF;",
    '  IF EXISTS (SELECT 1 FROM _ld_cross GROUP BY manufacturer, public.normalize_part_number(part_number), upper(brand), public.normalize_part_number(brand_number) HAVING count(*) > 1) THEN',
    "    RAISE EXCEPTION 'load: a cross is staged twice'; END IF;",
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
    '-- 3. fitment',
    'INSERT INTO public.part_fitment (part_id, unit_model, engine_model, engine_code, match_type, serial_from, serial_before,',
    '                                 build_date_from, build_date_before, tier, note, verified, source, confidence)',
    'SELECT p.id, f.unit_model, f.engine_model, f.engine_code, f.match_type, f.serial_from, f.serial_before,',
    '       f.build_date_from, f.build_date_before, f.tier, f.note, FALSE, f.src, f.confidence',
    '  FROM _ld_fitment f',
    '  JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
    '',
    '-- 4. supersessions (Source A)',
    'INSERT INTO public.part_supersession (manufacturer, old_number, new_number, note, verified, source, confidence)',
    `SELECT manufacturer, old_number, new_number, NULL, FALSE, '${SRC_A}', confidence FROM _ld_sup;`,
    '',
    '-- 5. crosses (every brand, retailer house brands included)',
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
    `  IF (SELECT count(*) FROM public.parts WHERE source = '${SRC_A}') <> ${aParts} OR (SELECT count(*) FROM public.parts WHERE source = '${SRC_B}') <> ${bParts} THEN`,
    "    RAISE EXCEPTION 'load: parts per source are not what the plan says'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.parts WHERE source IN ('${SRC_A}', '${SRC_B}') AND (verified OR confidence IS NOT NULL OR notes IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a new part is not verified=false / confidence NULL / notes NULL'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE source IN ('${SRC_A}', '${SRC_B}') AND verified)`,
    `  OR EXISTS (SELECT 1 FROM public.part_cross_reference WHERE source IN ('${SRC_A}', '${SRC_B}') AND verified)`,
    `  OR EXISTS (SELECT 1 FROM public.part_supersession WHERE source = '${SRC_A}' AND (verified OR note IS NOT NULL)) THEN`,
    "    RAISE EXCEPTION 'load: a new row is marked verified'; END IF;",
    `  IF EXISTS (SELECT 1 FROM public.part_fitment WHERE source = '${SRC_B}' AND confidence IS NOT NULL) THEN`,
    "    RAISE EXCEPTION 'load: a Source B fitment row carries a trust tier'; END IF;",
    'END $$;',
    '',
    '-- What it did (this is the table the SQL editor shows).',
    `SELECT 'parts' AS table_name, b.parts AS before, (SELECT count(*) FROM public.parts) AS after, ${nParts} AS planned FROM _ld_before b`,
    `UNION ALL SELECT 'part_fitment', b.part_fitment, (SELECT count(*) FROM public.part_fitment), ${nFit} FROM _ld_before b`,
    `UNION ALL SELECT 'part_supersession', b.part_supersession, (SELECT count(*) FROM public.part_supersession), ${nSup} FROM _ld_before b`,
    `UNION ALL SELECT 'part_cross_reference', b.part_cross_reference, (SELECT count(*) FROM public.part_cross_reference), ${nCross} FROM _ld_before b`,
    `UNION ALL SELECT 'engines', b.engines, (SELECT count(*) FROM public.engines), ${nEng} FROM _ld_before b`,
    `UNION ALL SELECT 'store numbers given their zero back', 0, ${repairs.length ? `(SELECT count(*) FROM public.parts WHERE (id, part_number) IN (${repairs.map(r => `('${r.id}'::uuid, ${lit(r.to)})`).join(', ')}))` : '0'}, ${repairs.length} FROM _ld_before b`,
    `UNION ALL SELECT 'store fitment rows given a changeover break', 0, ${storeUpdates.length ? `(SELECT count(*) FROM public.part_fitment WHERE id IN (${storeUpdates.map(u => `'${u.id}'`).join(', ')}) AND (serial_from IS NOT NULL OR serial_before IS NOT NULL OR build_date_from IS NOT NULL OR build_date_before IS NOT NULL))` : '0'}, ${storeUpdates.length} FROM _ld_before b;`,
    '',
    'ROLLBACK;',
    '',
  )
  fs.writeFileSync(OUT, L.join('\n'), { encoding: 'ascii' })

  // ── the report ────────────────────────────────────────────────────────────
  const T: string[] = []
  T.push(`Seed + reference load - every item that does not load as-is. Generated ${new Date().toISOString().slice(0, 10)}.`,
    `Store before: ${parts.length} parts, ${fit.length} fitment, ${sup.length} supersessions, ${xr.length} crosses, ${engines.length} engines.`,
    `Adds: ${nParts} parts, ${nFit} fitment, ${nSup} supersessions, ${nCross} crosses, ${nEng} engines.`,
    `Crosses by brand: ${Object.entries(crossByBrand).sort((a, b) => b[1] - a[1]).map(([b, n]) => `${b} ${n}`).join(', ')}`,
    `Seed fitment tallies: ${Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('; ')}`,
    `Rule-7 markers stripped in Source B: ${JSON.stringify(conditionTally)}`,
    `Source B unit_family not loaded as fitment (family name or list - cannot answer a model search): ${Object.values(bFamily).reduce((s, n) => s + n, 0)}`,
    ...Object.entries(bFamily).sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${v}  ${k}`),
    `Part type disagreements (store type kept, not changed): ${typeConflicts.length}`, ...typeConflicts.map(t => `    ${t}`), '')
  for (const [s, lines] of Object.entries(R)) { T.push(`== ${s} (${lines.length})`, ...lines.map(l => `  ${l}`), '') }
  fs.writeFileSync(REPORT, T.join('\n').replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '?'), { encoding: 'ascii' })

  console.log(`store ${parts.length}/${fit.length}/${sup.length}/${xr.length}/${engines.length}`)
  console.log(`ADD parts ${nParts} (A ${aParts}, B ${bParts}), fitment ${nFit} (A ${aFitRows.length}, B ${bFitRows.length}), sup ${nSup}, cross ${nCross} (A ${aCross}, B ${nCross - aCross}), engines ${nEng}`)
  console.log('crosses by brand', JSON.stringify(crossByBrand))
  console.log('tally', JSON.stringify(tally))
  console.log('markers', JSON.stringify(conditionTally))
  console.log('report sections', Object.entries(R).map(([k, v]) => `${k} ${v.length}`).join(', '))
  console.log(`Supra 660 filters after: ${filtersFor('SUPRA660', /filter/i).join(', ')}`)
  console.log(`Ultra air filters after: ${filtersFor('ULTRA', /filter - air/i).join(', ')}`)
  console.log(`wrote ${OUT}, ${REPORT}`)
}
main().catch(e => { console.error(e); process.exit(1) })
