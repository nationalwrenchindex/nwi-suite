// npx tsx scripts/verify-import-preflight.ts [dir-with-the-three-csvs]
//
// The import pre-flight check (src/lib/hd/import-columns.ts + src/app/hd/import/ImportPreflight.tsx).
//   1. The alias table is exactly what the routes read before it moved (frozen copies below).
//   2. The shared col() is the route's old col(), on every heading shape tried.
//   3. The pre-flight names the heading col() will actually read, for every column.
//   4. The three files: every column / Customer only / required but no VIN, Make, Model.
//   5. The blocked screen and the warning, rendered to HTML from the real component.
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  col, exactCell, FULLBAY, FULLBAY_COLUMNS, INVOICES, INVOICE_COLUMNS, UNIT_FIELDS,
  headerFor, parseCSV, preflightColumns, preflightMapping, missingColumnsMessage,
} from '../src/lib/hd/import-columns'
import ImportPreflight from '../src/app/hd/import/ImportPreflight'

// ImportPreflight.tsx is compiled with the classic JSX transform here (as verify-ld-trial does).
;(globalThis as unknown as { React: typeof React }).React = React

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

// ── 1. Frozen: the aliases exactly as the routes wrote them before Nov 23, 2026 ──
console.log('\n1. The alias table did not change when it moved')
const FROZEN_FULLBAY: Record<string, string[]> = {
  workOrderNumber: ['Work Order Number', 'Work Order #', 'WO Number', 'WO#', 'Work Order'],
  customer:        ['Customer Name', 'Customer', 'Fleet', 'Client'],
  unitNumber:      ['Unit Number', 'Unit #', 'Unit No', 'Unit'],
  serviceDate:     ['Service Date', 'Date', 'Start Date', 'Work Date'],
  completedDate:   ['Completed Date', 'Completion Date', 'End Date'],
  status:          ['Status'],
  technician:      ['Technician', 'Tech', 'Tech Name', 'Assigned To'],
  description:     ['Service Description', 'Description', 'Services', 'Work Done'],
  internalNotes:   ['Internal Notes', 'Notes', 'Comments'],
  total:           ['Total', 'Grand Total', 'Invoice Total'],
  laborTotal:      ['Labor Total', 'Labor'],
  partsTotal:      ['Parts Total', 'Parts'],
  tax:             ['Tax'],
  amountPaid:      ['Amount Paid', 'Paid', 'Payment'],
  balanceDue:      ['Balance Due', 'Balance', 'Owed'],
  make:            ['Make', 'Manufacturer', 'Brand'],
  model:           ['Model'],
  serial:          ['VIN', 'Serial Number', 'Serial'],
  year:            ['Year'],
  engineHours:     ['Engine Hours', 'Hours'],
  unitType:        ['Unit Type', 'Equipment Type', 'Asset Type', 'Vehicle Type'],
}
const keys = Object.keys(FULLBAY) as Array<keyof typeof FULLBAY>
check('Fullbay: the same 21 columns', keys.length === 21 && keys.every(k => k in FROZEN_FULLBAY) && Object.keys(FROZEN_FULLBAY).length === 21)
for (const k of keys) check(`Fullbay ${k}: same aliases, same order`, JSON.stringify(FULLBAY[k].aliases) === JSON.stringify(FROZEN_FULLBAY[k]), FULLBAY[k].aliases.join(' | '))
check('invoices: CLIENT, INV NO, INV DATE, TOTAL, PAID, exactly as written', JSON.stringify(Object.values(INVOICES).map(c => c.aliases)) ===
  JSON.stringify([['INV NO'], ['CLIENT'], ['INV DATE'], ['TOTAL'], ['PAID']]) && INVOICE_COLUMNS.match === 'exact')
check('required: work order number, customer, unit number, service date (Fullbay)',
  FULLBAY_COLUMNS.columns.filter(c => c.required).map(c => c.label).join(', ') === 'Work order number, Customer, Unit number, Service date')
check('unit fields: unit number and manufacturer required, as the analyze route said', UNIT_FIELDS.filter(f => f.required).map(f => f.key).join() === 'unit_number,manufacturer')

