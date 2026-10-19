// Unit tests for src/lib/hd/by-equipment-view.ts. Pure - no database.
//   npx tsx scripts/verify-by-equipment-view.ts
//
// FIXTURES ARE BUILT BY THE REAL ROLLUP, not hand-shaped. The unit rows below are what
// rollupByUnit returns for invoices and work orders in the same row shapes
// scripts/verify-equipment-rollup.ts uses (INV-2026-0020's own line items; an imported
// "Imported Invoice" work order with a total and nothing else), so a field the view
// sorts or prints is a field the API actually sends.

import {
  jobsFor, rollupByCategory, rollupByUnit, NO_UNIT, UNCATEGORIZED,
  type RollupInput, type InvoiceRow, type WorkOrderRow, type UnitRow, type UnitRollup,
} from '../src/lib/hd/equipment-rollup'
import {
  ALL, NO_FLEET, DEFAULT_SORT, DEFAULT_FILTER, DAGGER,
  isYmd, shopToday, currentYearRange, parseRange,
  filterUnits, categoryOptions, fleetOptions, sortUnits, nextSort, firstDir, unitLabel,
  fmtMoney, fmtHoursValue, partialCell, missingNote, sourceNote, sourceBadge, fmtDay, auditHref,
} from '../src/lib/hd/by-equipment-view'

