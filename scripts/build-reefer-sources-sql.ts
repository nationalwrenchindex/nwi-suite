// npx tsx scripts/build-reefer-sources-sql.ts
//
// READS the live parts store (SELECT only) and the reefer parts sources in
// data/parts-sources/. WRITES, and never touches the database:
//   scripts/reefer-load/NN-*.sql                the load, in run order, each ends in ROLLBACK
//   scripts/reefer-load/REPORT.txt              everything dropped, held or in conflict
//   data/parts-sources/SOURCES.md               source key -> file
//
// Needs migration 181 (source_sheet / source_row, engines.source) applied first.
//
// RULES (CLAUDE.md "Part numbers", and Brock's instructions of Nov 4, 2026)
//   * every number goes through parsePartNumber (listing numbers through parseListingNumber)
//   * a part already in the store is never added again and never edited; what a source
//     knows that the store row lacks (fitment, crosses) is added to the store row
//   * TRUST: every new row is verified = false, confidence 'unconfirmed' - the lowest tier
//     in 175's list - because every source here was scraped or generated. A row whose own
//     source says CONFLICT is 'conflict'. Nothing gets a higher tier from this load.
//   * PROVENANCE: every row records source (a neutral key, never a retailer name),
//     source_sheet and source_row
//   * a part with no description from any source is NOT loaded - reported instead
//   * part_type must be one the store already uses; a name that maps to none is held
//   * cross-references only from the MANUFACTURER of the part; resellers and retailer
//     house brands (NAPA, NAPA Gold, Carquest ...) are dropped and counted
//   * no retailer name and no price is ever written
//   * Brock, Oct 30: 11-7382 / 11-7400 (older Super II, SB-II, SB-III) vs 11-9182 /
//     11-9300 (SB-100..SB-400) split by MODEL FAMILY; the older pair on SB-100..400 and
//     all four on the SL models are held for him
//   * held for Brock earlier and still held: 45-2323 -> 45-2324, 11-9098 -> 11-9341

import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import { loadEnv } from './lib/smoke-session'
import { parsePartNumber, parseListingNumber, partNumberKey, type ParsedPartNumber } from '../src/lib/parts/part-number'
import { normalizeModel } from '../src/lib/parts/search'
import { categoryOf } from '../src/lib/parts/counter'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const DIR = path.join(process.cwd(), 'data/parts-sources')
const OUT = path.join(process.cwd(), 'scripts/reefer-load')
const FIT_PER_FILE = 2000

// ── source keys. Neutral names only - a file's own name may carry a retailer's. ──
const SRC = {
  master:   { key: 'reefer-parts-master',        file: 'Reefer-Parts-Master.xlsx' },
  simple:   { key: 'reefer-parts-simple',        file: 'Reefer-Parts-Simple.xlsx' },
  oem:      { key: 'oem-listing-2026-10-28',     file: 'can-ca-tk-carrier-parts-oem-only.csv' },
  leftOut:  { key: 'oem-listing-left-out',       file: 'can-ca-tk-left-out-rows.csv' },
  filters:  { key: 'tk-filters-crossref',        file: 'tk-filters-crossref.xlsx' },
  byModel:  { key: 'tk-filters-by-model',        file: 'tk-filters-by-model.docx' },
  sParts:   { key: 'seed-parts-2026-10-23',      file: 'seed-parts.csv' },
  sFit:     { key: 'seed-fitment-2026-10-23',    file: 'seed-fitment.csv' },
  sCross:   { key: 'seed-crosses-2026-10-23',    file: 'seed-crosses.csv' },
  sSup:     { key: 'seed-supersessions-2026-10-23', file: 'seed-supersessions.csv' },
  sEng:     { key: 'seed-engines-2026-10-23',    file: 'seed-engines.csv' },
} as const
type SrcName = keyof typeof SRC
type Loc = { src: SrcName; sheet: string | null; row: number }

async function all(t: string, order = 'id'): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${S}/rest/v1/${t}?select=*&order=${order}`, { headers: { ...H, Range: `${f}-${f + 999}` } })
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(`${t}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) break
  }
  return out
}
// Rows of one sheet, each with its row number (header = row 1).
function readSheet(src: SrcName, sheet?: string): Array<{ r: Record<string, string>; loc: Loc }> {
  const f = SRC[src].file
  const wb = XLSX.read(fs.readFileSync(path.join(DIR, f)), { type: 'buffer', raw: f.endsWith('.csv'), codepage: 65001 })
  const sn = sheet ?? wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(wb.Sheets[sn], { defval: '', raw: false })
  return rows.map((r, i) => ({
    r: Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), String(v ?? '').trim()])),
    loc: { src, sheet: f.endsWith('.csv') ? null : sn, row: i + 2 },
  }))
}
const at = (l: Loc) => `${SRC[l.src].key}${l.sheet ? ` / ${l.sheet}` : ''} row ${l.row}`

const mk = (v: string) => /carrier/i.test(v) ? 'Carrier Transicold' : /thermo|^tk$/i.test(v) ? 'Thermo King' : v
const shapeMaker = (p: ParsedPartNumber) => p.form === 'thermo_king' ? 'Thermo King' : p.form === 'carrier' ? 'Carrier Transicold' : null