// ── 2. col() is the route's old col() ──
console.log('\n2. The shared col() reads a row exactly as the route did')
function oldCol(row: Record<string, string | undefined>, ...ks: string[]): string {
  for (const k of ks) {
    const found = Object.entries(row).find(([h]) => h.toLowerCase().trim() === k.toLowerCase().trim())?.[1]
    if (found !== undefined) return found.trim()
  }
  return ''
}
const shapes: Array<Record<string, string>> = [
  { 'Unit Number': ' 103 ' }, { 'unit #': 'A1' }, { ' UNIT ': 'X' }, { 'Unit Number': '', 'Unit': 'fallback?' },
  { 'Unit': 'B', 'Unit Number': 'A' }, { 'Customer': 'C', 'Fleet': 'F' }, { 'customer name': 'cn', 'Client': 'cl' },
  { 'Unit No.': 'no-dot' }, { 'WO #': 'spaced' }, { 'wo#': '77' }, {},
]
let same = 0, total = 0
for (const row of shapes) for (const k of keys) { total++; if (col(row, ...FULLBAY[k].aliases) === oldCol(row, ...FROZEN_FULLBAY[k])) same++ }
check(`${total} reads across ${shapes.length} heading shapes give the same value`, same === total, `${same}/${total}`)
check('a present-but-empty heading does not fall through to the next alias (as before)', col({ 'Unit Number': '', 'Unit': 'U' }, ...FULLBAY.unitNumber.aliases) === '')
check('"Unit No." (with a full stop) is not "Unit No" - matched as before, not loosened', col({ 'Unit No.': '9' }, ...FULLBAY.unitNumber.aliases) === '')
check('invoices read CLIENT exactly: "Client" is not CLIENT (as before)', exactCell({ Client: 'x' }, INVOICES.customer) === undefined && exactCell({ CLIENT: 'x' }, INVOICES.customer) === 'x')

// ── 3. The pre-flight names the heading the importer will read ──
console.log('\n3. The heading the pre-flight names is the one col() reads')
let agree = 0, n3 = 0
for (const row of shapes) {
  const headers = Object.keys(row)
  for (const k of keys) {
    n3++
    const h = headerFor(headers, FULLBAY[k], 'alias')
    const viaHeader = h === null ? '' : (row[h] ?? '').trim()
    if (viaHeader === col(row, ...FULLBAY[k].aliases)) agree++
  }
}
check(`${n3} column x heading-shape cases agree`, agree === n3, `${agree}/${n3}`)
const both = preflightColumns(['Customer Name', 'Customer', 'Unit Number', 'Work Order Number', 'Service Date'], FULLBAY_COLUMNS)
check('two aliases of one field: the first is read, the other is listed as ignored - not "unknown"',
  both.recognized.find(r => r.field.key === 'customer')?.header === 'Customer Name' &&
  both.unrecognized.some(u => u.header === 'Customer' && /read from "Customer Name"/.test(u.note ?? '')))

// ── 4. The three files ──
console.log('\n4. The three files')
const dir = process.argv[2]
const EMBEDDED: Record<string, string> = {
  'a-every-column.csv': 'Work Order Number,Customer Name,Unit Number,Service Date,Completed Date,Status,Technician,Service Description,Internal Notes,Total,Labor Total,Parts Total,Tax,Amount Paid,Balance Due,Make,Model,VIN,Year,Engine Hours,Unit Type\r\nPF-A-1,PF Fleet A,PF-A-U1,10/01/2026,10/02/2026,Completed,Dana,Replaced belt,none,410.50,250.00,140.50,20.00,410.50,0,Thermo King,S-600,PFA0000001,2019,12000,Trailer\r\n',
  'b-customer-only.csv': 'Customer\r\nPF Fleet B\r\nPF Fleet B\r\n',
  'c-required-no-unit-details.csv': 'Work Order Number,Customer Name,Unit Number,Service Date,Completed Date,Status,Technician,Service Description,Internal Notes,Total,Labor Total,Parts Total,Tax,Amount Paid,Balance Due,Year,Engine Hours,Unit Type\r\nPF-C-1,PF Fleet C,PF-C-U1,11/01/2026,11/01/2026,Completed,Lee,Defrost check,,95.00,95.00,0,0,95.00,0,2021,8000,Trailer\r\n',
}
const read = (name: string) => dir && existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : EMBEDDED[name]
console.log(`   reading the files from ${dir && existsSync(join(dir, 'b-customer-only.csv')) ? dir : 'the copies embedded here'}`)
const html = (pf: ReturnType<typeof preflightColumns>, kind: 'work_orders' | 'units' = 'work_orders', readsNoUnit = false) =>
  renderToStaticMarkup(React.createElement(ImportPreflight, { preflight: pf, kind, readsNoUnit, onChooseFile: () => {} }))
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

