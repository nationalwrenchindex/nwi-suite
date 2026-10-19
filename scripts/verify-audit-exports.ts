// Unit tests for the HD insurance audit exports. Pure - no database, no network.
//   npx tsx scripts/verify-audit-exports.ts
//
// Covers src/lib/hd/audit-labels.ts, audit-csv.ts, audit-schedule.ts, audit-packet.ts
// and audit-pdf.ts.
//
// FIXTURES ARE REAL ROW SHAPES, not assumed ones:
//   * invoice line_items are INV-2026-0020's own labor and part lines, as already used
//     by scripts/verify-equipment-rollup.ts (read from the live row 2026-10-19): the
//     part's unit_cost 3.9 is the SELL price, unit_cost_base 3 is the cost.
//   * quote line_items follow the shape QuoteForm.tsx writes (labor: mobile_hours and
//     amount; parts: unit_cost = SELL, unit_cost_base = cost).
//   * hd_work_order_line_items rows use that table's columns - unit_price SELL,
//     unit_cost COST - and the fixture carries a unit_cost on purpose so a test can
//     prove the packet never prints it.
//   * the imported work order mirrors the "Imported Invoice" rows.

import { inflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { UNCATEGORIZED, NO_UNIT, type RollupInput, type InvoiceRow, type WorkOrderRow, type UnitRow } from '../src/lib/hd/equipment-rollup'
import {
  resolveAuditLabels, validateAuditLabels, isMissingLabelsColumn, categoryLabel,
  AUDIT_TEXT_DEFAULTS, DEFAULT_AUDIT_LABELS, MAX_COLUMN_LEN,
} from '../src/lib/hd/audit-labels'
import { toCsv, parseCsv, parseRange, exportFilename } from '../src/lib/hd/audit-csv'
import { buildAuditSchedule, auditScheduleCsv } from '../src/lib/hd/audit-schedule'
import {
  buildAuditPacket, auditPacketCsv, peakValueStatement, PACKET_CSV_HEADER,
  type PacketInput, type PacketWorkOrderRow, type PacketQuoteRow, type PacketInvoiceRow, type PacketWoLineRow,
} from '../src/lib/hd/audit-packet'
import { renderAuditSchedulePdf, renderAuditPacketPdf, AUDIT_FOOTER_SOURCE } from '../src/lib/hd/audit-pdf'

let failed = 0, passed = 0
function check(name: string, ok: boolean, detail: unknown = '') {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
}

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const TZ = 'America/New_York'
const YEAR = { from: '2026-01-01', to: '2026-12-31' }
const NOW = new Date('2026-10-19T16:00:00Z')
const SHOP_HEADER = { name: 'C&K Utility Equipment Service', addressLines: ['12 Yard Rd', 'Winston-Salem, NC 27101'] }
const CAT_REEFER = '11111111-1111-4111-8111-111111111111'
const CAT_TRUCK = '22222222-2222-4222-8222-222222222222'

// INV-2026-0020's lines, as stored.
const INV_LINES = [
  { id: 'l1', type: 'labor', amount: 202.5, quantity: 0, unit_cost: 0, book_hours: 1.5, description: 'test labor', part_number: '', mobile_hours: 1.5 },
  { id: 'l2', type: 'parts', amount: 3.9, quantity: 1, unit_cost: 3.9, description: 'Test 09', part_number: 'Test 09', mobile_hours: 0, markup_percent: 30, unit_cost_base: 3 },
]
// The shape QuoteForm.tsx writes.
const QUOTE_LINES = [
  { id: 'q1', type: 'labor', description: 'Diagnose reefer', book_hours: 1.5, book_hours_max: 1.5, mobile_hours: 1.5, mobile_hours_max: 1.5, requires_refrigeration: false, recharge_added: false, part_number: '', quantity: 0, unit_cost: 0, amount: 202.5, amount_max: 202.5 },
  { id: 'q2', type: 'parts', description: 'Test 09', book_hours: 0, book_hours_max: 0, mobile_hours: 0, mobile_hours_max: 0, requires_refrigeration: false, recharge_added: false, part_number: 'Test 09', quantity: 1, unit_cost: 3.9, unit_cost_base: 3, markup_percent: 30, amount: 3.9, amount_max: 3.9 },
]

function unit(id: string, over: Partial<UnitRow> = {}): UnitRow {
  return {
    id, user_id: SHOP, unit_number: id, manufacturer: 'Thermo King', model: 'S-600', year: 2018,
    serial_number: `SN-${id}`, category_id: CAT_REEFER, fleet_account_id: 'fleet-1', active: true,
    estimated_value: null, ...over,
  }
}
function invoice(id: string, over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id, user_id: SHOP, invoice_number: `INV-${id}`, work_order_id: null, unit_id: 'u1',
    status: 'paid', created_at: '2026-06-10T15:00:00+00:00',
    total: 225.11, subtotal_labor: 202.5, subtotal_parts: 3.9, tax_amount: 18.71,
    diagnostic_fee: null, road_call_fee: 0, travel_amount: 0, mileage_amount: 0, shop_supplies_fee: 0,
    line_items: INV_LINES, ...over,
  }
}
function workOrder(id: string, over: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id, user_id: SHOP, work_order_number: `WO-${id}`, unit_id: 'u1', status: 'open', service_type: 'Quote Approved',
    total_amount: null, labor_hours: null, tax_amount: null, diagnostic_fee: null, road_call_fee: null,
    travel_amount: null, mileage_amount: null, shop_supplies_fee: null,
    created_at: '2026-06-01T14:00:00+00:00', started_at: null, arrived_at: null, completed_at: null,
    authorized_at: '2026-06-01T13:00:00+00:00', ...over,
  }
}
function rollupBase(over: Partial<RollupInput> = {}): RollupInput {
  return {
    userId: SHOP, range: YEAR, timeZone: TZ,
    categories: [
      { id: CAT_REEFER, user_id: SHOP, name: 'Reefer Unit', sort_order: 10, is_active: true },
      { id: CAT_TRUCK,  user_id: SHOP, name: 'Truck',       sort_order: 20, is_active: true },
    ],
    fleets: [{ id: 'fleet-1', user_id: SHOP, fleet_name: 'LTL Pros INC' }],
    units: [unit('u1'), unit('u2', { category_id: null })],
    invoices: [], workOrders: [], workOrderLines: [], ...over,
  }
}