let failed = 0, passed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) passed++; else failed++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${ok ? '' : `  -- ${detail}`}`)
}

const SHOP = 'shop-a'
const TZ = 'America/New_York'
const YEAR = { from: '2026-01-01', to: '2026-12-31' }

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
function importedWo(id: string, over: Partial<WorkOrderRow> = {}): WorkOrderRow {
  return {
    id, user_id: SHOP, work_order_number: `WO-${id}`, unit_id: null, status: 'invoiced',
    service_type: 'Imported Invoice', total_amount: 480, labor_hours: null, tax_amount: null,
    travel_amount: null, mileage_amount: null, shop_supplies_fee: null,
    created_at: '2026-03-02T14:00:00+00:00', started_at: null, arrived_at: null,
    completed_at: '2026-03-02T14:00:00+00:00', authorized_at: null, ...over,
  }
}

const input: RollupInput = {
  userId: SHOP, range: YEAR, timeZone: TZ,
  categories: [
    { id: 'cat-reefer', user_id: SHOP, name: 'Reefer units', sort_order: 1, is_active: true },
    { id: 'cat-lift', user_id: SHOP, name: 'Aerial lifts', sort_order: 2, is_active: true },
  ],
  fleets: [
    { id: 'fleet-1', user_id: SHOP, fleet_name: 'Zephyr Freight' },
    { id: 'fleet-2', user_id: SHOP, fleet_name: 'Acme Haulage' },
  ],
  units: [
    unit('u1'),
    unit('u2', { category_id: 'cat-lift', fleet_account_id: 'fleet-2' }),
    unit('u3', { category_id: null, fleet_account_id: null }),
    unit('u4', { unit_number: null, category_id: 'cat-lift', fleet_account_id: 'fleet-2' }),
  ],
  invoices: [
    invoice('a1'), invoice('a2', { status: 'unpaid' }), invoice('a3', { status: 'partial' }),
    invoice('b1', { unit_id: 'u2', total: 1000 }),
    invoice('c1', { unit_id: 'u3', total: 50, line_items: [] }),
    invoice('d1', { unit_id: 'u4', total: 1000 }),
    invoice('none', { unit_id: null }),
  ],
  workOrders: [
    importedWo('imp1', { unit_id: 'u2' }),
    importedWo('imp2'),
  ],
  workOrderLines: [],
}
const jobs = jobsFor(input)
const cats = rollupByCategory(input, jobs)
const units = rollupByUnit(input, jobs)
const byId = (id: string) => units.find(u => u.unitId === id)!

console.log('\nrange parsing')
{
  check('real date', isYmd('2026-02-28') && isYmd('2024-02-29'))
  check('not a real date', !isYmd('2026-02-30') && !isYmd('2025-02-29') && !isYmd('2026-13-01') && !isYmd('26-01-01') && !isYmd('2026-1-1') && !isYmd(null))
  // 03:30 UTC Jan 1 2027 is still Dec 31 2026 in New York.
  const nyNewYear = new Date('2027-01-01T03:30:00Z')
  check('shop today is the shop calendar, not UTC', shopToday(TZ, nyNewYear) === '2026-12-31', shopToday(TZ, nyNewYear))
  const cy = currentYearRange(TZ, nyNewYear)
  check('current year in the shop zone', cy.from === '2026-01-01' && cy.to === '2026-12-31', JSON.stringify(cy))
  const cyUtc = currentYearRange('UTC', nyNewYear)
  check('same instant, UTC shop, is the new year', cyUtc.from === '2027-01-01' && cyUtc.to === '2027-01-01', JSON.stringify(cyUtc))

  const now = new Date('2026-10-19T16:00:00Z')
  const none = parseRange(null, null, TZ, now)
  check('no params defaults to the current year', none.ok && none.range.from === '2026-01-01' && none.range.to === '2026-10-19', JSON.stringify(none))
  const ok = parseRange('2026-01-01', '2026-06-30', TZ, now)
  check('valid range passes through', ok.ok && ok.range.from === '2026-01-01' && ok.range.to === '2026-06-30')
  check('single day is valid', parseRange('2026-05-05', '2026-05-05', TZ, now).ok)
  check('only from is refused', !parseRange('2026-01-01', null, TZ, now).ok)
  check('only to is refused', !parseRange(null, '2026-01-01', TZ, now).ok)
  check('malformed is refused', !parseRange('2026/01/01', '2026-02-01', TZ, now).ok && !parseRange('2026-01-01', 'today', TZ, now).ok)
  check('impossible date is refused', !parseRange('2026-02-30', '2026-03-01', TZ, now).ok)
  check('from after to is refused', !parseRange('2026-06-01', '2026-05-01', TZ, now).ok)
  check('exactly three years inclusive is allowed', parseRange('2024-01-01', '2026-12-31', TZ, now).ok)
  check('three years and a day is refused', !parseRange('2024-01-01', '2027-01-01', TZ, now).ok)
  check('a decade is refused', !parseRange('2016-01-01', '2026-01-01', TZ, now).ok)
}

console.log('\nfixture sanity (rollup output the view reads)')
{
  check('four units have jobs', units.length === 4, String(units.length))
  check('category table keeps Uncategorized and No unit recorded apart',
    cats.some(c => c.key === UNCATEGORIZED) && cats.some(c => c.key === NO_UNIT))
}

console.log('\nsort')
{
  const s = sortUnits(units)
  // u1: 3 jobs; u2: 2 jobs (b1 + imp1); u3: 1 job $50; u4: 1 job $1000.
  check('default is jobs descending', DEFAULT_SORT.key === 'jobs' && DEFAULT_SORT.dir === 'desc')
  check('default order: most jobs first, ties by invoiced desc',
    s.map(u => u.unitId).join(',') === 'u1,u2,u4,u3', s.map(u => u.unitId).join(','))
  const again = sortUnits([...units].reverse())
  check('stable: input order does not change the result', again.map(u => u.unitId).join(',') === s.map(u => u.unitId).join(','))
  const asc = sortUnits(units, { key: 'jobs', dir: 'asc' })
  check('jobs ascending, equal jobs keep the fixed tie-break', asc.map(u => u.unitId).join(',') === 'u4,u3,u2,u1', asc.map(u => u.unitId).join(','))

  // Collected: u1 has a partial invoice (missing 1) but a paid one, so value 225.11;
  // u2 has an imported WO (unknown) and a paid invoice: 1000. u3 paid 50. u4 paid 1000.
  const nullCollected: UnitRollup = { ...byId('u3'), unitId: 'u9', unitNumber: 'U9', collected: { value: null, missing: 1 } }
  const withNull = [...units, nullCollected]
  const cAsc = sortUnits(withNull, { key: 'collected', dir: 'asc' })
  const cDesc = sortUnits(withNull, { key: 'collected', dir: 'desc' })
  check('unknown collected sorts last ascending', cAsc[cAsc.length - 1].unitId === 'u9', cAsc.map(u => u.unitId).join(','))
  check('unknown collected sorts last descending', cDesc[cDesc.length - 1].unitId === 'u9', cDesc.map(u => u.unitId).join(','))
  check('collected desc, tie (u2/u4 at 1000) broken by jobs desc', cDesc.slice(0, 2).map(u => u.unitId).join(',') === 'u2,u4', cDesc.map(u => u.unitId).join(','))

  const h = sortUnits(units, { key: 'laborHours', dir: 'desc' })
  check('labor hours with null (u3: no lines) sorts last', h[h.length - 1].unitId === 'u3' && byId('u3').laborHours.value === null, h.map(u => `${u.unitId}:${u.laborHours.value}`).join(','))

  const f = sortUnits(units, { key: 'fleet', dir: 'asc' })
  check('fleet asc by name, no fleet last', f.map(u => u.fleetName ?? '-').join(',') === 'Acme Haulage,Acme Haulage,Zephyr Freight,-', f.map(u => u.fleetName ?? '-').join(','))
  const fd = sortUnits(units, { key: 'fleet', dir: 'desc' })
  check('fleet desc, no fleet still last', fd[fd.length - 1].fleetName === null)

  const c = sortUnits(units, { key: 'category', dir: 'asc' })
  check('category asc', c.map(u => u.categoryName).join(',') === 'Aerial lifts,Aerial lifts,Reefer units,Uncategorized', c.map(u => u.categoryName).join(','))

  const un = sortUnits(units, { key: 'unit', dir: 'asc' })
  check('unit asc, numeric-aware, null number falls back to make/model', un.map(unitLabel).join(',') === 'Thermo King S-600,u1,u2,u3', un.map(unitLabel).join(','))

  const inv = sortUnits(units, { key: 'invoiced', dir: 'desc' })
  check('invoiced desc', inv[0].invoiced >= inv[1].invoiced && inv[1].invoiced >= inv[2].invoiced && inv[2].invoiced >= inv[3].invoiced)

  const ls = sortUnits(units, { key: 'lastService', dir: 'desc' })
  check('last service desc', ls.every((u, i) => i === 0 || ls[i - 1].lastServiceDate >= u.lastServiceDate))

  check('does not mutate its input', units.map(u => u.unitId).join(',') === rollupByUnit(input, jobs).map(u => u.unitId).join(','))

  check('first click: numbers high first, text A first', firstDir('jobs') === 'desc' && firstDir('lastService') === 'desc' && firstDir('unit') === 'asc')
  check('click same column flips', nextSort(DEFAULT_SORT, 'jobs').dir === 'asc')
  check('click new column starts at its first direction', JSON.stringify(nextSort(DEFAULT_SORT, 'fleet')) === '{"key":"fleet","dir":"asc"}')
}

console.log('\nfilter')
{
  check('default filter keeps everything', filterUnits(units, DEFAULT_FILTER).length === units.length)
  const lifts = filterUnits(units, { categoryKey: 'cat-lift', fleetId: ALL })
  check('by category key', lifts.map(u => u.unitId).sort().join(',') === 'u2,u4')
  const unc = filterUnits(units, { categoryKey: UNCATEGORIZED, fleetId: ALL })
  check('by Uncategorized', unc.length === 1 && unc[0].unitId === 'u3')
  const acme = filterUnits(units, { categoryKey: ALL, fleetId: 'fleet-2' })
  check('by fleet id', acme.map(u => u.unitId).sort().join(',') === 'u2,u4')
  const noFleet = filterUnits(units, { categoryKey: ALL, fleetId: NO_FLEET })
  check('by no fleet account', noFleet.length === 1 && noFleet[0].unitId === 'u3')
  check('both filters combine', filterUnits(units, { categoryKey: 'cat-reefer', fleetId: 'fleet-2' }).length === 0)

  const co = categoryOptions(units, cats)
  check('category options: only categories a unit row is in, in category-table order',
    co.map(o => o.value).join(',') === `cat-reefer,cat-lift,${UNCATEGORIZED}`, co.map(o => o.value).join(','))
  check('category options never offer No unit recorded', !co.some(o => o.value === NO_UNIT))
  const fo = fleetOptions(units)
  check('fleet options by name, then No fleet account', fo.map(o => o.label).join(',') === 'Acme Haulage,Zephyr Freight,No fleet account', fo.map(o => o.label).join(','))
}

console.log('\nformat')
{
  check('money', fmtMoney(1234.5) === '$1,234.50' && fmtMoney(0) === '$0.00' && fmtMoney(-5) === '-$5.00')
  check('null money is a dash', fmtMoney(null) === '-' && fmtMoney(undefined) === '-')
  check('hours', fmtHoursValue(4.5) === '4.5' && fmtHoursValue(0) === '0.0')
  check('null hours is a dash, never 0', fmtHoursValue(null) === '-')

  const unknown = partialCell({ value: null, missing: 3 }, 'hours')
  check('all-unknown cell: dash, not partial, still says how many', unknown.text === '-' && !unknown.partial && unknown.note === '3 jobs not recorded', JSON.stringify(unknown))
  const part = partialCell({ value: 225.11, missing: 1 }, 'money')
  check('partial cell: value, partial flag, note', part.text === '$225.11' && part.partial && part.note === '1 job not recorded', JSON.stringify(part))
  const whole = partialCell({ value: 10, missing: 0 }, 'money')
  check('whole cell: no flag, no note', !whole.partial && whole.note === null)
  check('missing note', missingNote(0) === null && missingNote(1) === '1 job not recorded' && missingNote(2) === '2 jobs not recorded')
  check('dagger is the dagger', DAGGER === '†')

  // From the real rollup: u1 has a partial invoice, so its collected is partial.
  const u1c = partialCell(byId('u1').collected, 'money')
  check('rollup: u1 collected is partial (one partial invoice)', u1c.partial && u1c.text === '$225.11', JSON.stringify(byId('u1').collected))
  const noUnit = cats.find(c => c.key === NO_UNIT)!
  const nuh = partialCell(noUnit.laborHours, 'hours')
  check('rollup: No unit recorded hours partial over the imported WO', nuh.partial && nuh.note === '1 job not recorded', JSON.stringify(noUnit.laborHours))

  check('source note, both', sourceNote(byId('u2')) === '1 from invoice, 1 from closed work order', sourceNote(byId('u2')))
  check('source note, invoices only', sourceNote(byId('u1')) === '3 from invoices', sourceNote(byId('u1')))
  check('source note, none', sourceNote({ jobsFromInvoices: 0, jobsFromWorkOrders: 0 }) === 'no jobs')
  check('source badge', sourceBadge(byId('u2')) === '1 inv / 1 WO' && sourceBadge(byId('u1')) === '3 inv')
  check('day, not shifted by zone', fmtDay('2026-01-01') === 'Jan 1, 2026' && fmtDay('2026-12-31') === 'Dec 31, 2026', fmtDay('2026-01-01'))
  check('bad day is a dash', fmtDay(null) === '-' && fmtDay('2026-02-30') === '-')
  check('unit label fallbacks', unitLabel({ unitNumber: '  ', manufacturer: null, model: null, serial: 'X1' }) === 'S/N X1'
    && unitLabel({ unitNumber: null, manufacturer: null, model: null, serial: null }) === 'Unit (no number)')
  check('audit link carries the range', auditHref({ from: '2026-01-01', to: '2026-10-19' }) === '/hd/reports/audit?from=2026-01-01&to=2026-10-19')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