// Same rule as public.is_single_model.
function isSingleModel(v: string): boolean {
  if (!v.trim()) return false
  if (v.includes(',') || v.includes('/') || v.includes('+')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v)) return false
  if (/[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  return true
}
// Migration 182's rule: as 148, except a + that ENDS a word is a real model (SB-210+).
function isSingleModel182(v: string): boolean {
  if (!v.trim() || v.includes(',') || v.includes('/')) return false
  if (/(^|[^a-z])(series|family|all|various|universal|and|thru|through)([^a-z]|$)/i.test(v)) return false
  if (/[0-9]x{2,}/i.test(v) || /[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)) return false
  if (/(^|[^A-Za-z0-9])\+/.test(v) || /\+\S/.test(v)) return false
  return true
}
// Passes the CHECK but is not a model name a tech would search.
const proseModel = (v: string) => /^[0-9]+$/.test(v) || /[();]/.test(v) || /(^|\s)(to|with|or|up|earlier|units)(\s|$)/i.test(v) || /^tier\b/i.test(v) || /\bengine\b/i.test(v)

// Retailer, reseller and aggregator names. One of these in a description or a note
// stops the build: it may never reach the catalog.
const VENDOR = /napa|o'?reilly|autozone|auto zone|advance auto|rockauto|fleetpride|fleet pride|amazon|ebay|mincarone|walmart|carquest|parts ?authority|can\.ca|swisclima|kingreat|kingclima|fuerdun|total parts|thermo-?by-?products|smithco|mengyang|myriad|fridayparts|friday parts|ct west|motor city|allsize|hattink|tk78|diselmart|wdpart|interstate mcbee|www\.|https?:/i
// Brands that are a retailer's or reseller's own label, never the part's manufacturer.
const RESELLER_BRAND = /^(napa( gold)?|carquest|fridayparts|diselmart|tes|thermo ?by ?products|wdpart|total parts|interstate mcbee|amazon|e-?bay|autozone|o'?reilly|rockauto)$/i
// Manufacturers whose own number is a cross (CLAUDE.md, Nov 3). Spelled as the store spells them.
const MAKERS: Array<[RegExp, string]> = [
  [/^wix$/i, 'WIX'], [/^fleetguard$/i, 'Fleetguard'], [/^donaldson$/i, 'Donaldson'], [/^baldwin$/i, 'Baldwin'],
  [/^woodward$/i, 'Woodward'], [/^facet$/i, 'Facet'], [/^delco( remy)?$/i, 'Delco Remy'], [/^luber[- ]?finer$/i, 'Luber-finer'],
  [/^gates$/i, 'Gates'], [/^dayco$/i, 'Dayco'], [/^bando$/i, 'Bando'], [/^bosch$/i, 'Bosch'], [/^denso$/i, 'Denso'],
  [/^hitachi$/i, 'Hitachi'], [/^continental$/i, 'Continental'], [/^prestolite$/i, 'Prestolite'], [/^leece[- ]?neville$/i, 'Leece-Neville'],
  [/^cummins$/i, 'Cummins'], [/^littelfuse$/i, 'Littelfuse'],
]
const makerBrand = (b: string) => MAKERS.find(([re]) => re.test(b.trim()))?.[1] ?? null

const ascii = (v: string) => v.replace(/°/g, ' deg').replace(/[–—]/g, '-').replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"').replace(/ /g, ' ').replace(/ {2,}/g, ' ').trim()
const lit = (v: string | number | null | undefined) => {
  if (v == null || v === '') return 'NULL'
  if (typeof v === 'number') return String(v)
  const s = ascii(v)
  if (/[^\x20-\x7E]/.test(s)) throw new Error(`non-ASCII in ${JSON.stringify(v)}`)
  return `'${s.replace(/'/g, "''")}'`
}

// ── part types: the store's own words, or held ─────────────────────────────────
// Ordered; first match wins. Every target must already be a part_type in the store - the
// build stops if one is not. A name nothing matches is HELD and listed, never invented.
const TYPE_RULES: Array<[RegExp, string]> = [
  // exact store names first
  [/^(3-way valve part|air filter hose|air filter housing clip|battery charger|battery tray|bearing|belt tensioner|body\/enclosure part|bushing|cap|capacitor|clutch belt \(matched pair\)|clutch\/coupling|compressor drive end cover|compressor oil filter|compressor oil pump|compressor oil reservoir|compressor plate|compressor shaft seal|compressor temperature sensor|compressor valve reed|compressor valve spring|connecting rod|contactor|controller\/electronic module|coolant level sensor\/switch|crankshaft|cylinder head|cylinder sleeve|dipstick|drive coupling\/bushing|egr gas temperature sensor|egr pressure sensor|egr valve|electric motor \(standby\)|electrical component|electrical connector|engine|exhaust clamp|exhaust manifold|exhaust manifold gasket|exhaust temperature sensor|expansion valve \(txv\) retrofit kit|fan assembly|fan blade|fan shaft|fastener|filter kit|fitting|front crankshaft oil seal|fuel filter \(primary\)|fuel filter head|fuel injection pump|fuel pump|fuel rail kit|fuel sensor|fuse|gasket set|gearbox seal|gearbox\/gear part|glow plug|hardware|head gasket|heat exchanger|hose\/tube|hot gas valve|muffler|oil collection bottle|oil level sensor|oil pickup screen|oil pressure switch|piston|pressure regulator valve|pressure relief valve|radiator filler neck|rear crankshaft oil seal|receiver tank|refrigeration compressor oil|seal|sealing washer|service tool|solenoid coil|solenoid valve|spacer|starter|suction screen|temperature sensor|tensioner|thermostat|timing belt kit|transformer|unloader valve|valve cover gasket|valve plate|valve stem seal|vibrasorber|voltage regulator|water pump|wiring harness\/cable|filter - air|filter - fuel|filter - oil \(engine\)|filter - fuel\/water separator)$/i, '='],
  // filters (seed and crossref words, then the listing words)
  [/water separator|fuel \/ water/i, 'Filter - fuel/water separator'],
  [/^filter - fuel strainer$|fuel strainer|fuel sedimenter|fuel pre-filter|in-line fuel filter|^inline fuel filter$|^fuel filter\b/i, 'Filter - fuel'],
  [/^oil filter - compressor$/i, 'Filter - oil (compressor)'],
  [/^oil filter\b/i, 'Filter - oil (engine)'],
  [/^air filter - evaporator fan$/i, 'Filter - return air'],
  [/^(air filter|air cleaner)\b(?!.*housing)/i, 'Filter - air'],
  [/^filter$/i, 'Filter - element'],
  [/^filter-? ?drier/i, 'Drier'],
  // engine and electrical
  [/^alternator\/generator$|^alternator$/i, 'Alternator'],
  [/^alternator voltage regulator$/i, 'Voltage regulator'],
  [/^thermostat \(water\)$/i, 'Thermostat'],
  [/^fuel injector\/nozzle$/i, 'Fuel injector'], [/^fuel injector$/i, 'Fuel injector'],
  [/^fuel solenoid$/i, 'Solenoid - fuel'], [/^throttle\/speed solenoid$/i, 'Solenoid - speed'],
  [/^pilot solenoid valve$/i, 'Solenoid - pilot'],
  [/^(defrost solenoid|defrost damper solenoid)$/i, 'Solenoid - electrical'],
  [/^(fuel solenoid relay|starter relay|relay|relay 1[24]v|mini relay|current relay|defrost relay|overload relay.*)$/i, 'Relay'],
  [/^(contactor kit|remote fan motor contactor)$/i, 'Contactor'],
  [/^controller\/display/i, 'Controller/electronic module'],
  [/^(engine bearing.*|main bearing.*)$/i, 'Bearing'],
  [/^(compressor connecting rod)$/i, 'Connecting rod'], [/^compressor crankshaft$/i, 'Crankshaft'],
  [/^compressor valve plate$/i, 'Valve plate'],
  [/^(compressor discharge temperature sensor.*)$/i, 'Compressor temperature sensor'],
  [/^compressor( - (12v|24v|electric motor|standard size))?$/i, 'Compressor'],
  [/^compressor unloader$/i, 'Unloader valve'],
  [/^(compressor exhaust manifold gasket)$/i, 'Exhaust manifold gasket'],
  [/^(compressor cylinder head gasket|cylinder head gasket)$/i, 'Head gasket'],
  [/^(compressor gasket set 05[gk]|engine gasket kit|egr gasket kit|throttling valve gasket set|service valve gasket kit)$/i, 'Gasket set'],
  [/^(crankshaft oil seal|compressor oil seal|belt tensioner oil seal|fanshaft oil seal)$/i, 'Seal'],
  [/^copper sealing washer\/gasket$/i, 'Sealing washer'],
  [/^o-ring\b/i, 'O-ring'],
  [/^egr cleaning kit$/i, 'EGR'],
  [/gasket/i, 'Gasket'],
  // sensors and switches
  [/^(high pressure cutout switch.*|high pressure switch|low pressure cutout switch.*)$/i, 'Switch - pressure'],
  [/^(pressure transducer.*|discharge pressure transducer|suction pressure transducer|suction pressure sensor|oil pressure sensor)$/i, 'Sensor - pressure'],
  [/^(coolant level sensor|coolant level switch)$/i, 'Coolant level sensor/switch'],
  [/^(oil level switch)$/i, 'Oil level sensor'],
  [/^(engine rpm \(speed\) sensor|rpm sensor)$/i, 'Sensor - rpm'],
  [/^(coolant temperature (sensor|switch)|evaporator coil temperature sensor|return\/discharge air temperature sensor|temperature sensor - .*|temperature sensor kit.*|temperature thermistor.*|thermistor kit)$/i, 'Sensor - temperature'],
  // refrigeration
  [/check valve/i, 'Check valve'],
  [/^expansion valve( - evaporator fan| \(txv\))?$/i, 'Expansion valve (TXV)'],
  [/^(throttling valve|throttling valve kit|throttling valve \(etv\/smv\)|electronic throttling valve \(etv\).*)$/i, 'Throttling valve (ETV/SMV)'],
  [/^(crankcase pressure regulator \(cpr\) valve|cpr valve)$/i, 'CPR valve'],
  [/^compressor pressure relief valve$/i, 'Pressure relief valve'],
  [/solenoid valve coil|unloader valve coil|modulation valve coil/i, 'Solenoid coil'],
  [/^(hot gas solenoid valve.*|refrigerant solenoid valve.*|liquid line solenoid valve|suction line solenoid valve|bypass solenoid valve|defrost solenoid valve|purge solenoid valve)$/i, 'Solenoid valve'],
  [/^(service valve.*|compressor service valve)$/i, 'Service valve'],
  [/^(tank\/receiver)$/i, 'Receiver tank'],
  [/^(vibration absorber.*)$/i, 'Vibrasorber'], [/^vibration mount$/i, 'Mount'],
  [/^(condenser coil.*|condenser\/radiator coil)$/i, 'Condenser/radiator coil'],
  // drives
  [/\bbelt\b/i, 'Belt'],
  [/^(idler adjusting arm|idler arm)$/i, 'Belt tensioner'],
  [/^idler channel/i, 'Hardware'],
  [/pulley|^pulley\/idler$|^overpulley kit/i, 'Pulley'],
  [/^clutch puller$/i, 'Service tool'],
  [/^(clutch shield|clutch stud|clutch snap ring|snap ring \(clutch\)|clutch to compressor stud)$/i, 'Hardware'],
  [/^(clutch|clutch kit|clutch field|condenser fan clutch|electric \(magnetic\) clutch.*)$/i, 'Clutch'],
  [/^(fanshaft|fanshaft assembly.*)$/i, 'Fan shaft'],
  [/^(fan\/blower.*|blower|fan and hub assembly|condenser fan|evaporator fan|radiator fan)$/i, 'Fan assembly'],
  [/^(fan motor( 1[2]v| 24v)?|condenser fan motor|electric\/fan motor - (evaporator fan.*|condenser fan.*))$/i, 'Fan motor'],
  [/^(electric motor,.*|electric\/fan motor - (electric motor.*|compressor.*|jackshaft.*)|fan\/electric motor)$/i, 'Electric motor (standby)'],
]
function mapType(name: string, storeTypes: Set<string>): string | null {
  const n = name.trim()
  for (const [re, t] of TYPE_RULES) {
    if (!re.test(n)) continue
    if (t === '=') return [...storeTypes].find(s => s.toLowerCase() === n.toLowerCase()) ?? null
    return t
  }
  return null
}

// ── serial and build-date breaks ──────────────────────────────────────────────
type Break = { serialFrom?: string; serialBefore?: string; dateFrom?: string; dateBefore?: string }
const yr = (y: string) => y.length === 4 ? Number(y) : (Number(y) >= 50 ? 1900 : 2000) + Number(y)
const day = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`
const quarterStart = (q: number, y: number) => day(y, (q - 1) * 3 + 1)
const afterQuarter = (q: number, y: number) => q === 4 ? day(y + 1, 1) : day(y, q * 3 + 1)
// Seed notes (as the Oct 30 seed builder read them).
function readSeedBreak(note: string): Break | null {
  const b: Break = {}
  let m
  if ((m = note.match(/before SN ([A-Z0-9]+)/i))) b.serialBefore = m[1]
  if ((m = note.match(/s\/n ([A-Z0-9]+)\+/i))) b.serialFrom = m[1]
  if ((m = note.match(/up to Q([1-4]) ([0-9]{4})/i))) b.dateBefore = afterQuarter(Number(m[1]), Number(m[2]))
  if ((m = note.match(/from Q([1-4]) ([0-9]{4})/i))) b.dateFrom = quarterStart(Number(m[1]), Number(m[2]))
  if ((m = note.match(/\b(before|after)\s+([0-9]{1,2})\/([0-9]{2,4})\b/i))) {
    const d = day(yr(m[3]), Number(m[2])); if (/before/i.test(m[1])) b.dateBefore = d; else b.dateFrom = d
  }
  if ((m = note.match(/before '([0-9]{2})\b/))) b.dateBefore = day(yr(m[1]), 1)
  if ((m = note.match(/\b([0-9]{2})\.([0-9]{2})\s*on\b/))) b.dateFrom = day(yr(m[2]), Number(m[1]))
  if ((m = note.match(/up to ([0-9]{2})\.([0-9]{2})\b/))) b.dateBefore = day(yr(m[2]), Number(m[1]))
  return Object.keys(b).length ? b : null
}
const vagueSeedBreak = (note: string) => /\b(early|later)\b/i.test(note) || /\b(SN|S\/N|serial)\b/i.test(note)
  || /\b(before|after|until)\b/i.test(note) || /up to (?![0-9,]+ ?hr)/i.test(note)
// Listing and Master notes: "serial/date break: prior to LFX91068470", "Starting with SN#
// FAR90427529", "date/serial range per source: Q1 2005 - Q3 2009", "Before 6/21".
// A segment whose text after the label holds no date or serial ("w/TK486 Engine", "R134a")
// is not a break and is ignored. A break that cannot be read EXACTLY - "after 2013",
// "Prior to X & after", "Starting with X to Y", anything long - holds the row.
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const nextMonth = (y: number, m: number) => m === 12 ? day(y + 1, 1) : day(y, m + 1)
function readListingBreak(note: string): { brk: Break | null; mentions: boolean; text: string } {
  const SER = '([A-Z]{0,4}[0-9][A-Z0-9]{5,})'
  const segs = note.split(';').map(s => s.trim()).filter(s => /serial|SN#|S\/N|date\/serial|serial\/date|prior to|starting with/i.test(s))
  const relevant = segs.map(s => ({ s, body: s.replace(/^[^:]*:\s*/, '').trim() }))
    .filter(x => /(Q[1-4]\s*[0-9]{4}|[0-9]{1,2}[./][0-9]{2,4}|\b(19|20)[0-9]{2}\b|prior|before|after|starting|newer|depuis|[A-Z]{2,4}[0-9]{6,})/i.test(x.body))
  const text = relevant.map(x => x.s).join('; ')
  if (!relevant.length) return { brk: null, mentions: false, text }
  const b: Break = {}
  for (const { body } of relevant) {
    const t = body.replace(/\s*(THERMO KING|S-Series)\s*$/i, '').trim()
    let m
    if (t.length > 60 || /&\s*after/i.test(t) && /prior|before/i.test(t) || /\bto\s+[A-Z]{0,4}[0-9]{6,}/i.test(t)) return { brk: null, mentions: true, text }
    if ((m = t.match(new RegExp(`^(?:prior(?: to)?|before)\\s+(?:S\\/N:?\\s*|SN#?\\s*)?${SER}$`, 'i')))) b.serialBefore = m[1].toUpperCase()
    else if ((m = t.match(new RegExp(`^starting (?:with|from)\\s+(?:S\\/N:?\\s*|SN#?\\s*)?${SER}$`, 'i')))) b.serialFrom = m[1].toUpperCase()
    else if ((m = t.match(/^Q([1-4])\s*([0-9]{4})\s*-\s*Q([1-4])\s*([0-9]{4})$/i))) { b.dateFrom = quarterStart(+m[1], +m[2]); b.dateBefore = afterQuarter(+m[3], +m[4]) }
    else if ((m = t.match(/^Q([1-4])\s*([0-9]{4})\s*-$/i))) b.dateFrom = quarterStart(+m[1], +m[2])
    else if ((m = t.match(/^-\s*Q([1-4])\s*([0-9]{4})$/i))) b.dateBefore = afterQuarter(+m[1], +m[2])
    else if ((m = t.match(/^([0-9]{2})\.([0-9]{2})\s*-$/))) b.dateFrom = day(yr(m[2]), +m[1])
    else if ((m = t.match(/^-\s*([0-9]{2})\.([0-9]{2})$/))) b.dateBefore = nextMonth(yr(m[2]), +m[1])
    else if ((m = t.match(/^before\s+([0-9]{1,2})\/([0-9]{2,4})$/i))) b.dateBefore = day(yr(m[2]), +m[1])
    else if ((m = t.match(/^(?:after\s+([0-9]{1,2})\/([0-9]{2,4})|([0-9]{1,2})\/([0-9]{2,4})\s*&\s*after)$/i))) b.dateFrom = day(yr(m[2] ?? m[4]), +(m[1] ?? m[3]))
    else if ((m = t.match(/^([A-Za-z]{3})[a-z]*\s+([0-9]{2,4})\s*&\s*after$/i)) && MONTHS[m[1].toLowerCase()]) b.dateFrom = day(yr(m[2]), MONTHS[m[1].toLowerCase()])
    else if ((m = t.match(/^before\s+((?:19|20)[0-9]{2})$/i))) b.dateBefore = day(+m[1], 1)
    else if ((m = t.match(/^((?:19|20)[0-9]{2})\s+and\s+newer$/i))) b.dateFrom = day(+m[1], 1)
    else return { brk: null, mentions: true, text }
  }
  return { brk: Object.keys(b).length ? b : null, mentions: true, text }
}

// ── engine designations ───────────────────────────────────────────────────────
// A designation as printed, minus the maker word in front of it. Spaces and dashes are
// dropped for matching (CT4-134-DI is CT4-134DI); dots are NOT - TK3.74 and TK374 stay two
// designations, as the sources print them.
const engineKey = (v: string) => v.toUpperCase().replace(/^(ISUZU|YANMAR|MERCEDES(-BENZ)?|PEUGEOT( \(PSA\))?|KUBOTA)\s+/, '').replace(/[\s-]+/g, '')
function engineTokens(cell: string): string[] {
  const out: string[] = []
  for (const seg of cell.replace(/([^()]*)/g, ' ').split(';')) {
    const s = seg.trim().replace(/s{2,}/g, ' ')
    if (!s || /none found|n\/a|same engines as|engine for some/i.test(s)) continue
    const body = s.replace(/^(Yanmar|Isuzu|Mercedes|Peugeot \(PSA\)|Peugeot)\s+/i, (w) => `${w}`)
    const maker = (body.match(/^(Yanmar|Isuzu|Mercedes|Peugeot)/i) ?? [])[1] ?? ''
    const rest = body.replace(/^(Yanmar|Isuzu|Mercedes|Peugeot \(PSA\)|Peugeot)\s+/i, '')
    for (const t of rest.split(/\s*,\s*|\s+\/\s+|\s+or\s+/)) {
      const code = t.replace(/\(.*?\)/g, '').replace(/^(Isuzu|Yanmar|Mercedes|Peugeot)\s+/i, '').trim()
      if (code) out.push(maker && !/^(TK|DV|3TN|CT)/i.test(code) ? `${maker} ${code}` : code)
    }
  }
  return out
}

type NewPart = { maker: string; number: string; key: string; type: string; description: string; loc: Loc; conf: string }
type Fit = { maker: string; number: string; key: string; unit: string | null; engineModel: string | null; engineCode: string | null
  match: 'unit_model' | 'engine'; serialFrom: string | null; serialBefore: string | null; dateFrom: string | null; dateBefore: string | null
  tier: string | null; note: string | null; conf: string; loc: Loc }
type Cross = { maker: string; number: string; key: string; brand: string; brandNumber: string; conf: string; loc: Loc }
type Sup = { maker: string; old: string; neu: string; note: string | null; conf: string; loc: Loc }
type Engine = { code: string; maker: string | null; base: string | null; tier: string | null; conf: string; loc: Loc }

async function main() {
  const [parts, fit, sup, xr, engines] = await Promise.all([
    all('parts'), all('part_fitment'), all('part_supersession'), all('part_cross_reference'), all('engines', 'engine_code'),
  ])
  const storeTypes = new Set(parts.map(p => String(p.part_type)))
  for (const [, t] of TYPE_RULES) if (t !== '=' && !storeTypes.has(t)) throw new Error(`type rule target "${t}" is not a store part_type`)

  // ── the report ──
  const R: Record<string, string[]> = {}
  const rep = (section: string, line: string) => { (R[section] ??= []).push(line) }
  const T: Record<string, number> = {}
  const tick = (k: string, n = 1) => { T[k] = (T[k] ?? 0) + n }

  // ── the store, keyed by the CANONICAL number (so a stored 107-349 is 107-0349) ──
  const store = new Map<string, Record<string, any>>()
  for (const p of parts) {
    const c = parsePartNumber(p.part_number)
    if (c.canonical !== p.part_number) rep('Store numbers the rules now write differently (NOT changed by this load)', `${p.part_number} (${p.manufacturer}) reads as ${c.canonical} - matched under that number; its stored spelling is left alone`)
    store.set(`${p.manufacturer}|${c.key}`, p)
  }
  const storeRawKey = new Map(parts.map(p => [`${p.manufacturer}|${p.part_number_normalized}`, p]))
  const storeByAnyMaker = new Map<string, Record<string, any>[]>()
  for (const p of parts) { const k = parsePartNumber(p.part_number).key; storeByAnyMaker.set(k, [...(storeByAnyMaker.get(k) ?? []), p]) }
  const storeFit = new Map<string, Array<{ u: string; e: string; brk: boolean }>>()
  for (const f of fit) storeFit.set(f.part_id, [...(storeFit.get(f.part_id) ?? []), {
    u: normalizeModel(f.unit_model ?? ''), e: normalizeModel(f.engine_code ?? f.engine_model ?? ''),
    brk: !!(f.serial_from || f.serial_before || f.build_date_from || f.build_date_before) }])
  const storeCross = new Set(xr.map(x => `${x.part_id}|${String(x.brand).toUpperCase()}|${normalizeModel(x.brand_number)}`))
  const storeSup = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}|${s.new_number_normalized}`))
  const retired = new Set(sup.map(s => `${s.manufacturer}|${s.old_number_normalized}`))

  // ── per-source tallies ──
  const seenNums: Record<string, Set<string>> = {}
  const blankDesc: Record<string, string[]> = {}
  const rowsRead: Record<string, number> = {}
  const noteNum = (src: SrcName, maker: string, key: string) => (seenNums[src] ??= new Set()).add(`${maker}|${key}`)

  // ── candidate parts from every source, in precedence order ──
  type Cand = { maker: string; p: ParsedPartNumber; name: string; description: string; loc: Loc; reman: boolean }
  const cands = new Map<string, Cand[]>()
  const heldParts = new Map<string, string>()   // maker|key -> reason
  const addCand = (c: Cand) => { const k = `${c.maker}|${c.p.key}`; cands.set(k, [...(cands.get(k) ?? []), c]) }
  // Shared number intake: rule 7 markers off, every rule applied, maker checked.
  const intake = (src: SrcName, makerRaw: string, raw: string, name: string, desc: string, loc: Loc, listing: boolean, partClass: string) => {
    const maker = mk(makerRaw)
    const L = listing ? parseListingNumber(raw) : null
    if (L?.marker || L?.vendorPrefix) tick(`listing marker stripped (rule 7) [${SRC[src].key}]: ${L.vendorPrefix ? L.vendorPrefix + '- prefix' : L.marker}`)
    const p = L ? L.base : parsePartNumber(raw)
    if (!p.key) return null
    noteNum(src, maker, p.key)
    const k = `${maker}|${p.key}`
    const label = `${raw} (${at(loc)})`
    if (!desc) { (blankDesc[src] ??= []).push(`${raw}${name ? ` (type "${name}" only)` : ''} - ${at(loc)}`) }
    if (p.suffix) { heldParts.set(k, heldParts.get(k) ?? `suffix ${p.suffix} is not one of the rules: ${label}`); return null }
    if (p.form === 'carrier_for_thermo_king') { heldParts.set(k, heldParts.get(k) ?? `20- = Carrier aftermarket for TK ${p.relatesTo} (rule 4); linking needs a part_relation table: ${label}`); return null }
    if (p.form === 'carrier_reman') { heldParts.set(k, heldParts.get(k) ?? `an 8 on a Carrier number - fits no rule: ${label}`); return null }
    const sm = shapeMaker(p)
    if (!sm) { heldParts.set(k, heldParts.get(k) ?? `fits no numbering rule (${p.form}${p.shortSegment ? `; ${p.shortSegment}` : ''}): ${label}`); return null }
    if (sm !== maker) { heldParts.set(k, heldParts.get(k) ?? `the row says ${maker}, the digits say ${sm}: ${label}`); return null }
    const reman = !!p.remanOf && /alternator|starter/i.test(`${partClass} ${name}`)
    addCand({ maker, p, name, description: desc, loc, reman })
    return { maker, p, k }
  }

  // ═══ SEEDS (Oct 23) ═══════════════════════════════════════════════════════════
  const sp = readSheet('sParts'), sf = readSheet('sFit'), sc = readSheet('sCross'), ss = readSheet('sSup'), se = readSheet('sEng')
  rowsRead.sParts = sp.length; rowsRead.sFit = sf.length; rowsRead.sCross = sc.length; rowsRead.sSup = ss.length; rowsRead.sEng = se.length
  const seedStatus = new Map<string, string>()
  for (const { r, loc } of sp) {
    const got = intake('sParts', r.maker, r.part_number, r.part_type, r.description, loc, false, `${r.part_category} ${r.part_type}`)
    if (got) seedStatus.set(got.k, r.status)
  }

  // ═══ TK FILTERS CROSSREF ═════════════════════════════════════════════════════
  const fx = readSheet('filters', 'Crossref'), fb = readSheet('filters', 'By model'), fe = readSheet('filters', 'Engines')
  rowsRead.filters = fx.length + fb.length + fe.length
  for (const { r, loc } of fx) intake('filters', 'Thermo King', r['TK PN'], r['Filter type'], r['Filter type'], loc, false, 'filter')

  // ═══ MASTER (Simple is a strict subset - measured, not loaded twice) ══════════
  const master = readSheet('master', 'All Parts'); rowsRead.master = master.length
  for (const { r, loc } of master) intake('master', r.maker, r.part_number, r.part_name, [r.part_name, r.description].filter(Boolean).join(' - '), loc, true, r.part_category)
  const simple = readSheet('simple', 'All'); rowsRead.simple = simple.length
  for (const { r, loc } of simple) {
    const p = parsePartNumber(r['Part Number']); const maker = mk(r.Make)
    noteNum('simple', maker, p.key)
    if (!r['Part Description']) (blankDesc.simple ??= []).push(`${r['Part Number']} - ${at(loc)}`)
  }

  // ═══ OEM LISTINGS ═════════════════════════════════════════════════════════════
  const oem = readSheet('oem'), lo = readSheet('leftOut')
  rowsRead.oem = oem.length; rowsRead.leftOut = lo.length
  for (const { r, loc } of oem) intake('oem', r.maker, r.part_number, r.part_name, [r.part_name, r.description].filter(Boolean).join(' - '), loc, true, r.part_category)
  for (const { r, loc } of lo) intake('leftOut', r.maker, r.part_number, r.part_name, [r.part_name, r.description].filter(Boolean).join(' - '), loc, true, r.part_category)

  // ═══ DOCX (prose copy of the By model sheet) ══════════════════════════════════
  const zip = await JSZip.loadAsync(fs.readFileSync(path.join(DIR, SRC.byModel.file)))
  const docLines = (await zip.file('word/document.xml')!.async('string')).split(/<\/w:p>/).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean)
  rowsRead.byModel = docLines.length
  for (const l of docLines) {
    const m = l.match(/^([0-9]{2,3}-?[0-9]{3,4}|[0-9]{6})\s+-\s+/)
    if (m) noteNum('byModel', 'Thermo King', parsePartNumber(m[1]).key)
  }

  // ── decide each part: one row per number, first source in precedence wins ──
  const newParts: NewPart[] = []
  const added = new Map<string, NewPart>()
  const conflicts: string[] = []
  const typeUnmapped = new Map<string, number>()
  const typeConflictStore: string[] = []
  const remanLoaded: string[] = []

  for (const [k, why] of heldParts) if (!store.has(k)) { rep('Parts held (number rules)', why); tick('parts held: number rules') }
  for (const [k, list] of cands) {
    if (heldParts.has(k)) continue
    const kept = store.get(k)
    const types = list.map(c => ({ c, t: mapType(c.name, storeTypes) }))
    const mapped = [...new Set(types.map(x => x.t).filter(Boolean) as string[])]
    if (kept) {
      if (mapped.length && !mapped.includes(kept.part_type)) typeConflictStore.push(`${kept.part_number} store "${kept.part_type}" vs sources ${mapped.map(t => `"${t}"`).join(', ')} (${list.slice(0, 3).map(c => at(c.loc)).join('; ')})`)
      continue
    }
    // The database matches on plain normalization (dashes out), so a new number can collide
    // with a store number that reads as a different part under the rules: new 20-3799 vs
    // store 203-799 (which rule 6 reads as 203-0799). Which one the source meant is not
    // knowable from the number, and the unique key would refuse the insert anyway.
    const raw = storeRawKey.get(`${list[0].maker}|${partNumberKey(list[0].p.canonical)}`)
    if (raw) { conflicts.push(`${list[0].p.canonical} (${at(list[0].loc)}, "${list[0].name}"): the database reads it as the same number as store ${raw.part_number} ("${raw.part_type}") - NOT loaded; which part the source meant is yours`); tick('parts held: collides with a store number'); continue }
    // The part loads from the first source row (in precedence order) that gives BOTH a
    // description and a type the store already uses - never a description borrowed from
    // the type word, never a type guessed from the description.
    if (!list.some(c => c.description)) { rep('Parts not loaded: no description in any source', `${list[0].p.canonical} (${list[0].maker}) - ${list.map(c => at(c.loc)).slice(0, 3).join('; ')}`); tick('parts held: no description'); continue }
    const winner = types.find(x => x.t && x.c.description)
    if (!winner) {
      for (const n of new Set(list.map(c => c.name))) typeUnmapped.set(n, (typeUnmapped.get(n) ?? 0) + 1)
      rep('Parts held: no existing part_type fits', `${list[0].p.canonical} "${list[0].name}" - ${at(list[0].loc)}`); tick('parts held: no category'); continue
    }
    if (mapped.length > 1) conflicts.push(`${winner.c.p.canonical}: sources map to ${mapped.map(t => `"${t}"`).join(' / ')} - loaded as "${winner.t}" from ${at(winner.c.loc)}; others: ${types.filter(x => x.t && x.t !== winner.t).slice(0, 3).map(x => `${at(x.c.loc)} "${x.c.name}"`).join('; ')}`)
    if (list.some(c => c.reman)) remanLoaded.push(`${winner.c.p.canonical} (${winner.t}) is the reman of ${winner.c.p.remanOf} - loaded as its own part; the link needs a part_relation table`)
    const np: NewPart = { maker: winner.c.maker, number: winner.c.p.canonical, key: winner.c.p.key, type: winner.t!, description: ascii(winner.c.description), loc: winner.c.loc, conf: 'unconfirmed' }
    if (VENDOR.test(np.description)) throw new Error(`a retailer or vendor name in a description - stop: ${np.number} "${np.description}"`)
    newParts.push(np); added.set(k, np)
  }
  // which source each new number came from
  const firstSrc = new Map(newParts.map(p => [`${p.maker}|${p.key}`, p.loc.src]))

  // A part a row can attach to: the store's, or one this load adds. Store rows keep their
  // printed number so the SQL join finds them.
  const target = (maker: string, p: ParsedPartNumber) => {
    const k = `${maker}|${p.key}`
    const kept = store.get(k)
    if (kept) return { k, number: kept.part_number as string, id: kept.id as string, isNew: false }
    const nw = added.get(k)
    if (nw) return { k, number: nw.number, id: undefined, isNew: true }
    return null
  }

  // ═══ ENGINES ══════════════════════════════════════════════════════════════════
  const newEngines: Engine[] = []
  const engineByKey = new Map<string, Engine | { code: string }>()
  for (const e of engines) engineByKey.set(engineKey(e.engine_code), { code: e.engine_code })
  for (const { r, loc } of se) {
    const k = engineKey(r.engine_code)
    if (engineByKey.has(k)) { rep('Engines', `DUPLICATE ${r.engine_code} - ${at(loc)}`); continue }
    const e: Engine = { code: r.engine_code.trim(), maker: r.engine_maker || null, base: r.base_engine || null, tier: r.tier || null, conf: 'unconfirmed', loc }
    newEngines.push(e); engineByKey.set(k, e)
  }
  for (const { r, loc } of fe) {
    const base = r['Base maker']
    const conflict = /CONFLICT/.test(r.Status)
    for (const tok of r['TK engine designation'].split(/\s*,\s*|\s+\/\s+/)) {
      const tier = (tok.match(/\((Tier [^)]+)\)/i) ?? [])[1] ?? null
      const raw = tok.replace(/\(.*?\)/g, '').trim()
      const maker = (raw.match(/^(Isuzu|Mercedes)/i) ?? [])[1]
      const code = raw.replace(/^(Isuzu|Mercedes)\s+/i, '').replace(/\s+/g, '')
      if (!code) continue
      const k = engineKey(code)
      const ex = engineByKey.get(k)
      const myBase = maker ? (/mercedes/i.test(maker) ? 'Mercedes-Benz' : 'Isuzu') : base.replace(/\s*\(.*\)$/, '')
      if (ex) {
        const eb = 'base' in ex ? (ex as Engine).base : null
        if (eb && myBase && eb.split(/[\s(]/)[0].toLowerCase() !== myBase.split(/[\s(]/)[0].toLowerCase())
          conflicts.push(`engine ${code}: base maker "${eb}" (${at((ex as Engine).loc)}) vs "${myBase}" (${at(loc)}) - kept the first`)
        continue
      }
      const e: Engine = { code, maker: /^(TK|3TN|DV6)/i.test(code) ? 'Thermo King' : null, base: myBase || null, tier, conf: conflict ? 'conflict' : 'unconfirmed', loc }
      newEngines.push(e); engineByKey.set(k, e)
    }
  }
  // A bracketed maker is not part of the designation: "TKDV6 (Peugeot)" is TKDV6.
  const engineCodeFor = (text: string): string | null => { const e = engineByKey.get(engineKey(text.replace(/\s*\([^()]*\)\s*$/, ''))); return e ? e.code : null }

  // ═══ SUPERSESSIONS ════════════════════════════════════════════════════════════
  const BROCK_HELD = new Set(['Thermo King|452323|452324', 'Thermo King|119098|119341'])
  const newSups: Sup[] = []
  const supKey = (maker: string, o: string, n: string) => `${maker}|${parsePartNumber(o).key}|${parsePartNumber(n).key}`
  const addSup = (maker: string, oldRaw: string, newRaw: string, loc: Loc, note: string | null, conf = 'unconfirmed') => {
    const o = parseListingNumber(oldRaw).base, n = parseListingNumber(newRaw).base
    const label = `${oldRaw} -> ${newRaw} (${at(loc)})`
    if (BROCK_HELD.has(`${maker}|${o.key}|${n.key}`)) { rep('Supersessions held', `${label} - held for you since Oct 28`); return }
    if (o.suffix || n.suffix || shapeMaker(o) !== maker || shapeMaker(n) !== maker) { rep('Supersessions held', `${label} - a number fits no rule`); return }
    if (o.key === n.key) return
    const k = supKey(maker, o.canonical, n.canonical)
    if (storeSup.has(k) || newSups.some(s => supKey(s.maker, s.old, s.neu) === k)) return
    newSups.push({ maker, old: o.canonical, neu: n.canonical, note, conf, loc })
  }
  for (const { r, loc } of ss) addSup(mk(r.maker), r.old_part, r.new_part, loc, null)
  for (const { r, loc } of fx) {
    if (r.Supersedes) for (const o of r.Supersedes.split(/\s*[,/]\s*/)) addSup('Thermo King', o, r['TK PN'], loc, null)
    if (r['Superseded by']) for (const n of r['Superseded by'].split(/\s*[,/]\s*/)) addSup('Thermo King', r['TK PN'], n, loc, null)
  }
  for (const { r, loc } of master) {
    for (const m of r.other_crosses.matchAll(/Thermo King previous no\.\s*([0-9-]+)/gi)) addSup('Thermo King', m[1], r.part_number, loc, null)
  }
  // A link this load adds is unconfirmed, and the counter follows only confirmed and
  // oem_matrix links - so it retires nothing. Only the store's own links hold fitment back.

  // ═══ FITMENT ══════════════════════════════════════════════════════════════════
  const fits: Fit[] = []
  const fitSeen = new Set<string>()
  const brkOf = (b: Break | null) => ({ serialFrom: b?.serialFrom ?? null, serialBefore: b?.serialBefore ?? null, dateFrom: b?.dateFrom ?? null, dateBefore: b?.dateBefore ?? null })
  const OLDER_FILTER = new Set(['11-7382', '11-7400'])
  const FAMILY_SPLIT = new Set([...OLDER_FILTER, '11-9182', '11-9300'])
  // By FAMILY, so every variant counts: SB-210+, SB-210 Multi-Temp, SB-230 (SB-100 through
  // SB-400), Spectrum DE 2. The SL family is SL-100..SL-400 (and their e versions), SL TCI
  // and Spectrum SL - never SLX / SLXe / SLXi, which are their own family.
  const NEWER_SB = (m: string) => /^SB-[1-4][0-9]0(?![0-9])/i.test(m) || /^(SB Classic|Spectrum SB|Spectrum DE)\b/i.test(m)
  const SL_MODELS = (m: string) => /^SL-[1-4]00(?![0-9])/i.test(m) || /^SL TCI\b/i.test(m) || /^Spectrum SL\b/i.test(m)
  const YANMAR_ON_NEWER = /^TK48[26]/i
  const plusFits: Fit[] = []
  const pushFit = (src: string, maker: string, raw: string, f: Omit<Fit, 'maker' | 'number' | 'key'>, into: Fit[] = fits): boolean => {
    const p = parseListingNumber(raw).base
    const t = target(maker, p)
    const label = `${p.canonical}: ${f.unit ?? f.engineCode ?? f.engineModel} (${at(f.loc)})`
    if (!t) { tick(`fitment held: part not loaded [${src}]`); return false }
    if (retired.has(t.k)) { tick(`fitment held: onto a superseded number [${src}]`); rep('Fitment held: onto a superseded number', label); return false }
    if (FAMILY_SPLIT.has(p.canonical) && f.unit) {
      const m = f.unit.trim()
      if (OLDER_FILTER.has(p.canonical) && NEWER_SB(m)) { tick('fitment held: older filter on a newer SB (Brock, Oct 30)'); rep('Model family (Brock, Oct 30)', `${label} - SB-100 to SB-400 take 11-9182 / 11-9300`); return false }
      if (SL_MODELS(m)) { tick('fitment held: SL question (Brock, Oct 30)'); rep('Model family (Brock, Oct 30)', `${label} - the SL question is yours`); return false }
    }
    if (OLDER_FILTER.has(p.canonical) && f.match === 'engine' && YANMAR_ON_NEWER.test(f.engineCode ?? f.engineModel ?? '')) {
      tick('fitment held: older filter by a Yanmar engine the newer SB also uses (Brock, Oct 30)')
      rep('Model family (Brock, Oct 30)', `${label} - an engine row would put the older filter on every SB-100..400 with that engine`); return false
    }
    const key = `${t.k}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? f.engineModel ?? '')}|${f.serialFrom ?? ''}|${f.serialBefore ?? ''}|${f.dateFrom ?? ''}|${f.dateBefore ?? ''}`
    if (fitSeen.has(key)) { tick(`fitment: repeated across sources [${src}]`); return false }
    fitSeen.add(key)
    const have = t.id ? (storeFit.get(t.id) ?? []) : []
    const u = normalizeModel(f.unit ?? ''), e = normalizeModel(f.engineCode ?? f.engineModel ?? '')
    if (u ? have.some(h => h.u === u) : have.some(h => h.e === e)) { tick(`fitment: already in the store [${src}]`); return false }
    into.push({ ...f, maker, number: t.number, key: p.key })
    return true
  }

  // seed fitment - the Oct 30 builder's rules, at today's tier
  for (const { r, loc } of sf) {
    const maker = mk(r.maker)
    const note = r.source_note ?? ''
    const model = r.unit_model || r.engine_code
    const label = `${r.part_number}: ${model} (${at(loc)})`
    if (r.match_type === 'unit_model') {
      if (!r.unit_model) { tick('fitment held: group or prose model [seed]'); rep('Fitment held: group or prose model', `${r.part_number}: "${r.unit_group || r.unit_series}" (${at(loc)})`); continue }
      if (!isSingleModel(r.unit_model) || proseModel(r.unit_model)) { tick('fitment held: group or prose model [seed]'); rep('Fitment held: group or prose model', label); continue }
    } else if (r.match_type === 'engine') {
      if (!engineCodeFor(r.engine_code)) { tick('fitment held: engine not in engines [seed]'); rep('Fitment held: engine code unknown', label); continue }
    } else { tick('fitment held: unknown match type [seed]'); continue }
    const own = note.match(/;\s*([A-Za-z0-9 /-]+?) use ([0-9]{2}-[0-9]{3,4}) /)
    if (own && r.unit_model && own[1].split('/').map(s => normalizeModel(s)).includes(normalizeModel(r.unit_model))) { tick('fitment held: own note names another part [seed]'); rep('Fitment held: the row names another part', `${label} - "${note.slice(0, 90)}"`); continue }
    const brk = readSeedBreak(note)
    if (/superseded by|replaced by/i.test(note) && !brk) { tick('fitment held: note says superseded [seed]'); rep('Fitment held: note says superseded', `${label} - "${note.slice(0, 80)}"`); continue }
    if (!brk && vagueSeedBreak(note) && !/up to [0-9,]+ ?hr/i.test(note)) { tick('fitment held: break with no serial or date'); rep('Fitment held: a break with no serial or date', `${label} - "${note.slice(0, 80)}"`); continue }
    const b = brkOf(brk)
    pushFit('seed', maker, r.part_number, {
      unit: r.match_type === 'unit_model' ? r.unit_model : null, engineModel: null,
      engineCode: r.match_type === 'engine' ? engineCodeFor(r.engine_code) : null,
      match: r.match_type === 'engine' ? 'engine' : 'unit_model',
      serialFrom: r.serial_from || b.serialFrom, serialBefore: r.serial_before || b.serialBefore, dateFrom: b.dateFrom, dateBefore: b.dateBefore,
      tier: r.tier || null, note: null, conf: /CONFLICT/.test(note) ? 'conflict' : 'unconfirmed', loc,
    })
  }

  // master fitment
  const engineMiss = new Map<string, number>()
  const groupModels = new Map<string, number>()
  for (const { r, loc } of master) {
    const unit = r.unit_model, eng = r.engine_model
    if (!unit && !eng) continue
    const { brk, mentions, text } = readListingBreak(r.notes)
    if (mentions && !brk) { tick('fitment held: break with no serial or date'); rep('Fitment held: a break with no serial or date', `${r.part_number}: ${unit || eng} (${at(loc)}) - "${text.slice(0, 90)}"`); continue }
    const plus = !!unit && !isSingleModel(unit) && isSingleModel182(unit) && !proseModel(unit)
    if (unit && !plus && (!isSingleModel(unit) || proseModel(unit))) { groupModels.set(unit, (groupModels.get(unit) ?? 0) + 1); tick('fitment held: group or prose model [master]'); continue }
    // Engine text loads only when it IS an engine designation; the column also holds "DI",
    // "TriPac Tier 2" and genset model names, which are not.
    const engOk = eng && isSingleModel(eng) && !proseModel(eng) && engineCodeFor(eng) ? eng : null
    if (eng && !engOk) engineMiss.set(eng, (engineMiss.get(eng) ?? 0) + 1)
    if (eng && !engOk) tick(unit ? 'fitment: engine text dropped - not an engine designation (unit row kept) [master]' : 'fitment held: engine text is not an engine designation [master]')
    if (!unit && !engOk) continue
    const b = brkOf(brk)
    pushFit('master', mk(r.maker), r.part_number, {
      unit: unit || null, engineModel: unit ? engOk : null, engineCode: engOk ? engineCodeFor(engOk) : null,
      match: unit ? 'unit_model' : 'engine', ...b, tier: null, note: null, conf: 'unconfirmed', loc,
    }, plus ? plusFits : fits)
  }

  // OEM listing fitment (most already loaded Oct 29 - only what the store lacks)
  for (const [src, rows] of [['oem', oem], ['leftOut', lo]] as const) {
    for (const { r, loc } of rows) {
      const unit = r.unit_model, eng = r.engine_model
      if (!unit && !eng) continue
      const { brk, mentions, text } = readListingBreak(r.notes)
      if (mentions && !brk) { tick('fitment held: break with no serial or date'); rep('Fitment held: a break with no serial or date', `${r.part_number}: ${unit || eng} (${at(loc)}) - "${text.slice(0, 90)}"`); continue }
      const plus = !!unit && !isSingleModel(unit) && isSingleModel182(unit) && !proseModel(unit)
      if (unit && !plus && (!isSingleModel(unit) || proseModel(unit))) { groupModels.set(unit, (groupModels.get(unit) ?? 0) + 1); tick(`fitment held: group or prose model [${src}]`); continue }
      const engOk = eng && isSingleModel(eng) && !proseModel(eng) && engineCodeFor(eng) ? eng : null
      if (eng && !engOk) engineMiss.set(eng, (engineMiss.get(eng) ?? 0) + 1)
      if (eng && !engOk) tick(unit ? `fitment: engine text dropped - not an engine designation (unit row kept) [${src}]` : `fitment held: engine text is not an engine designation [${src}]`)
      if (!unit && !engOk) continue
      const b = brkOf(brk)
      pushFit(src, mk(r.maker), r.part_number, {
        unit: unit || null, engineModel: unit ? engOk : null, engineCode: engOk ? engineCodeFor(engOk) : null,
        match: unit ? 'unit_model' : 'engine', ...b, tier: null, note: null, conf: 'unconfirmed', loc,
      }, plus ? plusFits : fits)
    }
  }

  // tk-filters crossref: ENGINE rows from "Fits engines" (oil and fuel filters follow the
  // engine; air filters follow the unit box, so they get none)
  for (const { r, loc } of fx) {
    if (/air (cleaner|filter)|cab/i.test(r['Filter type'])) continue
    for (const tok of engineTokens(r['Fits engines'])) {
      const code = engineCodeFor(tok)
      if (!code) { tick('fitment held: engine not in engines [filters]'); rep('Fitment held: engine code unknown', `${r['TK PN']}: "${tok}" (${at(loc)})`); continue }
      pushFit('filters', 'Thermo King', r['TK PN'], { unit: null, engineModel: null, engineCode: code, match: 'engine',
        serialFrom: null, serialBefore: null, dateFrom: null, dateBefore: null, tier: null, note: null, conf: /CONFLICT/.test(r.Notes) ? 'conflict' : 'unconfirmed', loc })
    }
  }

  // tk-filters By model: one row per single model the group string names, validated
  // against the model names the store and the sources already use.
  const knownModels = new Map<string, string>()
  for (const v of [...fit.map(f => f.unit_model), ...master.map(x => x.r.unit_model), ...sf.map(x => x.r.unit_model), ...oem.map(x => x.r.unit_model)])
    if (v && isSingleModel(v)) knownModels.set(normalizeModel(v), v)
  const expandGroup = (group: string): { models: string[]; unknown: string[] } => {
    const body = group.replace(/\(.*?\)/g, ' ').replace(/\bwith\s+(Isuzu|Yanmar|Mercedes)\b.*$/i, '').replace(/\s+gensets?:.*$/i, '')
    const models: string[] = [], unknown: string[] = []
    let prefix = '', brand = ''
    for (let piece of body.split(/\s*[;,]\s*|\s+\/\s+|\s+&\s+/)) {
      piece = piece.trim().replace(/\s+-\s+'.*$/, '')
      if (!piece) continue
      const bm = piece.match(/^(Precedent|Heat King|Advancer)\s+/i); if (bm) brand = bm[1]
      if (/^[0-9]+[A-Za-z]*$/.test(piece) && prefix) piece = prefix + piece
      const pm = piece.match(/^(.*?-)[0-9]+[A-Za-z]*$/); if (pm) prefix = pm[1]
      const tries = [piece, brand && !piece.startsWith(brand) ? `${brand} ${piece}` : '', piece.replace(/^(Precedent|Heat King|Advancer)\s+/i, '')].filter(Boolean)
      const hit = tries.map(t => knownModels.get(normalizeModel(t))).find(Boolean)
      if (hit) models.push(hit); else unknown.push(piece)
    }
    return { models: [...new Set(models)], unknown }
  }
  const unknownGroupPieces = new Map<string, number>()
  for (const { r, loc } of fb) {
    if (!r['TK PN']) continue
    const role = r['Role / note'] ?? ''
    const brk = readSeedBreak(role)
    if (!brk && vagueSeedBreak(role)) { tick('fitment held: break with no serial or date'); rep('Fitment held: a break with no serial or date', `${r['TK PN']}: ${r['Model group']} (${at(loc)}) - "${role.slice(0, 80)}"`); continue }
    const { models, unknown } = expandGroup(r['Model group'])
    for (const u of unknown) unknownGroupPieces.set(u, (unknownGroupPieces.get(u) ?? 0) + 1)
    const engs = /^air$/i.test(r.Section) ? [null] : (() => {
      const e = r['Model group'].match(/\b(?:with|w\/)\s+(Isuzu [A-Z0-9. ]+?)\s*$/i)?.[1] ?? r['Model group'].match(/\((Isuzu [A-Z0-9.]+|Mercedes OM636)( or (Isuzu [A-Z0-9.]+|Mercedes OM636))? engine\)/i)?.slice(1).filter(x => x && !/^ or /.test(x)) ?? null
      const list = Array.isArray(e) ? e : e ? [e] : [null]
      return list.map(x => x && isSingleModel(x) ? x : null)
    })()
    const b = brkOf(brk)
    for (const m of models) for (const e of engs) {
      pushFit('byModel', 'Thermo King', r['TK PN'], { unit: m, engineModel: e, engineCode: e ? engineCodeFor(e) : null, match: 'unit_model', ...b,
        tier: null, note: null, conf: /CONFLICT/.test(role) ? 'conflict' : 'unconfirmed', loc })
    }
  }
  for (const [g, n] of [...engineMiss].sort((a, b) => b[1] - a[1])) rep('Engine text that is not an engine designation in engines (not loaded as engine fitment)', `${n}	"${g}"`)
  for (const [g, n] of [...groupModels].sort((a, b) => b[1] - a[1])) rep('Fitment held: model string the 148 CHECK refuses (group, range or +)', `${n}\t"${g}"`)
  for (const [g, n] of [...unknownGroupPieces].sort((a, b) => b[1] - a[1])) rep('By model: group pieces that are not a known single model (not loaded)', `${n}\t"${g}"`)

  // a part + model listed both with and without a break: it disagrees with itself
  {
    const brkd = (f: Fit) => !!(f.serialFrom || f.serialBefore || f.dateFrom || f.dateBefore)
    const bare = (f: Fit) => `${f.maker}|${f.key}|${normalizeModel(f.unit ?? '')}|${normalizeModel(f.engineCode ?? f.engineModel ?? '')}`
    const sk = new Set(fits.filter(brkd).map(bare)), pk = new Set(fits.filter(f => !brkd(f)).map(bare))
    for (const [k, p] of store) { void k; const sf2 = storeFit.get(p.id) ?? []; for (const h of sf2) (h.brk ? sk : pk).add(`${p.manufacturer}|${parsePartNumber(p.part_number).key}|${h.u}|${h.e}`) }
    for (const list of [fits, plusFits]) for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i]
      if (sk.has(bare(f)) && pk.has(bare(f))) { rep('Fitment held: listed with and without a break', `${f.number}: ${f.unit ?? f.engineCode} (${at(f.loc)})`); tick('fitment held: listed with and without a break'); list.splice(i, 1) }
    }
  }

  for (const f of [...fits, ...plusFits]) if (OLDER_FILTER.has(f.number) && f.unit && /^TK48[26]/i.test(f.engineCode ?? f.engineModel ?? ''))
    rep('Model family question (loaded - the sources list it; your call)', `${f.number} on ${f.unit} with ${f.engineCode ?? f.engineModel} - an older unit, but a Yanmar engine; Oct 30 you described the older pair with Isuzu engines (${at(f.loc)})`)
  for (const f of fits) tick(`fitment loaded [${SRC[f.loc.src].key}]`)
  for (const f of plusFits) tick(`fitment loaded by file 12, after 182 (+ models) [${SRC[f.loc.src].key}]`)

  // ═══ CROSSES ══════════════════════════════════════════════════════════════════
  const crosses: Cross[] = []
  const crossSeen = new Set<string>()
  const dropped: Record<string, number> = {}
  const drop = (why: string) => { dropped[why] = (dropped[why] ?? 0) + 1 }
  const unknownBrands = new Map<string, number>()
  const pushCross = (maker: string, raw: string, brandRaw: string, num: string, conf: string, loc: Loc) => {
    const brand = makerBrand(brandRaw)
    if (!brand) {
      if (RESELLER_BRAND.test(brandRaw.trim())) { drop(`reseller or retailer brand: ${brandRaw.trim()}`); return }
      unknownBrands.set(brandRaw.trim(), (unknownBrands.get(brandRaw.trim()) ?? 0) + 1); drop(`brand not known to be a manufacturer: ${brandRaw.trim()}`); return
    }
    const n = num.trim().replace(/\s+/g, '')
    if (!/^[A-Z0-9][A-Z0-9-]*$/i.test(n) || !/[0-9]/.test(n)) { drop('cross cell is not a number'); return }
    const p = parseListingNumber(raw).base
    const t = target(maker, p)
    if (!t) { drop('its OEM part does not load'); return }
    const k = `${t.k}|${brand.toUpperCase()}|${normalizeModel(n)}`
    if (crossSeen.has(k)) return
    crossSeen.add(k)
    if (t.id && storeCross.has(`${t.id}|${brand.toUpperCase()}|${normalizeModel(n)}`)) { drop('already in the store'); return }
    crosses.push({ maker, number: t.number, key: p.key, brand, brandNumber: n, conf, loc })
  }
  // A crossref cell: "LF3746", "85809 (unconfirmed)", "CONFLICT: A (x) vs B (y)", "none found".
  const crossCell = (cell: string): Array<{ n: string; conf: string }> => {
    const c = cell.trim()
    if (!c || /^none found/i.test(c)) return []
    if (/^CONFLICT:\s*none\b/i.test(c) || /treat as none/i.test(c)) return []
    let m
    if ((m = c.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)[^]*?- use ([A-Z0-9-]+)/i))) return [{ n: m[3], conf: 'conflict' }]
    if ((m = c.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)/i))) return [{ n: m[1], conf: 'conflict' }, { n: m[2], conf: 'conflict' }]
    if ((m = c.match(/^([A-Z0-9][A-Z0-9-]*[0-9][A-Z0-9-]*)/i))) return [{ n: m[1], conf: 'unconfirmed' }]
    return []
  }
  for (const { r, loc } of fx) for (const brand of ['Fleetguard', 'Carquest', 'NAPA', 'Baldwin', 'Luber-finer', 'WIX'])
    for (const x of crossCell(r[brand] ?? '')) pushCross('Thermo King', r['TK PN'], brand, x.n, x.conf, loc)
  for (const { r, loc } of master) {
    const maker = mk(r.maker)
    for (const [col, brand] of [['baldwin_number', 'Baldwin'], ['fleetguard_number', 'Fleetguard'], ['wix_number', 'WIX'], ['gates_number', 'Gates'], ['dayco_number', 'Dayco'], ['napa_gold_number', 'NAPA Gold']] as const)
      for (const n of (r[col] ?? '').split(/\s*[,;/]\s*/).filter(Boolean)) pushCross(maker, r.part_number, brand, n, 'unconfirmed', loc)
    for (const entry of r.other_crosses.split(/\s*;\s*/).filter(Boolean)) {
      if (/^Thermo King previous no\./i.test(entry)) continue   // a supersession, above
      if (/^Carrier alt\./i.test(entry)) { drop('alternate number of the same maker (Carrier alt.) - not a cross, and alternate vs superseded is not stated'); continue }
      if (/\(reman\)/i.test(entry)) { drop('a reman cross - cross rows have no condition column'); continue }
      const m = entry.match(/^([A-Za-z][A-Za-z .'-]*?)\s+([A-Z]*[0-9][A-Z0-9-]*(?:\s*,\s*[A-Z]*[0-9][A-Z0-9-]*)*)$/i)
      if (!m) { drop('other_crosses entry not readable as brand + number'); rep('Crosses not readable', `"${entry}" (${at(loc)})`); continue }
      for (const n of m[2].split(/\s*,\s*/)) pushCross(maker, r.part_number, m[1], n, 'unconfirmed', loc)
    }
  }
  // seed crosses: one claim per (part, brand, note); the note is the whole original claim
  {
    const groups = new Map<string, Array<{ r: Record<string, string>; loc: Loc }>>()
    for (const x of sc) { const k = `${mk(x.r.maker)}|${x.r.part_number}|${x.r.cross_mfr}|${x.r.source_note}`; groups.set(k, [...(groups.get(k) ?? []), x]) }
    for (const rows of groups.values()) {
      const { r: r0, loc } = rows[0]
      const note = (r0.source_note ?? '').trim()
      const clean = rows.length === 1 && /^[A-Z0-9][A-Z0-9-]*$/i.test(r0.cross_part) && /[0-9]/.test(r0.cross_part) && note === r0.cross_part
      let nums: Array<{ n: string; conf: string }> = []
      if (clean) nums = [{ n: r0.cross_part, conf: 'unconfirmed' }]
      else {
        const conf = /CONFLICT/.test(note) ? 'conflict' : 'unconfirmed'
        let m
        if (/obsolete/i.test(rows.map(x => x.r.confidence).join(' '))) { drop('seed cross marked obsolete - cross rows have no status column'); continue }
        if (/^CONFLICT: none\b/i.test(note)) continue
        else if ((m = note.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)[^]*?- use ([A-Z0-9-]+)/i))) nums = [{ n: m[3], conf: 'conflict' }]
        else if ((m = note.match(/^CONFLICT:\s*([A-Z0-9-]+)[^]*?\bvs\b\s*([A-Z0-9-]+)/i))) nums = [{ n: m[1], conf: 'conflict' }, { n: m[2], conf: 'conflict' }]
        else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9][A-Z0-9-]*)\s*\(Inline also lists ([A-Z0-9-]+)\)/i))) nums = [{ n: m[1], conf }, { n: m[2], conf }]
        else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9])((?:\s*\/\s*[A-Z0-9-]+)+)\s*(\(|$)/i))) {
          nums = [{ n: m[1], conf }]
          for (const v of m[2].split('/').map(x => x.trim()).filter(Boolean)) nums.push({ n: v.startsWith('-') ? m[1].replace(/-[^-]+$/, v) : v, conf })
        } else if ((m = note.match(/^([A-Z0-9][A-Z0-9-]*[0-9][A-Z0-9-]*)(\s+KIT)?\s*(\(|$)/i))) nums = [{ n: m[1] + (m[2] ?? ''), conf }]
        else { drop('seed cross note not readable'); rep('Crosses not readable', `${r0.part_number} ${r0.cross_mfr} "${note.slice(0, 80)}" (${at(loc)})`); continue }
      }
      for (const x of nums) pushCross(mk(r0.maker), r0.part_number, r0.cross_mfr, x.n, x.conf, loc)
    }
  }

  // ═══ QUALITY NUMBERS ══════════════════════════════════════════════════════════
  const fitKeys = new Set(fits.map(f => `${f.maker}|${parsePartNumber(f.number).key}`))
  const plusKeys = new Set(plusFits.map(f => `${f.maker}|${parsePartNumber(f.number).key}`))
  const crossKeys = new Set(crosses.map(c => `${c.maker}|${parsePartNumber(c.number).key}`))
  const newKeys = newParts.map(p => `${p.maker}|${p.key}`)
  const q = {
    parts: newParts.length,
    description: newParts.filter(p => p.description).length,
    category: newParts.filter(p => categoryOf(p.type) !== 'Other').length,
    fitment: newKeys.filter(k => fitKeys.has(k)).length,
    fitmentWith182: newKeys.filter(k => fitKeys.has(k) || plusKeys.has(k)).length,
    cross: newKeys.filter(k => crossKeys.has(k)).length,
  }
  const catTally = new Map<string, number>(); for (const p of newParts) catTally.set(categoryOf(p.type), (catTally.get(categoryOf(p.type)) ?? 0) + 1)
  const onStoreFit = fits.filter(f => !added.has(`${f.maker}|${parsePartNumber(f.number).key}`)).length
  const onStoreCross = crosses.filter(c => !added.has(`${c.maker}|${parsePartNumber(c.number).key}`)).length

  // ═══ WRITE THE SQL ════════════════════════════════════════════════════════════
  fs.mkdirSync(OUT, { recursive: true })
  for (const f of fs.readdirSync(OUT)) if (/^\d\d-.*\.sql$/.test(f)) fs.unlinkSync(path.join(OUT, f))
  const before = { parts: parts.length, fitment: fit.length, sup: sup.length, cross: xr.length, engines: engines.length }
  const files: string[] = []
  let state = { ...before }
  const header = (title: string, lines: string[]) => [
    `-- ${title}`,
    '-- GENERATED by scripts/build-reefer-sources-sql.ts on ' + new Date().toISOString().slice(0, 10) + ' from the live store and data/parts-sources/.',
    '-- Needs migration 181. Run the reefer-load files IN NUMBER ORDER, each committed before the next:',
    '-- every file checks the store is exactly the size the one before it left, and refuses otherwise.',
    '--',
    '-- ENDS IN ROLLBACK. Read the table it prints, then change the last line to COMMIT to keep it.',
    '-- Trust: verified = false and confidence unconfirmed on every row (conflict where its own',
    '-- source says CONFLICT). Never a retailer name; never a price.',
    '-- Preview and production share one database.',
    '--', ...lines.map(l => `-- ${l}`), '',
  ]
  const guard181 = [
    'DO $$',
    'BEGIN',
    "  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'part_fitment' AND column_name = 'source_row')",
    "  OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'engines' AND column_name = 'source') THEN",
    "    RAISE EXCEPTION 'reefer-load: migration 181 is not applied - apply it first'; END IF;",
    'END $$;',
  ]
  const sizeCheck = (s: typeof state) => [
    'DO $$',
    'BEGIN',
    `  IF (SELECT count(*) FROM public.parts) <> ${s.parts} OR (SELECT count(*) FROM public.part_fitment) <> ${s.fitment}`,
    `  OR (SELECT count(*) FROM public.part_supersession) <> ${s.sup} OR (SELECT count(*) FROM public.part_cross_reference) <> ${s.cross}`,
    `  OR (SELECT count(*) FROM public.engines) <> ${s.engines} THEN`,
    `    RAISE EXCEPTION 'reefer-load: the store is not ${s.parts} parts / ${s.fitment} fitment / ${s.sup} supersessions / ${s.cross} crosses / ${s.engines} engines - run the files in order, once each';`,
    '  END IF;',
    'END $$;',
  ]
  const summary = (b: typeof state, a: typeof state) => [
    `SELECT 'parts' AS table_name, ${b.parts} AS before, (SELECT count(*) FROM public.parts) AS after, ${a.parts} AS planned`,
    `UNION ALL SELECT 'part_fitment', ${b.fitment}, (SELECT count(*) FROM public.part_fitment), ${a.fitment}`,
    `UNION ALL SELECT 'part_supersession', ${b.sup}, (SELECT count(*) FROM public.part_supersession), ${a.sup}`,
    `UNION ALL SELECT 'part_cross_reference', ${b.cross}, (SELECT count(*) FROM public.part_cross_reference), ${a.cross}`,
    `UNION ALL SELECT 'engines', ${b.engines}, (SELECT count(*) FROM public.engines), ${a.engines};`,
  ]
  const srcLit = (l: Loc) => `${lit(SRC[l.src].key)}, ${lit(l.sheet)}, ${l.row}`
  const write = (name: string, body: string[]) => {
    const text = body.join('\n') + '\n'
    if (/[^\x00-\x7F]/.test(text)) throw new Error(`${name}: non-ASCII`)
    fs.writeFileSync(path.join(OUT, name), text, { encoding: 'ascii' })
    files.push(name)
  }

  const fitChunks: Fit[][] = []
  for (let i = 0; i < fits.length; i += FIT_PER_FILE) fitChunks.push(fits.slice(i, i + FIT_PER_FILE))
  const crossNo = 1 + fitChunks.length + 1
  const total = crossNo + (plusFits.length ? 1 : 0)

  // 01: engines, parts, supersessions
  {
    const b = { ...state }
    const a = { ...state, parts: state.parts + newParts.length, engines: state.engines + newEngines.length, sup: state.sup + newSups.length }
    write('01-engines-parts-supersessions.sql', [
      ...header(`Reefer parts load 1 of ${total}: engines, parts and supersessions.`, [
        `adds ${newEngines.length} engines, ${newParts.length} parts (equipment_type reefer), ${newSups.length} supersessions (unconfirmed: the counter shows them as "reported replaced by", never substitutes)`,
      ]),
      'BEGIN;', '', ...guard181, '', ...sizeCheck(b), '',
      'CREATE TEMP TABLE _rl_engines (engine_code TEXT, engine_maker TEXT, base_engine TEXT, tier TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      ...(newEngines.length ? ['INSERT INTO _rl_engines VALUES', newEngines.map(e => `  (${lit(e.code)}, ${lit(e.maker)}, ${lit(e.base)}, ${lit(e.tier)}, ${lit(e.conf)}, ${srcLit(e.loc)})`).join(',\n') + ';'] : []),
      '',
      'CREATE TEMP TABLE _rl_parts (manufacturer TEXT, part_number TEXT, part_type TEXT, description TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      'INSERT INTO _rl_parts VALUES',
      newParts.map(p => `  (${lit(p.maker)}, ${lit(p.number)}, ${lit(p.type)}, ${lit(p.description)}, ${lit(p.conf)}, ${srcLit(p.loc)})`).join(',\n') + ';',
      '',
      'CREATE TEMP TABLE _rl_sup (manufacturer TEXT, old_number TEXT, new_number TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      ...(newSups.length ? ['INSERT INTO _rl_sup VALUES', newSups.map(s => `  (${lit(s.maker)}, ${lit(s.old)}, ${lit(s.neu)}, ${lit(s.conf)}, ${srcLit(s.loc)})`).join(',\n') + ';'] : []),
      '',
      '-- Checks BEFORE writing.',
      'DO $$',
      'BEGIN',
      `  IF (SELECT count(*) FROM _rl_parts) <> ${newParts.length} OR (SELECT count(*) FROM _rl_engines) <> ${newEngines.length} OR (SELECT count(*) FROM _rl_sup) <> ${newSups.length} THEN`,
      "    RAISE EXCEPTION 'reefer-load: staged counts are not the plan'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_parts f JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)) THEN",
      "    RAISE EXCEPTION 'reefer-load: a new part is already in the store'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_parts WHERE (manufacturer = 'Thermo King' AND part_number !~ '^[0-9]{2,3}-[0-9]{4}$')",
      "             OR (manufacturer = 'Carrier Transicold' AND part_number !~ '^[0-9]{2}-[0-9]{5}-[0-9]{2}$')) THEN",
      "    RAISE EXCEPTION 'reefer-load: a number does not fit its maker shape'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_parts WHERE description IS NULL OR btrim(description) = '') THEN RAISE EXCEPTION 'reefer-load: a part has no description'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_parts f WHERE NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.part_type = f.part_type)) THEN",
      "    RAISE EXCEPTION 'reefer-load: a part_type the store does not already use'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_engines e JOIN public.engines x ON upper(x.engine_code) = upper(e.engine_code)) THEN RAISE EXCEPTION 'reefer-load: an engine is already loaded'; END IF;",
      'END $$;',
      '',
      'INSERT INTO public.engines (engine_code, engine_maker, base_engine, tier, confidence, source, source_sheet, source_row)',
      'SELECT engine_code, engine_maker, base_engine, tier, confidence, source, source_sheet, source_row FROM _rl_engines;',
      '',
      'INSERT INTO public.parts (manufacturer, part_number, part_type, description, notes, verified, source, confidence, equipment_type, source_sheet, source_row)',
      "SELECT manufacturer, part_number, part_type, description, NULL, FALSE, source, confidence, 'reefer', source_sheet, source_row FROM _rl_parts;",
      '',
      'INSERT INTO public.part_supersession (old_number, new_number, manufacturer, note, verified, source, confidence, source_sheet, source_row)',
      'SELECT old_number, new_number, manufacturer, NULL, FALSE, source, confidence, source_sheet, source_row FROM _rl_sup;',
      '',
      ...sizeCheck(a).map(l => l.replace('run the files in order, once each', 'this file did not add exactly its rows')), '',
      ...summary(b, a), '', 'ROLLBACK;',
    ])
    state = a
  }

  // 02..: fitment, FIT_PER_FILE rows each
  fitChunks.forEach((chunk, i) => {
    const b = { ...state }, a = { ...state, fitment: state.fitment + chunk.length }
    const n = String(i + 2).padStart(2, '0')
    write(`${n}-fitment-${i + 1}-of-${fitChunks.length}.sql`, [
      ...header(`Reefer parts load ${i + 2} of ${total}: fitment, part ${i + 1} of ${fitChunks.length}.`, [`adds ${chunk.length} fitment rows (${chunk.filter(f => f.match === 'engine').length} by engine, ${chunk.filter(f => f.match === 'unit_model').length} by unit model)`]),
      'BEGIN;', '', ...guard181, '', ...sizeCheck(b), '',
      'CREATE TEMP TABLE _rl_fit (manufacturer TEXT, part_number TEXT, unit_model TEXT, engine_model TEXT, engine_code TEXT, match_type TEXT,',
      '  serial_from TEXT, serial_before TEXT, build_date_from DATE, build_date_before DATE, tier TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      'INSERT INTO _rl_fit VALUES',
      chunk.map(f => `  (${lit(f.maker)}, ${lit(f.number)}, ${lit(f.unit)}, ${lit(f.engineModel)}, ${lit(f.engineCode)}, ${lit(f.match)}, ${lit(f.serialFrom)}, ${lit(f.serialBefore)}, ${lit(f.dateFrom)}, ${lit(f.dateBefore)}, ${lit(f.tier)}, ${lit(f.conf)}, ${srcLit(f.loc)})`).join(',\n') + ';',
      '',
      'DO $$',
      'BEGIN',
      `  IF (SELECT count(*) FROM _rl_fit) <> ${chunk.length} THEN RAISE EXCEPTION 'reefer-load: staged count is not the plan'; END IF;`,
      '  IF EXISTS (SELECT 1 FROM _rl_fit f WHERE NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
      "    RAISE EXCEPTION 'reefer-load: a fitment row names a part that is not in the store'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_fit WHERE NOT public.is_single_model(unit_model) OR NOT public.is_single_model(engine_model)) THEN RAISE EXCEPTION 'reefer-load: a fitment model is a group'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_fit f WHERE f.engine_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.engines e WHERE e.engine_code = f.engine_code)) THEN RAISE EXCEPTION 'reefer-load: an engine code is not in engines'; END IF;",
      '  IF EXISTS (SELECT 1 FROM _rl_fit f JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number)',
      '             JOIN public.part_supersession s ON s.manufacturer = p.manufacturer AND s.old_number_normalized = p.part_number_normalized',
      `             WHERE s.source NOT IN (${(Object.keys(SRC) as SrcName[]).map(k => lit(SRC[k].key)).join(', ')})) THEN`,
      "    RAISE EXCEPTION 'reefer-load: fitment onto a superseded number'; END IF;",
      'END $$;',
      '',
      'INSERT INTO public.part_fitment (part_id, unit_model, engine_model, engine_code, match_type, serial_from, serial_before, build_date_from, build_date_before, tier, verified, source, confidence, source_sheet, source_row)',
      'SELECT p.id, f.unit_model, f.engine_model, f.engine_code, f.match_type, f.serial_from, f.serial_before, f.build_date_from, f.build_date_before, f.tier, FALSE, f.source, f.confidence, f.source_sheet, f.source_row',
      '  FROM _rl_fit f JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
      '',
      ...sizeCheck(a).map(l => l.replace('run the files in order, once each', 'this file did not add exactly its rows')), '',
      ...summary(b, a), '', 'ROLLBACK;',
    ])
    state = a
  })

  // last: crosses
  {
    const b = { ...state }, a = { ...state, cross: state.cross + crosses.length }
    const n = String(crossNo).padStart(2, '0')
    write(`${n}-cross-references.sql`, [
      ...header(`Reefer parts load ${crossNo} of ${total}: cross-references.`, [`adds ${crosses.length} cross-references, manufacturers only: ${[...crosses.reduce((m, c) => m.set(c.brand, (m.get(c.brand) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`]),
      'BEGIN;', '', ...guard181, '', ...sizeCheck(b), '',
      'CREATE TEMP TABLE _rl_x (manufacturer TEXT, part_number TEXT, brand TEXT, brand_number TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      'INSERT INTO _rl_x VALUES',
      crosses.map(c => `  (${lit(c.maker)}, ${lit(c.number)}, ${lit(c.brand)}, ${lit(c.brandNumber)}, ${lit(c.conf)}, ${srcLit(c.loc)})`).join(',\n') + ';',
      '',
      'DO $$',
      'BEGIN',
      `  IF (SELECT count(*) FROM _rl_x) <> ${crosses.length} THEN RAISE EXCEPTION 'reefer-load: staged count is not the plan'; END IF;`,
      '  IF EXISTS (SELECT 1 FROM _rl_x f WHERE NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
      "    RAISE EXCEPTION 'reefer-load: a cross names a part that is not in the store'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_x WHERE brand ~* '(napa|carquest|autozone|reilly|rockauto|amazon|ebay|friday|diselmart|thermo ?by)') THEN RAISE EXCEPTION 'reefer-load: a reseller brand'; END IF;",
      'END $$;',
      '',
      'INSERT INTO public.part_cross_reference (part_id, brand, brand_number, verified, source, confidence, source_sheet, source_row)',
      'SELECT p.id, f.brand, f.brand_number, FALSE, f.source, f.confidence, f.source_sheet, f.source_row',
      '  FROM _rl_x f JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
      '',
      ...sizeCheck(a).map(l => l.replace('run the files in order, once each', 'this file did not add exactly its rows')), '',
      ...summary(b, a), '', 'ROLLBACK;',
    ])
    state = a
  }

  // last, optional: fitment on Thermo King "+" models, which only migration 182 accepts
  if (plusFits.length) {
    const b = { ...state }, a = { ...state, fitment: state.fitment + plusFits.length }
    const models = [...plusFits.reduce((m, f) => m.set(f.unit!, (m.get(f.unit!) ?? 0) + 1), new Map<string, number>())].sort((x, y) => y[1] - x[1])
    write(`${String(total).padStart(2, '0')}-fitment-plus-models-needs-182.sql`, [
      ...header(`Reefer parts load ${total} of ${total}: fitment on "+" models. NEEDS MIGRATION 182 - run 182 first, then this.`, [
        `adds ${plusFits.length} fitment rows on Thermo King models whose name ends in "+", which 148's is_single_model refuses:`,
        ...models.map(([m, c]) => `  ${String(c).padStart(4)}  ${m}`),
        'Without 182 this file refuses to run and nothing else is affected; files 01-' + String(crossNo).padStart(2, '0') + ' do not need it.',
      ]),
      'BEGIN;', '', ...guard181, '',
      'DO $$',
      'BEGIN',
      "  IF NOT public.is_single_model('SB-210+') THEN RAISE EXCEPTION 'reefer-load: migration 182 is not applied - apply it first'; END IF;",
      'END $$;', '', ...sizeCheck(b), '',
      'CREATE TEMP TABLE _rl_fit (manufacturer TEXT, part_number TEXT, unit_model TEXT, engine_model TEXT, engine_code TEXT, match_type TEXT,',
      '  serial_from TEXT, serial_before TEXT, build_date_from DATE, build_date_before DATE, tier TEXT, confidence TEXT, source TEXT, source_sheet TEXT, source_row INTEGER) ON COMMIT DROP;',
      'INSERT INTO _rl_fit VALUES',
      plusFits.map(f => `  (${lit(f.maker)}, ${lit(f.number)}, ${lit(f.unit)}, ${lit(f.engineModel)}, ${lit(f.engineCode)}, ${lit(f.match)}, ${lit(f.serialFrom)}, ${lit(f.serialBefore)}, ${lit(f.dateFrom)}, ${lit(f.dateBefore)}, ${lit(f.tier)}, ${lit(f.conf)}, ${srcLit(f.loc)})`).join(',\n') + ';',
      '',
      'DO $$',
      'BEGIN',
      `  IF (SELECT count(*) FROM _rl_fit) <> ${plusFits.length} THEN RAISE EXCEPTION 'reefer-load: staged count is not the plan'; END IF;`,
      '  IF EXISTS (SELECT 1 FROM _rl_fit f WHERE NOT EXISTS (SELECT 1 FROM public.parts p WHERE p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number))) THEN',
      "    RAISE EXCEPTION 'reefer-load: a fitment row names a part that is not in the store'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_fit WHERE NOT public.is_single_model(unit_model) OR NOT public.is_single_model(engine_model)) THEN RAISE EXCEPTION 'reefer-load: a fitment model is a group'; END IF;",
      "  IF EXISTS (SELECT 1 FROM _rl_fit f WHERE f.engine_code IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.engines e WHERE e.engine_code = f.engine_code)) THEN RAISE EXCEPTION 'reefer-load: an engine code is not in engines'; END IF;",
      'END $$;',
      '',
      'INSERT INTO public.part_fitment (part_id, unit_model, engine_model, engine_code, match_type, serial_from, serial_before, build_date_from, build_date_before, tier, verified, source, confidence, source_sheet, source_row)',
      'SELECT p.id, f.unit_model, f.engine_model, f.engine_code, f.match_type, f.serial_from, f.serial_before, f.build_date_from, f.build_date_before, f.tier, FALSE, f.source, f.confidence, f.source_sheet, f.source_row',
      '  FROM _rl_fit f JOIN public.parts p ON p.manufacturer = f.manufacturer AND p.part_number_normalized = public.normalize_part_number(f.part_number);',
      '',
      ...sizeCheck(a).map(l => l.replace('run the files in order, once each', 'this file did not add exactly its rows')), '',
      ...summary(b, a), '', 'ROLLBACK;',
    ])
    state = a
  }

  // ═══ DOCX vs the By model sheet ═══
  const sheetNums = new Set(fb.filter(x => /[0-9]/.test(x.r['TK PN'])).map(x => parsePartNumber(x.r['TK PN']).key))
  const docNums = seenNums.byModel ?? new Set<string>()
  const docOnly = [...docNums].filter(k => !sheetNums.has(k.split('|')[1]))
  const sheetOnly = [...sheetNums].filter(k => !docNums.has(`Thermo King|${k}`))
  rep('The docx against the By model sheet', `numbers in the docx: ${docNums.size}; in the sheet: ${sheetNums.size}; docx only: ${docOnly.join(', ') || 'none'}; sheet only: ${sheetOnly.join(', ') || 'none'}`)

  // ═══ THE SEED + REFERENCE FILE (Oct 30, not run): what of it this load now covers ══
  const seedSql = fs.readFileSync('scripts/load-seed-and-reference.sql', 'utf8')
  const block = (name: string) => { const i = seedSql.indexOf(`INSERT INTO ${name} VALUES`); return i < 0 ? '' : seedSql.slice(i, seedSql.indexOf(';\n', i)) }
  const seedParts = [...block('_ld_parts').matchAll(/^\s*\('(nwi-seed-2026-10-23|nwi-hd-parts-reference-112)', '([^']+)', '([^']+)'/gm)].map(m => ({ src: m[1], maker: m[2], key: parsePartNumber(m[3]).key }))
  const seedFitRows = (block('_ld_fitment').match(/^\s*\(/gm) ?? []).length
  const seedCrossRows = (block('_ld_cross').match(/^\s*\(/gm) ?? []).length
  const mine = new Set([...added.keys(), ...store.keys()])
  const seedA = seedParts.filter(p => p.src === 'nwi-seed-2026-10-23'), seedB = seedParts.filter(p => p.src !== 'nwi-seed-2026-10-23')
  const seedOverlap = {
    aParts: seedA.length, aCovered: seedA.filter(p => added.has(`${p.maker}|${p.key}`)).length, aMissing: seedA.filter(p => !added.has(`${p.maker}|${p.key}`)).map(p => p.key),
    bParts: seedB.length, bCovered: seedB.filter(p => added.has(`${p.maker}|${p.key}`)).length,
    napa: (seedSql.match(/'(NAPA|NAPA Gold|Carquest)'/g) ?? []).length,
  }

  // ═══ REPORT ═══════════════════════════════════════════════════════════════════
  const per = (Object.keys(SRC) as SrcName[]).map(s => {
    const nums = seenNums[s] ?? new Set<string>()
    const notStore = [...nums].filter(k => !store.has(k))
    const loadedFrom = newParts.filter(p => p.loc.src === s).length
    return `${SRC[s].key.padEnd(30)} ${String(rowsRead[s] ?? 0).padStart(6)} rows  ${String(nums.size).padStart(5)} numbers  ${String(notStore.length).padStart(5)} not in the store  ${String(loadedFrom).padStart(5)} loaded from here first  ${String((blankDesc[s] ?? []).length).padStart(5)} rows with no description`
  })
  const L: string[] = []
  const P = (...s: string[]) => L.push(...s)
  P('REEFER PARTS LOAD - report. Generated ' + new Date().toISOString().slice(0, 10) + ' by scripts/build-reefer-sources-sql.ts.', '')
  P(`STORE BEFORE: ${before.parts} parts, ${before.fitment} fitment, ${before.sup} supersessions, ${before.cross} crosses, ${before.engines} engines`)
  P(`STORE AFTER (projected): ${state.parts} parts, ${state.fitment} fitment, ${state.sup} supersessions, ${state.cross} crosses, ${state.engines} engines`, '')
  P('SOURCES (key, rows read, distinct numbers, numbers not in the store, new parts this load takes from it first, rows with no description)', ...per.map(x => '  ' + x), '')
  P(`QUALITY of the ${q.parts} new parts: description ${q.description}, category ${q.category} (not "Other"), fitment ${q.fitment} (${q.fitmentWith182} once the + model file runs after 182), cross-reference ${q.cross}`)
  P(`  category spread: ${[...catTally].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`)
  P(`  also added to EXISTING store parts: ${onStoreFit} fitment rows, ${onStoreCross} crosses`, '')
  P('TALLIES', ...Object.entries(T).sort().map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`), '')
  P('CROSSES DROPPED', ...Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(6)}  ${k}`), '')
  P('PART TYPES NO RULE MAPS (parts held; each line: parts held, the source name)', ...[...typeUnmapped].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${String(v).padStart(5)}  ${k}`), '')
  P(`CONFLICTS (loaded once, NOT settled - yours): ${conflicts.length}`, ...conflicts.map(c => '  ' + c), '')
  P(`STORE PARTS WHOSE SOURCES MAP TO A DIFFERENT TYPE (store type kept): ${typeConflictStore.length}`, ...typeConflictStore.map(c => '  ' + c), '')
  P(`REMAN PARTS LOADED AS THEIR OWN PART (rule 5): ${remanLoaded.length}`, ...remanLoaded.map(c => '  ' + c), '')
  P('ROWS WITH NO DESCRIPTION, per source (first 20)')
  for (const s of Object.keys(SRC) as SrcName[]) { const b = blankDesc[s] ?? []; P(`  ${SRC[s].key}: ${b.length}`, ...b.slice(0, 20).map(x => `      ${x}`)) }
  P('', 'THE OCT 30 SEED + REFERENCE FILE (scripts/load-seed-and-reference.sql, not run)')
  P(`  Source A (the five seed CSVs): ${seedOverlap.aParts} new parts there; this load adds ${seedOverlap.aCovered} of them${seedOverlap.aMissing.length ? ` (not: ${seedOverlap.aMissing.join(', ')} - see the held sections)` : ''}. Its ${seedFitRows} fitment rows and ${seedCrossRows} crosses are re-derived here from the same CSVs under today's rules.`)
  P(`  Source B (hd_parts_reference, not a source in this job): ${seedOverlap.bParts} parts, ${seedOverlap.bCovered} of them in this load.`)
  P(`  It also carries ${seedOverlap.napa} NAPA / NAPA Gold / Carquest cross rows and the seeds' own "confirmed" tiers - both against today's rules.`, '')
  for (const [section, lines] of Object.entries(R)) P(`${section.toUpperCase()}: ${lines.length}`, ...lines.map(l => '  ' + l), '')
  fs.writeFileSync(path.join(OUT, 'REPORT.txt'), ascii(L.join('\n')).replace(/[^\x00-\x7F]/g, '?') + '\n', { encoding: 'ascii' })

  // ═══ SOURCES.md ═══
  fs.writeFileSync(path.join(DIR, 'SOURCES.md'), [
    '# Reefer parts sources', '',
    'What each `source` key in the parts catalog means. The catalog stores the KEY, never a',
    "file name: a file's own name can carry a retailer's, and no retailer name is ever loaded.",
    'Every row also records `source_sheet` and `source_row` (header = row 1), so one source can',
    'be found again, checked, or taken back out on its own.', '',
    '| source key | file in this folder | loaded |', '|---|---|---|',
    ...(Object.keys(SRC) as SrcName[]).map(s => `| \`${SRC[s].key}\` | ${SRC[s].file} | ${s === 'simple' ? 'no - every row is also in Reefer-Parts-Master.xlsx, which is loaded' : s === 'byModel' ? 'no - prose copy of the By model sheet in tk-filters-crossref.xlsx, which is loaded' : 'yes'} |`),
    '', 'Not loaded, by instruction: truck_trailer_parts_pilot.xlsx (truck and trailer, on hold), and',
    'the files in this folder that were never part of the reefer load (truck-trailer-*, service-truck-*,',
    'light-duty-reseller-programs, parts-verified, parts-needs-review, sources-log).', '',
  ].join('\n'), { encoding: 'ascii' })

  console.log(L.slice(0, 40).join('\n'))
  console.log(`\nwrote ${files.length} SQL files to scripts/reefer-load/: ${files.join(', ')}`)
}
main().catch(e => { console.error(e); process.exit(1) })
