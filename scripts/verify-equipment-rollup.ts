// Unit tests for src/lib/hd/equipment-rollup.ts. Pure - no database.
//   npx tsx scripts/verify-equipment-rollup.ts
//
// FIXTURES ARE REAL ROW SHAPES. The invoice line_items are INV-2026-0020's own labor and
// part lines (read from the live row on 2026-10-19), the imported work order mirrors one
// of the 1,525 "Imported Invoice" rows (a total, dates, no unit, no hours, no lines), and
// the work-order line rows use hd_work_order_line_items' real columns - where `total`
// is the SELL figure and unit_cost is cost.

import {
  jobsFor, rollupByCategory, rollupByUnit, peakUnitsInPossession, workOrdersMissingAuthorization,
  localDate, UNCATEGORIZED, NO_UNIT,
  type RollupInput, type InvoiceRow, type WorkOrderRow, type UnitRow,
} from '../src/lib/hd/equipment-rollup'

let failed = 0, passed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`)
}

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const TZ = 'America/New_York'
const YEAR = { from: '2026-01-01', to: '2026-12-31' }

// INV-2026-0020's lines, as stored.
const LINES = [
  { id: 'l1', type: 'labor', amount: 202.5, quantity: 0, unit_cost: 0, book_hours: 1.5, description: 'test labor', part_number: '', mobile_hours: 1.5 },
  { id: 'l2', type: 'parts', amount: 3.9, quantity: 1, unit_cost: 3.9, description: 'Test 09', part_number: 'Test 09', mobile_hours: 0, markup_percent: 30, unit_cost_base: 3 },
]

function unit(id: string, over: Partial<UnitRow> = {}): UnitRow {
  return {
    id, user_id: SHOP, unit_number: id, manufacturer: 'Thermo King', model: 'S-600', year: 2018,
    serial_number: `SN-${id}`, category_id: 'cat-reefer', fleet_account_id: 'fleet-1', active: true,
    estimated_value: null, ...over,
  }
}
function invoice(id: string, over: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id, user_id: SHOP, invoice_number: `INV-${id}`, work_order_id: null, unit_id: 'u1',
    status: 'paid', created_at: '2026-06-10T15:00:00+00:00',
    total: 225.11, subtotal_labor: 202.5, subtotal_parts: 3.9, tax_amount: 18.71,
    diagnostic_fee: null, road_call_fee: 0, travel_amount: 0, mileage_amount: 0, shop_supplies_fee: 0,
    line_items: LINES, ...over,
  }
}
function workOrder(id: string, over: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id, user_id: SHOP, work_order_number: `WO-${id}`, unit_id: 'u1', status: 'open', service_type: 'Diagnostic',
    total_amount: null, labor_hours: null, tax_amount: null, diagnostic_fee: null, road_call_fee: null,
    travel_amount: null, mileage_amount: null, shop_supplies_fee: null,
    created_at: '2026-06-01T14:00:00+00:00', started_at: null, arrived_at: null, completed_at: null,
    authorized_at: '2026-06-01T14:00:00+00:00', ...over,
  }
}
function base(over: Partial<RollupInput> = {}): RollupInput {
  return {
    userId: SHOP, range: YEAR, timeZone: TZ,
    categories: [
      { id: 'cat-reefer', user_id: SHOP, name: 'Reefer Unit', sort_order: 10, is_active: true },
      { id: 'cat-truck',  user_id: SHOP, name: 'Truck',       sort_order: 20, is_active: true },
    ],
    fleets: [{ id: 'fleet-1', user_id: SHOP, fleet_name: 'LTL Pros INC' }],
    units: [unit('u1'), unit('u2', { category_id: null })],
    invoices: [], workOrders: [], workOrderLines: [], ...over,
  }
}

console.log('\n1. a unit with several invoiced jobs rolls up correctly')
{
  const input = base({
    invoices: [
      invoice('a'),
      invoice('b', { created_at: '2026-07-01T15:00:00+00:00', status: 'paid' }),
      invoice('c', { created_at: '2026-08-05T15:00:00+00:00', status: 'paid', total: 100, subtotal_labor: 100, subtotal_parts: 0, tax_amount: 0, line_items: [LINES[0]] }),
    ],
  })
  const u = rollupByUnit(input).find(x => x.unitId === 'u1')
  check('three jobs on u1', u?.jobs === 3, `got ${u?.jobs}`)
  check('hours are summed from the labor lines (1.5 x 3)', u?.laborHours.value === 4.5, `got ${u?.laborHours.value}`)
  check('invoiced is the stored totals summed', u?.invoiced === 550.22, `got ${u?.invoiced}`)
  check('last service date is the latest job', u?.lastServiceDate === '2026-08-05', `got ${u?.lastServiceDate}`)
  const c = rollupByCategory(input).find(x => x.key === 'cat-reefer')
  check('its category carries the same totals', c?.jobs === 3 && c?.invoiced === 550.22 && c?.unitsServiced === 1, JSON.stringify(c))
  check('labor revenue is the stored subtotal_labor, not a recompute', c?.laborRevenue.value === 505, `got ${c?.laborRevenue.value}`)
  check('parts revenue is the stored subtotal_parts (sell)', c?.partsRevenue.value === 7.8, `got ${c?.partsRevenue.value}`)
}

console.log('\n2. a work order with no invoice does not count as a job')
{
  const input = base({
    workOrders: [
      workOrder('open1', { status: 'open', total_amount: 500 }),                 // open: intent
      workOrder('closed-no-total', { status: 'completed', total_amount: null }), // nothing recorded
      workOrder('billed', { status: 'invoiced', total_amount: 225.11 }),         // has an invoice below
    ],
    invoices: [invoice('x', { work_order_id: 'billed' })],
  })
  const jobs = jobsFor(input)
  check('only the invoice is a job', jobs.length === 1 && jobs[0].source === 'invoice', JSON.stringify(jobs.map(j => j.id)))
  check('a work order with an invoice is counted once, through the invoice', !jobs.some(j => j.id === 'billed'))
}

console.log('\n2b. a CLOSED work order with a recorded total counts, labelled, with unknowns as unknown')
{
  // Mirrors a real "Imported Invoice" row: total + dates, no unit, no hours, no lines.
  const imported = workOrder('imp', {
    status: 'invoiced', service_type: 'Imported Invoice', unit_id: null, total_amount: 1330.46,
    started_at: '2026-05-19T00:00:00+00:00', completed_at: '2026-05-19T00:00:00+00:00', authorized_at: null,
  })
  const input = base({ workOrders: [imported] })
  const [j] = jobsFor(input)
  check('it is a job with source work_order', j?.source === 'work_order', JSON.stringify(j))
  check('hours are null, not 0', j?.laborHours === null, `got ${j?.laborHours}`)
  check('collected is null, not 0', j?.collected === null, `got ${j?.collected}`)
  check('labor / parts split is null, not 0', j?.laborRevenue === null && j?.partsRevenue === null)
  const noUnit = rollupByCategory(input).find(c => c.key === NO_UNIT)
  check('a job with no unit rolls up under "No unit recorded", not dropped', noUnit?.jobs === 1 && noUnit?.invoiced === 1330.46, JSON.stringify(noUnit))
  check('its hours say unknown: value null, 1 job missing', noUnit?.laborHours.value === null && noUnit?.laborHours.missing === 1)
}

console.log('\n2c. a closed work order with line items reads hours and sell totals off the lines')
{
  const input = base({
    workOrders: [workOrder('wl', { status: 'completed', total_amount: 300, completed_at: '2026-04-02T18:00:00+00:00' })],
    workOrderLines: [
      // hd_work_order_line_items: labor hours in quantity; total is the SELL figure.
      { work_order_id: 'wl', type: 'labor', quantity: 2, total: 270 },
      { work_order_id: 'wl', type: 'part',  quantity: 1, total: 30 },
    ],
  })
  const [j] = jobsFor(input)
  check('hours from the labor line quantity', j?.laborHours === 2, `got ${j?.laborHours}`)
  check('labor and parts revenue from line totals (sell)', j?.laborRevenue === 270 && j?.partsRevenue === 30)
}

console.log('\n3. an unpaid invoice makes invoiced and collected differ')
{
  const input = base({
    invoices: [invoice('p', { status: 'paid' }), invoice('u', { status: 'unpaid', created_at: '2026-06-11T15:00:00+00:00' })],
  })
  const c = rollupByCategory(input).find(x => x.key === 'cat-reefer')!
  check('invoiced counts both', c.invoiced === 450.22, `got ${c.invoiced}`)
  check('collected counts only the paid one', c.collected.value === 225.11, `got ${c.collected.value}`)
  check('an unpaid invoice is a known 0 collected, not unknown', c.collected.missing === 0)
  const partial = rollupByCategory(base({ invoices: [invoice('pt', { status: 'partial' })] })).find(x => x.key === 'cat-reefer')!
  check('a partial invoice is unknown collected (no amount-paid column)', partial.collected.value === null && partial.collected.missing === 1)
  const voided = jobsFor(base({ invoices: [invoice('v', { status: 'void' })] }))
  check('a void invoice is not a job', voided.length === 0)
}

console.log('\n4. an uncategorized unit appears under Uncategorized')
{
  const input = base({ invoices: [invoice('n', { unit_id: 'u2' })] })
  const cats = rollupByCategory(input)
  const un = cats.find(c => c.key === UNCATEGORIZED)
  check('Uncategorized row exists with the job', un?.jobs === 1 && un?.unitsServiced === 1, JSON.stringify(un))
  check('it is labelled "Uncategorized"', un?.name === 'Uncategorized')
  const u = rollupByUnit(input).find(x => x.unitId === 'u2')
  check('the unit row names its category Uncategorized', u?.categoryName === 'Uncategorized')
  check('every active category still appears, with 0 jobs', cats.some(c => c.key === 'cat-truck' && c.jobs === 0))
  const unitsInClass = cats.find(c => c.key === UNCATEGORIZED)?.unitsInClass
  check('units in class counts the uncategorized unit', unitsInClass === 1, `got ${unitsInClass}`)
}

console.log('\n5. two businesses cannot see each other\'s rows')
{
  const input = base({
    units: [unit('u1'), unit('ub', { user_id: OTHER, category_id: 'cat-b' })],
    categories: [
      { id: 'cat-reefer', user_id: SHOP, name: 'Reefer Unit', sort_order: 10, is_active: true },
      { id: 'cat-b', user_id: OTHER, name: 'Boom', sort_order: 10, is_active: true },
    ],
    fleets: [{ id: 'fleet-1', user_id: SHOP, fleet_name: 'LTL Pros INC' }, { id: 'fb', user_id: OTHER, fleet_name: 'Other Fleet' }],
    invoices: [invoice('mine'), invoice('theirs', { user_id: OTHER, unit_id: 'ub', total: 9999 })],
    workOrders: [workOrder('theirs-wo', { user_id: OTHER, status: 'completed', total_amount: 777, unit_id: 'ub', authorized_at: null })],
  })
  const jobs = jobsFor(input)
  check('only this shop\'s invoice is a job', jobs.length === 1 && jobs[0].id === 'mine', JSON.stringify(jobs.map(j => j.id)))
  const cats = rollupByCategory(input)
  check('the other shop\'s category does not appear', !cats.some(c => c.name === 'Boom'))
  check('totals exclude the other shop\'s money', cats.reduce((s, c) => s + c.invoiced, 0) === 225.11)
  // Even an invoice of mine pointing at THEIR unit id must not pull their unit in.
  const cross = base({ units: [unit('ub', { user_id: OTHER })], invoices: [invoice('x', { unit_id: 'ub' })] })
  check('a unit id from another shop is treated as no unit', rollupByUnit(cross).length === 0 && rollupByCategory(cross).some(c => c.key === NO_UNIT))
  check('their work orders are not in my authorization count', workOrdersMissingAuthorization(input).checked === 0)
}

console.log('\n6. date range boundaries include the right rows and exclude the wrong ones')
{
  // 2026-12-31 23:30 Eastern is 2027-01-01 04:30 UTC - it belongs to 2026 for this shop.
  const input = base({
    invoices: [
      invoice('first', { created_at: '2026-01-01T05:00:00+00:00' }),   // Jan 1 00:00 Eastern - in
      invoice('last',  { created_at: '2027-01-01T04:30:00+00:00' }),   // Dec 31 23:30 Eastern - in
      invoice('before',{ created_at: '2026-01-01T04:59:00+00:00' }),   // Dec 31 2025 23:59 Eastern - out
      invoice('after', { created_at: '2027-01-01T05:00:00+00:00' }),   // Jan 1 2027 00:00 Eastern - out
    ],
  })
  const ids = jobsFor(input).map(j => j.id).sort()
  check('both boundary days are in, the days either side are out', JSON.stringify(ids) === JSON.stringify(['first', 'last']), JSON.stringify(ids))
  check('the date is the shop\'s calendar day', localDate('2027-01-01T04:30:00+00:00', TZ) === '2026-12-31')
}

console.log('\n7. peak concurrent units in possession')
{
  const input = base({
    units: [unit('u1', { estimated_value: 40000 }), unit('u2', { estimated_value: null }), unit('u3', { estimated_value: 10000 })],
    workOrders: [
      workOrder('w1', { unit_id: 'u1', arrived_at: '2026-03-02T14:00:00+00:00', completed_at: '2026-03-05T20:00:00+00:00', status: 'completed' }),
      workOrder('w2', { unit_id: 'u2', arrived_at: '2026-03-04T14:00:00+00:00', completed_at: '2026-03-06T20:00:00+00:00', status: 'completed' }),
      workOrder('w3', { unit_id: 'u1', arrived_at: '2026-03-04T15:00:00+00:00', completed_at: '2026-03-04T20:00:00+00:00', status: 'completed' }), // same unit, counted once
      workOrder('w4', { unit_id: null, arrived_at: '2026-03-04T16:00:00+00:00', completed_at: '2026-03-04T21:00:00+00:00', status: 'completed' }),
      workOrder('imp', { service_type: 'Imported Invoice', unit_id: 'u3', started_at: '2026-03-04T00:00:00+00:00', status: 'open' }),
    ],
  })
  const p = peakUnitsInPossession(input)
  check('peak is 3 units on 2026-03-04 (u1 once, u2, one unlinked)', p.peakUnits === 3 && p.peakDate === '2026-03-04', JSON.stringify(p))
  check('the unlinked work order is counted and said so', p.unlinkedAtPeak === 1)
  check('known value is only the recorded value (u1 40,000)', p.knownValueAtPeak === 40000, `got ${p.knownValueAtPeak}`)
  check('units with no value are counted, not treated as 0', p.unitsWithoutValueAtPeak === 2, `got ${p.unitsWithoutValueAtPeak}`)
  check('imported history is excluded and counted', p.importedExcluded === 1)
  const none = peakUnitsInPossession(base({ units: [unit('u1')], workOrders: [workOrder('o', { arrived_at: '2026-02-01T14:00:00+00:00' })] }))
  check('a unit with no value at all gives knownValue null, not 0', none.knownValueAtPeak === null && none.unitsWithoutValueAtPeak === 1, JSON.stringify(none))
}

console.log('\n8. work orders with no recorded authorization')
{
  const input = base({
    workOrders: [
      workOrder('ok'),
      workOrder('missing', { authorized_at: null }),
      workOrder('out-of-range', { authorized_at: null, created_at: '2025-06-01T14:00:00+00:00' }),
      workOrder('imported', { authorized_at: null, service_type: 'Imported Invoice' }),
      workOrder('cancelled', { authorized_at: null, status: 'cancelled' }),
    ],
  })
  const a = workOrdersMissingAuthorization(input)
  check('one missing, named', a.missing === 1 && a.workOrderNumbers[0] === 'WO-missing', JSON.stringify(a))
  check('imported history is excluded and counted, not reported missing', a.importedExcluded === 1 && a.checked === 2)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