async function pdfText(bytes: Uint8Array): Promise<string[]> {
  // Every page's drawn text. pdf-lib writes Helvetica text as <hex> Tj inside flate
  // content streams; inflate each stream and decode the hex strings.
  const buf = Buffer.from(bytes)
  const doc = await PDFDocument.load(bytes)
  const out: string[] = []
  const raw = buf.toString('latin1')
  const re = /stream\r?\n/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    const chunk = buf.subarray(start, end)
    let text = ''
    try { text = inflateSync(chunk).toString('latin1') } catch { try { text = inflateSync(chunk.subarray(0, chunk.length - 1)).toString('latin1') } catch { continue } }
    const strings = [...text.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)].map(x => Buffer.from(x[1], 'hex').toString('latin1'))
    if (strings.length) out.push(strings.join('\n'))
  }
  if (out.length !== doc.getPageCount()) out.push(`__page_stream_count_mismatch_${out.length}_${doc.getPageCount()}`)
  return out
}

async function main() {
  // ─── 1. labels ───────────────────────────────────────────────────────────
  console.log('\n1. label resolution and validation')
  {
    const d = resolveAuditLabels(null)
    check('null column -> every default', JSON.stringify(d) === JSON.stringify(DEFAULT_AUDIT_LABELS))
    check('junk -> defaults', resolveAuditLabels('oops').text.classColumn === 'Equipment class' && resolveAuditLabels([1]).text.jobs === 'Jobs')
    const r = resolveAuditLabels({ text: { classColumn: '  Vehicle   type ', bogus: 'x', jobs: 42 }, categories: { [CAT_REEFER]: 'Refrigeration unit', notauuid: 'x', [NO_UNIT]: 'Unidentified' } })
    check('override applied and whitespace collapsed', r.text.classColumn === 'Vehicle type', r.text.classColumn)
    check('non-string value falls back to default', r.text.jobs === 'Jobs')
    check('unknown text key ignored', !('bogus' in r.text))
    check('category override by id', categoryLabel(r, CAT_REEFER, 'Reefer Unit') === 'Refrigeration unit')
    check('category default is its own name', categoryLabel(r, CAT_TRUCK, 'Truck') === 'Truck')
    check('synthetic key override', categoryLabel(r, NO_UNIT, 'No unit recorded') === 'Unidentified')
    check('non-uuid category key ignored', !('notauuid' in r.categories))
    check('resolve truncates an over-long stored label', resolveAuditLabels({ text: { jobs: 'x'.repeat(500) } }).text.jobs.length === MAX_COLUMN_LEN)

    const ok = validateAuditLabels({ text: { classColumn: 'Vehicle type', jobs: '', unitsInClass: 'Units in class' }, categories: { [CAT_REEFER]: 'Reefer', [UNCATEGORIZED]: 'Other', [CAT_TRUCK]: '' } }, new Set([CAT_REEFER, CAT_TRUCK]))
    check('valid body accepted', ok.ok)
    if (ok.ok) {
      check('empty string = default, not stored', !('jobs' in (ok.value.text ?? {})))
      check('value equal to default is not stored', !('unitsInClass' in (ok.value.text ?? {})))
      check('categories stored', ok.value.categories?.[CAT_REEFER] === 'Reefer' && ok.value.categories?.[UNCATEGORIZED] === 'Other' && !(CAT_TRUCK in (ok.value.categories ?? {})))
    }
    const bad1 = validateAuditLabels({ text: { notAKey: 'x' } })
    check('unknown label key refused', !bad1.ok && bad1.errors.some(e => e.includes('notAKey')))
    const bad2 = validateAuditLabels({ text: { jobs: 'x'.repeat(MAX_COLUMN_LEN + 1) } })
    check('over-long label refused', !bad2.ok)
    const bad3 = validateAuditLabels({ categories: { '33333333-3333-4333-8333-333333333333': 'x' } }, new Set([CAT_REEFER]))
    check('another shop\'s / unknown category id refused', !bad3.ok)
    const bad4 = validateAuditLabels({ extra: 1 })
    check('unknown top-level field refused', !bad4.ok)
    check('array body refused', !validateAuditLabels([]).ok)
    check('PGRST204 missing column detected', isMissingLabelsColumn({ code: 'PGRST204', message: "Could not find the 'hd_report_labels' column of 'profiles' in the schema cache" }))
    check('42703 missing column detected', isMissingLabelsColumn({ code: '42703', message: 'column profiles.hd_report_labels does not exist' }))
    check('unrelated error not treated as missing column', !isMissingLabelsColumn({ code: '42703', message: 'column profiles.other does not exist' }) && !isMissingLabelsColumn({ code: '23505', message: 'duplicate key' }))
  }

  // ─── 2. CSV and range ────────────────────────────────────────────────────
  console.log('\n2. CSV quoting and policy period parsing')
  {
    const csv = toCsv(['a', 'b,c', 'd'], [['x, y', 'say "hi"', 'line1\nline2'], [1234.5, null, -3], ['=SUM(A1)', true, undefined]])
    check('CRLF record separator', csv.split('\r\n').length === 5 && csv.endsWith('\r\n'))
    check('comma field quoted', csv.includes('"x, y"'))
    check('quotes doubled', csv.includes('"say ""hi"""'))
    check('newline field quoted', csv.includes('"line1\nline2"'))
    check('numbers unformatted, null empty', csv.split('\r\n')[2] === '1234.5,,-3', csv.split('\r\n')[2])
    check('formula text neutralised, negative number untouched', csv.split('\r\n')[3].startsWith("'=SUM(A1)"))
    const back = parseCsv(csv)
    check('round trip', back[1][0] === 'x, y' && back[1][1] === 'say "hi"' && back[1][2] === 'line1\nline2' && back[0][1] === 'b,c', back)

    const today = '2026-10-19'
    const d = parseRange(null, null, today)
    check('no dates -> current year', d.ok && d.from === '2026-01-01' && d.to === '2026-12-31')
    check('one date only -> 400', !parseRange('2026-01-01', null, today).ok)
    check('impossible date -> 400', !parseRange('2026-02-30', '2026-03-01', today).ok)
    check('malformed date -> 400', !parseRange('01/01/2026', '2026-03-01', today).ok)
    check('from after to -> 400', !parseRange('2026-05-01', '2026-04-01', today).ok)
    check('exactly 3 years accepted', parseRange('2024-01-01', '2026-12-31', today).ok)
    check('over 3 years -> 400', !parseRange('2024-01-01', '2027-01-01', today).ok)
    check('filename is header-safe', exportFilename('audit-schedule', '2026-01-01', '2026-12-31', 'csv') === 'audit-schedule-2026-01-01-to-2026-12-31.csv')
  }

  // ─── 3. schedule ─────────────────────────────────────────────────────────
  console.log('\n3. audit schedule')
  {
    const input = rollupBase({
      units: [unit('u1'), unit('u2', { category_id: null }), unit('u3', { category_id: CAT_TRUCK, manufacturer: 'International', model: '4300', serial_number: '1HTMMAAL0XH000001' }), unit('u4', { category_id: CAT_TRUCK })],
      invoices: [
        invoice('a'),
        invoice('b', { created_at: '2026-07-01T15:00:00+00:00' }),
        invoice('c', { unit_id: 'u2', status: 'sent' }),
        invoice('d', { unit_id: null, total: 100, line_items: [] }),          // no unit, no hours
        invoice('e', { unit_id: 'u3', status: 'void' }),                      // void: not a job
        invoice('f', { created_at: '2025-12-31T15:00:00+00:00' }),            // outside the period
        { ...invoice('g'), user_id: OTHER },                                    // another shop
      ],
    })
    const labels = resolveAuditLabels({ text: { classColumn: 'Vehicle type', totalInvoiced: 'Receipts' }, categories: { [CAT_REEFER]: 'Refrigeration unit' } })
    const s = buildAuditSchedule(input, SHOP_HEADER, labels, NOW)
    const byKey = new Map(s.categories.map(c => [c.key, c]))
    check('category label override applied', byKey.get(CAT_REEFER)?.label === 'Refrigeration unit')
    check('Uncategorized is its own row', byKey.get(UNCATEGORIZED)?.label === 'Uncategorized' && byKey.get(UNCATEGORIZED)?.jobs === 1)
    check('No unit recorded is its own row', byKey.get(NO_UNIT)?.label === 'No unit recorded' && byKey.get(NO_UNIT)?.jobs === 1)
    check('No unit recorded has no unit counts (null, not 0)', byKey.get(NO_UNIT)?.unitsInClass === null && byKey.get(NO_UNIT)?.unitsServiced === null)
    check('units in class counts active units serviced or not', byKey.get(CAT_TRUCK)?.unitsInClass === 2 && byKey.get(CAT_TRUCK)?.unitsServiced === 0)
    check('reefer: 2 jobs, 3 hours, 450.22 invoiced', byKey.get(CAT_REEFER)?.jobs === 2 && byKey.get(CAT_REEFER)?.laborHours === 3 && byKey.get(CAT_REEFER)?.invoiced === 450.22, byKey.get(CAT_REEFER))
    check('void, out-of-period and other-shop invoices excluded', s.total.jobs === 4, s.total)
    check('hours unknown on the no-unit job: null with a count', byKey.get(NO_UNIT)?.laborHours === null && byKey.get(NO_UNIT)?.jobsWithoutHours === 1)
    check('total invoiced = sum of categories', s.total.invoiced === Math.round(s.categories.reduce((x, c) => x + c.invoiced, 0) * 100) / 100, s.total)
    check('appendix totals reconcile with the category table', Math.round(s.units.reduce((x, u) => x + u.invoiced, 0) * 100) / 100 === s.total.invoiced && s.units.reduce((x, u) => x + u.jobs, 0) === s.total.jobs)
    check('appendix carries a No unit recorded row', s.units.some(u => u.unitId === null && u.classLabel === 'No unit recorded'))
    check('appendix unit row carries make/model/year/serial', s.units.some(u => u.unitIdentifier === 'u1' && u.make === 'Thermo King' && u.year === 2018 && u.serial === 'SN-u1'))

    const csv = auditScheduleCsv(s)
    const rows = parseCsv(csv)
    check('CSV header uses the labels', rows[0][1] === 'Vehicle type' && rows[0].includes('Receipts') && rows[0].includes('Serial / VIN'), rows[0])
    const reefer = rows.find(r => r[0] === 'category' && r[1] === 'Refrigeration unit')!
    check('CSV numbers unformatted', reefer[12] === '450.22' && !csv.includes('$'), reefer)
    const noUnitRow = rows.find(r => r[0] === 'category' && r[1] === 'No unit recorded')!
    check('CSV null hours empty + recorded-count column', noUnitRow[10] === '' && noUnitRow[11] === '1' && noUnitRow[2] === '', noUnitRow)
    check('CSV has category, total and unit sections', ['category', 'total', 'unit'].every(k => rows.some(r => r[0] === k)))
    check('CSV and PDF data are the same object (unit rows count)', rows.filter(r => r[0] === 'unit').length === s.units.length)

    const bytes = await renderAuditSchedulePdf(s)
    // AUDIT_PDF_OUT=<dir> writes the sample PDFs for a human to look at.
    if (process.env.AUDIT_PDF_OUT) writeFileSync(join(process.env.AUDIT_PDF_OUT, 'sample-audit-schedule.pdf'), bytes)
    check('schedule PDF has a PDF header', Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-')
    const doc = await PDFDocument.load(bytes)
    check('schedule PDF is cover + appendix = 2 pages', doc.getPageCount() === 2, doc.getPageCount())
    const pages = await pdfText(bytes)
    check('footer source line on every page', pages.length === 2 && pages.every(p => p.includes(AUDIT_FOOTER_SOURCE)), pages.map(p => p.slice(0, 80)))
    check('footer generated date on every page', pages.every(p => p.includes('Generated October 19, 2026')))
    check('header: shop name, address, policy period', pages[0].includes('C&K UTILITY EQUIPMENT SERVICE') && pages[0].includes('Winston-Salem, NC 27101') && pages[0].includes('January 1, 2026 to December 31, 2026'))
    check('relabelled class column printed', pages[0].includes('Vehicle type'))
    check('unknown hours print as Not recorded, never 0', pages[0].includes('Not recorded'))

    // Page breaking: 150 units forces the appendix across pages, header repeated.
    const many = rollupBase({
      units: Array.from({ length: 150 }, (_, i) => unit(`m${i}`, { unit_number: `M-${i}` })),
      invoices: Array.from({ length: 150 }, (_, i) => invoice(`m${i}`, { unit_id: `m${i}` })),
    })
    const big = await renderAuditSchedulePdf(buildAuditSchedule(many, SHOP_HEADER, DEFAULT_AUDIT_LABELS, NOW))
    const bigPages = await pdfText(big)
    check('large appendix spans several pages', bigPages.length >= 4, bigPages.length)
    check('table header repeats on every appendix page', bigPages.slice(1).every(p => p.includes(AUDIT_TEXT_DEFAULTS.serial)))
    check('every page carries Page n of N', bigPages.every((p, i) => p.includes(`Page ${i + 1} of ${bigPages.length}`)))
    check('unicode in operator text does not throw', (await renderAuditSchedulePdf(buildAuditSchedule(rollupBase({ units: [unit('u1', { unit_number: 'Ünit 1 — 🚚' })], invoices: [invoice('a')] }), SHOP_HEADER, DEFAULT_AUDIT_LABELS, NOW))).length > 0)
  }

  // ─── 4. packet ───────────────────────────────────────────────────────────
  console.log('\n4. audit packet')
  {
    const rollup = rollupBase({
      units: [unit('u1', { estimated_value: 40000 }), unit('u2', { category_id: null })],
      workOrders: [
        workOrder('1', { status: 'invoiced', completed_at: '2026-06-05T20:00:00+00:00', arrived_at: '2026-06-02T13:00:00+00:00' }),
        workOrder('2', { unit_id: 'u2', authorized_at: null, status: 'completed', created_at: '2026-06-03T14:00:00+00:00', completed_at: '2026-06-04T14:00:00+00:00' }),
        workOrder('3', { unit_id: null, status: 'invoiced', service_type: 'Imported Invoice', authorized_at: null, total_amount: 500, completed_at: '2026-06-03T14:00:00+00:00' }),
        workOrder('4', { status: 'cancelled', authorized_at: null }),
        workOrder('5', { created_at: '2025-11-01T14:00:00+00:00', authorized_at: null }),
        { ...workOrder('6', { authorized_at: null }), user_id: OTHER },
      ],
      invoices: [invoice('a', { work_order_id: '1', created_at: '2026-06-06T02:30:00+00:00' })],
    })
    const details: PacketWorkOrderRow[] = [
      {
        id: '1', user_id: SHOP, work_order_number: 'WO-1', status: 'invoiced', service_type: 'Quote Approved',
        created_at: '2026-06-01T14:00:00+00:00', completed_at: '2026-06-05T20:00:00+00:00',
        unit_id: 'u1', fleet_account_id: 'fleet-1', customer_name: 'Taylor Oil Company',
        unit_number: '103', unit_manufacturer: 'Carrier', unit_model: null, unit_year: '2017', unit_serial: null, vin: '1HTMMAAL0XH000103',
        truck_make: 'International', truck_model: 'S1800', truck_year: '2016',
        quote_id: 'q-1', tech_name: 'Kurt', labor_rate: 135,
        authorized_at: '2026-06-01T13:00:00+00:00', authorization_method: 'customer_link', customer_po_number: 'PO-778',
      },
      {
        id: '2', user_id: SHOP, work_order_number: 'WO-2', status: 'completed', service_type: 'Diagnostic',
        created_at: '2026-06-03T14:00:00+00:00', completed_at: '2026-06-04T14:00:00+00:00',
        unit_id: 'u2', customer_name: null, tech_name: null, labor_rate: 125,
      },
      ...[3, 4, 5].map(n => ({ id: String(n), user_id: SHOP, created_at: rollup.workOrders[n - 1].created_at, status: rollup.workOrders[n - 1].status, service_type: rollup.workOrders[n - 1].service_type })),
    ]
    const quotes: PacketQuoteRow[] = [{
      id: 'q-1', user_id: SHOP, quote_number: 'Q-2026-0042', status: 'approved', line_items: QUOTE_LINES, labor_rate: 135,
      subtotal_labor: 202.5, subtotal_parts: 3.9, diagnostic_fee: 0, road_call_fee: 35, travel_amount: 0, mileage_amount: null, shop_supplies_fee: null,
      tax_amount: 18.71, total: 260.11, approved_at: '2026-06-01T13:00:00+00:00', approval_method: 'customer_link',
      customer_response_note: 'Go ahead', customer_po_number: 'PO-778',
    }, { id: 'q-other', user_id: OTHER, quote_number: 'NOT MINE' }]
    const invoices: PacketInvoiceRow[] = [{
      id: 'a', user_id: SHOP, invoice_number: 'INV-2026-0020', work_order_id: '1', status: 'paid',
      created_at: '2026-06-06T02:30:00+00:00', total: 225.11, line_items: INV_LINES, labor_rate: 135, tech_name: null,
    }]
    const lines = [
      { work_order_id: '2', type: 'labor', description: 'Diag', quantity: 2, unit_price: 125, unit_cost: 40, total: 250, sort_order: 0 },
      { work_order_id: '2', type: 'part', description: 'Belt', part_number: 'B-1', quantity: 2, unit_price: 26, unit_cost: 20, total: 52, sort_order: 1 },
    ] as unknown as PacketWoLineRow[]
    const input: PacketInput = { rollup, workOrders: details, quotes, invoices, workOrderLines: lines, missingColumns: [] }
    const p = buildAuditPacket(input, SHOP_HEADER, DEFAULT_AUDIT_LABELS, NOW)

    check('packet holds the two live NWI work orders opened in range', p.entries.map(e => e.workOrderNumber).join() === 'WO-1,WO-2', p.entries.map(e => e.workOrderNumber))
    check('imported history excluded and counted', p.importedExcluded === 1)
    check('cancelled excluded and counted', p.cancelledExcluded === 1)
    check('packet population = authorization check population', p.authorization.checked === p.entries.length && p.authorization.importedExcluded === p.importedExcluded)
    check('missing authorization: WO-2 only', p.authorization.missing === 1 && p.authorization.workOrderNumbers.join() === 'WO-2', p.authorization)

    const e1 = p.entries[0], e2 = p.entries[1]
    check('unit: work order\'s recorded fields win', e1.unit.identifier === '103' && e1.unit.make === 'Carrier' && e1.unit.year === '2017')
    check('unit: record fills only the gaps, and says so', e1.unit.model === 'S-600' && e1.unit.serial === 'SN-u1' && e1.unit.filledFromUnitRecord.join() === 'model,serial', e1.unit)
    check('unit: VIN and truck from the work order', e1.unit.vin === '1HTMMAAL0XH000103' && e1.unit.truck === '2016 International S1800')
    check('unit class from the linked unit', e1.unit.classLabel === 'Reefer Unit' && e2.unit.classLabel === 'Uncategorized')
    check('customer and fleet', e1.customer === 'Taylor Oil Company' && e1.fleetAccount === 'LTL Pros INC' && e2.customer === null)
    check('dates in shop zone (invoice 02:30Z = June 5 local)', e1.opened === '2026-06-01' && e1.closed === '2026-06-05' && e1.invoiced === '2026-06-05', [e1.opened, e1.closed, e1.invoiced])
    check('authorization record copied', e1.authorization.authorizedAt === '2026-06-01T13:00:00+00:00' && e1.authorization.method === 'customer_link' && e1.authorization.poNumber === 'PO-778' && e1.authorization.quoteResponseNote === 'Go ahead')
    check('approved by is null - never invented', e1.authorization.approvedBy === null && e2.authorization.approvedBy === null)
    check('quote as presented: recorded labor rate and total', e1.quote?.laborRate === 135 && e1.quote?.total === 260.11 && e1.quote?.roadCallFee === 35)
    const qPart = e1.quote?.lines.find(l => l.type === 'parts')
    check('quote part price is SELL (unit_cost 3.9), not cost (unit_cost_base 3)', qPart?.unitPrice === 3.9, qPart)
    check('quote labor hours from mobile_hours', e1.quote?.lines.find(l => l.type === 'labor')?.hours === 1.5)
    check('invoiced WO: parts from the invoice at SELL', e1.linesSource === 'invoice' && e1.parts[0].unitPrice === 3.9 && e1.parts[0].amount === 3.9)
    check('invoiced WO: labor hours from mobile_hours, rate = invoice labor_rate', e1.labor[0].hours === 1.5 && e1.labor[0].rate === 135 && e1.labor[0].amount === 202.5)
    check('uninvoiced WO: lines from work order, unit_price (SELL) not unit_cost', e2.linesSource === 'work_order' && e2.parts[0].unitPrice === 26 && e2.labor[0].rate === 125 && e2.labor[0].hours === 2)
    check('tech: work order and invoice separately, null kept null', e1.techWorkOrder === 'Kurt' && e1.techInvoice === null)
    check('invoice number, total, status', e1.invoice?.number === 'INV-2026-0020' && e1.invoice?.total === 225.11 && e1.invoice?.status === 'paid' && e2.invoice === null)
    check('another shop\'s quote never attached', p.entries.every(e => e.quote?.number !== 'NOT MINE'))

    check('peak: 2 units on the same day', p.peak.peakUnits === 2 && p.peak.peakDate === '2026-06-03', p.peak)
    check('peak value: partial, missing never 0', peakValueStatement(p.peak) === '$40,000.00 for 1 unit; 1 unit in possession has no recorded value, so the true figure is higher.', peakValueStatement(p.peak))
    check('peak value: none recorded -> Not recorded', peakValueStatement({ peakUnits: 3, peakDate: '2026-01-02', unlinkedAtPeak: 0, knownValueAtPeak: null, unitsWithoutValueAtPeak: 3, importedExcluded: 0 }).startsWith('Not recorded'))
    check('peak value: all recorded', peakValueStatement({ peakUnits: 2, peakDate: '2026-01-02', unlinkedAtPeak: 0, knownValueAtPeak: 1500, unitsWithoutValueAtPeak: 0, importedExcluded: 0 }).startsWith('$1,500.00 (every unit'))

    const rows = parseCsv(auditPacketCsv(p))
    const col = (name: string) => PACKET_CSV_HEADER.indexOf(name)
    check('packet CSV: header + one row per work order', rows.length === 1 + p.entries.length && rows[0].join() === PACKET_CSV_HEADER.join())
    check('packet CSV: approved_by empty, approved_by_recorded no', rows[1][col('approved_by')] === '' && rows[1][col('approved_by_recorded')] === 'no')
    check('packet CSV: invoice total unformatted', rows[1][col('invoice_total')] === '225.11')
    check('packet CSV: no shop cost anywhere (3 / 40 / 20)', !rows.some(r => r[col('parts_installed')].includes('@ 3 ') || r[col('parts_installed')].includes('@ 20')), rows.map(r => r[col('parts_installed')]))
    check('packet CSV: uninvoiced row has empty invoice fields', rows[2][col('invoice_number')] === '' && rows[2][col('invoice_total')] === '')
    check('packet CSV: unit fields from unit record listed', rows[1][col('unit_fields_from_unit_record')] === 'model; serial')

    const bytes = await renderAuditPacketPdf(p)
    if (process.env.AUDIT_PDF_OUT) writeFileSync(join(process.env.AUDIT_PDF_OUT, 'sample-audit-packet.pdf'), bytes)
    check('packet PDF has a PDF header', Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-')
    const doc = await PDFDocument.load(bytes)
    check('packet PDF = cover + one page per work order', doc.getPageCount() === 1 + p.entries.length, doc.getPageCount())
    const pages = await pdfText(bytes)
    check('footer on every packet page', pages.every(t => t.includes(AUDIT_FOOTER_SOURCE) && t.includes('Generated October 19, 2026')))
    check('cover states no approver is recorded', pages[0].includes('records no approver name, identity or IP'))
    check('cover states imported exclusion', pages[0].includes('imported history'))
    check('cover lists the WO with no authorization', pages[0].includes('1 of 2: WO-2'))
    check('each work order page prints Approved by Not recorded', pages.slice(1).every(t => t.includes('APPROVED BY') && t.includes('Not recorded')))
    check('work order page carries its number', pages[1].includes('Work order WO-1') && pages[2].includes('Work order WO-2'))
    check('work order page never prints the shop cost', !pages[1].includes('$3.00') && !pages[2].includes('$40.00') && !pages[2].includes('$20.00'))

    const empty = buildAuditPacket({ ...input, workOrders: [], rollup: { ...rollup, workOrders: [] } }, SHOP_HEADER, DEFAULT_AUDIT_LABELS, NOW)
    const emptyDoc = await PDFDocument.load(await renderAuditPacketPdf(empty))
    check('empty period: a cover page only', emptyDoc.getPageCount() === 1 && empty.authorization.missing === 0)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

main().catch(err => { console.error(err); process.exit(1) })