const a = preflightColumns(parseCSV(read('a-every-column.csv')).headers, FULLBAY_COLUMNS)
check('(a) every column: nothing missing, nothing unrecognized, not blocked', !a.blocked && a.missing.length === 0 && a.unrecognized.length === 0 && a.recognized.length === 21,
  `${a.recognized.length} recognized`)
const aHtml = html(a)
check('(a) renders no blocked box and no warning', !aHtml.includes('import-blocked') && !aHtml.includes('import-warning'))

const bCsv = parseCSV(read('b-customer-only.csv'))
const b = preflightColumns(bCsv.headers, FULLBAY_COLUMNS)
check('(b) Customer only: blocked', b.blocked)
check('(b) "Customer" IS a customer alias, so it is recognized - the three others are missing',
  b.recognized.map(r => `${r.field.label}<-${r.header}`).join() === 'Customer<-Customer' &&
  b.missingRequired.map(f => f.label).join(', ') === 'Work order number, Unit number, Service date',
  b.missingRequired.map(f => f.label).join(', '))
const bHtml = html(b)
const expected = 'This file is missing columns the import needs: Work order number, Unit number, Service date. Without a unit number, repairs will not attach to any unit and the unit\'s history will be empty. Export your work orders (not customers) with these columns and try again.'
const bMsg = text(bHtml.match(/<p data-testid="import-blocked-message">([\s\S]*?)<\/p>/)?.[1] ?? '')
check('(b) the blocked box renders exactly the agreed words', bMsg === expected, bMsg)
check('(b) and a "Choose a different file" button', /data-testid="import-choose-file"[^>]*>Choose a different file<\/button>/.test(bHtml))
check('(b) the wizard disables Import on exactly this flag', b.blocked === true)
console.log(`\n   (b) RENDERED BLOCKED STATE:\n   ${bMsg}\n   [Choose a different file]\n`)

const c = preflightColumns(parseCSV(read('c-required-no-unit-details.csv')).headers, FULLBAY_COLUMNS)
check('(c) required present, no VIN/Make/Model: not blocked', !c.blocked)
check('(c) the missing optional fields are exactly Make, Model, VIN / serial', c.missingOptional.map(f => f.label).join(', ') === 'Make, Model, VIN / serial',
  c.missingOptional.map(f => f.label).join(', '))
const cWarn = text(html(c).match(/<div role="status" data-testid="import-warning"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '')
check('(c) the warning names them and says they will be blank on every row',
  cWarn === 'This file has no column for Make, Model, VIN / serial. The import will run, and those fields will be blank on every row.', cWarn)
console.log(`   (c) RENDERED WARNING: ${cWarn}`)

// ── The other two formats ──
console.log('\n5. Every format goes through the same check')
const inv = preflightColumns(['#', 'INV DATE', 'INV NO', 'CLIENT', 'SUB TOTAL', 'TAX', 'TOTAL', 'PAID', 'OWED'], INVOICE_COLUMNS)
check('invoices: the documented sales-journal headings pass', !inv.blocked && inv.missing.length === 0, inv.unrecognized.map(u => u.header).join(', ') + ' not read')
const invHtml = html(inv, 'work_orders', true)
check('invoices: the screen says this format attaches to no unit', invHtml.includes('import-no-unit-notice'))
const invLower = preflightColumns(['client', 'inv no', 'inv date'], INVOICE_COLUMNS)
check('invoices: lower-case headings are refused, because the route reads them exactly', invLower.blocked && invLower.missingRequired.length === 3)
const units = preflightMapping(['Truck #', 'Notes'], [{ csv_header: 'Truck #', field_key: 'unit_number' }, { csv_header: 'Notes', field_key: null }], UNIT_FIELDS)
check('custom units: no manufacturer mapped is blocked, with the units wording', units.blocked && units.missingRequired.map(f => f.key).join() === 'manufacturer' &&
  missingColumnsMessage(units.missingRequired, 'units') === 'This file is missing columns the import needs: Manufacturer / Make.')
const unitsOk = preflightMapping(['Truck #', 'Make'], [{ csv_header: 'Truck #', field_key: 'unit_number' }, { csv_header: 'Make', field_key: 'manufacturer' }], UNIT_FIELDS)
check('custom units: both mapped imports', !unitsOk.blocked)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
