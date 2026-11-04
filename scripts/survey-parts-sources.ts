// npx tsx scripts/survey-parts-sources.ts
//
// READ-ONLY. Measures the reefer parts sources before any load is designed: how
// Reefer-Parts-Simple relates to Reefer-Parts-Master, blank descriptions, the part
// names and categories in use, and the model strings. Touches no database.
import fs from 'fs'
import path from 'path'
import * as XLSX from 'xlsx'
import { parsePartNumber } from '../src/lib/parts/part-number'

const DIR = path.join(process.cwd(), 'data/parts-sources')
const sheet = (f: string, s: string) => XLSX.utils.sheet_to_json<Record<string, string>>(
  XLSX.read(fs.readFileSync(path.join(DIR, f)), { type: 'buffer', raw: f.endsWith('.csv'), codepage: 65001 }).Sheets[s], { defval: '', raw: false })
const top = (m: Map<string, number>, n = 40) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}\t${k}`).join('\n  ')
const count = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)

const simple = sheet('Reefer-Parts-Simple.xlsx', 'All')
const master = sheet('Reefer-Parts-Master.xlsx', 'All Parts')
console.log(`Simple rows ${simple.length}, Master rows ${master.length}`)

const key = (maker: string, num: string) => `${/carrier/i.test(maker) ? 'C' : 'T'}|${parsePartNumber(num).key}`
const sNums = new Set(simple.map(r => key(r.Make, r['Part Number'])))
const mNums = new Set(master.map(r => key(r.maker, r.part_number)))
console.log(`Simple numbers ${sNums.size}, Master numbers ${mNums.size}; in both ${[...sNums].filter(k => mNums.has(k)).length}; Simple only ${[...sNums].filter(k => !mNums.has(k)).length}; Master only ${[...mNums].filter(k => !sNums.has(k)).length}`)
const sPairs = new Set(simple.map(r => `${key(r.Make, r['Part Number'])}|${r.Model.trim().toUpperCase()}`))
const mPairs = new Set(master.map(r => `${key(r.maker, r.part_number)}|${r.unit_model.trim().toUpperCase()}`))
console.log(`Simple (number,model) ${sPairs.size}, Master ${mPairs.size}, both ${[...sPairs].filter(k => mPairs.has(k)).length}`)
// Is Simple's description Master's part_name?
const mName = new Map<string, Set<string>>()
for (const r of master) { const k = key(r.maker, r.part_number); (mName.get(k) ?? mName.set(k, new Set()).get(k)!).add(r.part_name.trim()) }
let same = 0, diff = 0; const diffs: string[] = []
for (const r of simple) { const n = mName.get(key(r.Make, r['Part Number'])); if (!n) continue; if (n.has(r['Part Description'].trim())) same++; else { diff++; if (diffs.length < 15) diffs.push(`${r['Part Number']}: simple "${r['Part Description']}" master ${JSON.stringify([...n])}`) } }
console.log(`Simple description == a Master part_name: ${same}, differs ${diff}\n  ${diffs.join('\n  ')}`)

console.log(`\nSimple blank description rows: ${simple.filter(r => !r['Part Description'].trim()).length}; blank model ${simple.filter(r => !r.Model.trim()).length}`)
console.log(`Master blank part_name ${master.filter(r => !r.part_name.trim()).length}, blank description ${master.filter(r => !r.description.trim()).length}, blank both ${master.filter(r => !r.part_name.trim() && !r.description.trim()).length}; blank unit_model ${master.filter(r => !r.unit_model.trim()).length}; blank unit+engine ${master.filter(r => !r.unit_model.trim() && !r.engine_model.trim()).length}`)

const conf = new Map<string, number>(); master.forEach(r => count(conf, r.confidence)); console.log('\nMaster confidence:\n  ' + top(conf))
const cat = new Map<string, number>(); master.forEach(r => count(cat, r.part_category)); console.log('Master part_category:\n  ' + top(cat, 80))
const names = new Map<string, number>(); master.forEach(r => count(names, r.part_name.trim())); console.log(`Master distinct part_name ${names.size}; top:\n  ` + top(names, 60))
const sd = new Map<string, number>(); simple.forEach(r => count(sd, r['Part Description'].trim())); console.log(`Simple distinct descriptions ${sd.size}`)
const forms = new Map<string, number>(); master.forEach(r => count(forms, parsePartNumber(r.part_number).form + (parsePartNumber(r.part_number).suffix ? '+suffix' : ''))); console.log('Master number forms:\n  ' + top(forms))
const models = new Map<string, number>(); master.forEach(r => count(models, r.unit_model.trim())); console.log(`Master distinct unit_model ${models.size}`)
const bad = [...models.keys()].filter(v => v && (/[,/+]/.test(v) || /\b(series|family|all|and|thru)\b/i.test(v) || /[0-9]x{2,}/i.test(v) || /[0-9]{2,}\s*-\s*[0-9]{2,}/.test(v)))
console.log(`Master group-looking unit_model strings ${bad.length}: ${bad.slice(0, 40).join(' | ')}`)
const eng = new Map<string, number>(); master.forEach(r => count(eng, r.engine_model.trim())); console.log('Master engine_model:\n  ' + top(eng, 40))
const cr = ['gates_number', 'dayco_number', 'baldwin_number', 'fleetguard_number', 'wix_number', 'napa_gold_number', 'other_crosses']
for (const c of cr) console.log(`Master ${c}: ${master.filter(r => r[c].trim()).length} rows, e.g. ${[...new Set(master.map(r => r[c].trim()).filter(Boolean))].slice(0, 6).join(' | ')}`)
const oc = new Map<string, number>(); master.forEach(r => r.other_crosses.split(/[;|]/).map(s => s.trim()).filter(Boolean).forEach(s => count(oc, s.replace(/[0-9][\w.\-]*/g, '#'))))
console.log('Master other_crosses shapes:\n  ' + top(oc, 40))
const nt = new Map<string, number>(); master.forEach(r => r.notes.split(';').map(s => s.trim().replace(/[A-Z0-9]{6,}/g, '#').replace(/[0-9]+/g, 'N').slice(0, 60)).filter(Boolean).forEach(s => count(nt, s)))
console.log('Master notes shapes:\n  ' + top(nt, 40))
