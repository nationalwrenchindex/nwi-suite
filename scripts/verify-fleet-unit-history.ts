// npx tsx scripts/verify-fleet-unit-history.ts
//
// The safe unit-history layer's projection (src/lib/fleet-view/unit-history), fed raw
// rows shaped like the live tables - every money and contact column filled with a
// value that would be recognisable if it leaked - and checked that none of it comes
// out. The deployed routes are proved by the smoke flow Fm; this proves the pure part
// on every shape, including ones a fixture on the database cannot easily build.

import {
  buildVisits, safeUnit, forbiddenKeysIn, assertFleetSafe, FORBIDDEN_FIELD_NAMES, EXCLUDED_FROM_AGGREGATES,
} from '../src/lib/fleet-view/unit-history'
import { pmDueOf, isPmAlert } from '../src/lib/hd/pm-due'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

// Recognisable money: if 731.47, 88.13 or 41.09 appear anywhere in the output, it leaked.
const MONEY = { labor_rate: 731.47, total: 731.47, total_amount: 731.47, subtotal_labor: 731.47, subtotal_parts: 731.47, tax_amount: 88.13,
  tax_breakdown: { parts: { amount: 88.13 } }, discount: { amount: 41.09 }, diagnostic_fee: 41.09, road_call_fee: 41.09, service_call_fee: 41.09,
  shop_supplies_fee: 41.09, travel_rate: 731.47, travel_amount: 731.47, mileage_rate: 41.09, mileage_amount: 41.09, parts_cost: 731.47,
  parts_sell: 731.47, parts_markup_percent: 41.09, internal_notes: 'SECRET-INTERNAL', customer_name: 'SECRET-CUSTOMER',
  customer_phone: '+15550009999', customer_email: 'secret@customer.example', address_line1: 'SECRET-ADDRESS', user_id: 'shop-id', customer_id: 'cust-id' }

const unit = { id: '11111111-1111-1111-1111-111111111111', unit_number: 'T-101', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'SN1',
  year: 2019, total_hours: 9800, engine_hours: null, current_odometer: null, next_pm_due_hours: 9900, last_pm_date: '2026-01-01', last_pm_type: 'a_service',
  estimated_value: 731.47, ...MONEY }
const U = unit.id
const workOrders = [
  { id: 'wo-new', unit_id: U, fleet_account_id: 'F', status: 'invoiced', completed_at: '2026-10-02T15:00:00Z', created_at: '2026-10-01', unit_hours: 9800, vehicle_odometer: 123000,
    service_requests: 'Unit not cooling', comments: 'Replaced belt', ...MONEY },
  { id: 'wo-old', unit_id: U, fleet_account_id: null, status: 'completed', completed_at: '2025-06-01T15:00:00Z', created_at: '2025-06-01', unit_hours: 7000, vehicle_odometer: null,
    service_requests: 'PM', comments: 'Did PM', ...MONEY },
  { id: 'wo-open', unit_id: U, fleet_account_id: 'F', status: 'open', completed_at: null, created_at: '2026-11-01', unit_hours: 9900, service_requests: 'Not done yet', comments: null, ...MONEY },
]
const woLines = [
  { id: 'l1', work_order_id: 'wo-old', type: 'part', part_number: '11-9959', description: 'Oil filter', quantity: 2, unit_cost: 731.47, unit_price: 731.47, markup_percent: 41.09, total: 731.47, sort_order: 1 },
  { id: 'l2', work_order_id: 'wo-old', type: 'labor', part_number: null, description: 'PM labor', quantity: 3, unit_cost: 731.47, unit_price: 731.47, total: 731.47, sort_order: 0 },
  { id: 'l3', work_order_id: 'wo-new', type: 'part', part_number: 'WO-LINE-ONLY', description: 'superseded by the invoice', quantity: 1, unit_cost: 731.47, sort_order: 0 },
]
const invoices = [
  { id: 'inv-new', unit_id: U, fleet_account_id: 'F', work_order_id: 'wo-new', created_at: '2026-10-03', unit_hours: null, vehicle_odometer: null, complaint: 'x',
    diagnosis: 'Belt worn, replaced', ...MONEY,
    line_items: [{ type: 'parts', part_number: '78-1968', description: 'Belt', quantity: 1, unit_cost: 731.47, unit_cost_base: 731.47, markup_percent: 41.09, amount: 731.47, amount_max: 731.47 },
                 { type: 'labor', description: 'Belt labor', amount: 731.47, mobile_hours: 1 }] },
  { id: 'inv-direct', unit_id: U, fleet_account_id: null, work_order_id: null, created_at: '2026-03-15', unit_hours: 8800, vehicle_odometer: 110000, complaint: 'Alarm 18',
    diagnosis: 'Cleared, sensor', ...MONEY, line_items: [{ type: 'parts', part_number: '40-0974', description: 'Graded sensor', quantity: 1, unit_cost: 731.47, amount: 731.47 }] },
]
const pmSheets = [
  { id: 'pm-on-wo', unit_id: U, work_order_id: 'wo-old', invoice_id: null, pm_type: 'a_service', completed_at: '2025-06-01' },
  { id: 'pm-alone', unit_id: U, work_order_id: null, invoice_id: null, pm_type: 'b_service', completed_at: '2026-05-05' },
]
const dotSheets = [
  { id: 'dot-on-inv', unit_id: U, fleet_account_id: 'F', work_order_id: null, invoice_id: 'inv-new', inspection_date: '2026-10-03', overall_result: 'pass' },
]

const visits = buildVisits({ workOrders, woLines, invoices, pmSheets, dotSheets })
const su = safeUnit(unit, { hours: null, miles: 123000 }, Date.parse('2026-11-23T12:00:00Z'))
const out = JSON.stringify({ su, visits })

console.log('\n  projection')
check('no forbidden field name anywhere in the output', forbiddenKeysIn({ su, visits }).length === 0, forbiddenKeysIn({ su, visits }).join(', '))
check('no money value anywhere in the output (731.47, 88.13, 41.09)', !/731\.47|88\.13|41\.09/.test(out))
check('no contact or internal text anywhere in the output', !/SECRET|\+1555|secret@/.test(out))
check('the unit keeps exactly its allowed fields', JSON.stringify(Object.keys(su).sort()) ===
  JSON.stringify(['id', 'last_pm_date', 'last_pm_type', 'latest_hours', 'latest_miles', 'manufacturer', 'model', 'pm_due', 'serial_number', 'unit_number', 'year'].sort()),
  Object.keys(su).join(','))
check('a part keeps exactly part_number, description, quantity', visits.every(v => v.parts.every(p => JSON.stringify(Object.keys(p)) === '["part_number","description","quantity"]')))

console.log('\n  history')
check('newest first, open work order left out', visits.map(v => v.key).join(' ') === 'wo:wo-new pm:pm-alone inv:inv-direct wo:wo-old', visits.map(v => v.key).join(' '))
const vNew = visits.find(v => v.key === 'wo:wo-new')!
check('hours and miles are the ones recorded AT that visit', vNew.hours_at_visit === 9800 && vNew.miles_at_visit === 123000 &&
  visits.find(v => v.key === 'wo:wo-old')!.hours_at_visit === 7000, `${vNew.hours_at_visit} / ${vNew.miles_at_visit}`)
check('an invoiced job lists the invoice\'s parts, not the superseded work order line', vNew.parts.length === 1 && vNew.parts[0].part_number === '78-1968')
check('labor lines are not parts used', visits.find(v => v.key === 'wo:wo-old')!.parts.map(p => p.part_number).join() === '11-9959')
check('work order comments and the invoice\'s work done both carry', vNew.comments === 'Replaced belt' && vNew.final_comments === 'Belt worn, replaced' && vNew.requested === 'Unit not cooling')
check('a DOT sheet attached to the invoice shows on that job', vNew.sheets.length === 1 && vNew.sheets[0].kind === 'dot' && vNew.sheets[0].result === 'pass')
check('a PM sheet attached to the work order shows on that job', visits.find(v => v.key === 'wo:wo-old')!.sheets.map(s => s.id).join() === 'pm-on-wo')
check('a PM sheet with no job is its own visit', visits.some(v => v.key === 'pm:pm-alone' && v.sheets[0]?.kind === 'pm'))
check('an invoice billed with no work order is its own visit', visits.some(v => v.key === 'inv:inv-direct' && v.requested === 'Alarm 18' && v.parts[0]?.part_number === '40-0974'))

console.log('\n  PM due is the Intel Hub rule')
check('100 hours to go is due soon', pmDueOf({ next_pm_due_hours: 9900, total_hours: 9800, last_pm_date: null }).status === 'due_soon')
check('past the hours is overdue', pmDueOf({ next_pm_due_hours: 9900, total_hours: 9950, last_pm_date: null }).status === 'overdue')
check('201 hours to go and no date is not due', pmDueOf({ next_pm_due_hours: 10001, total_hours: 9800, last_pm_date: null }).status === null)
check('a last PM over 180 days ago is overdue', pmDueOf({ next_pm_due_hours: null, total_hours: null, last_pm_date: '2026-01-01' }, Date.parse('2026-11-23')).status === 'overdue')
check('the unit view carries the same verdict', su.pm_due.status === 'overdue' && su.pm_due.hoursUntil === 100, JSON.stringify(su.pm_due))
check('isPmAlert counts exactly the badged units', isPmAlert({ next_pm_due_hours: 10000, total_hours: 9800, last_pm_date: null }) && !isPmAlert({ next_pm_due_hours: 10001, total_hours: 9800, last_pm_date: null }))

console.log('\n  the walls')
let threw = false
try { assertFleetSafe({ unit: { id: 'x', labor_rate: 1 } }) } catch { threw = true }
check('assertFleetSafe throws on a leaked field', threw)
check('the patterns catch a future column (e.g. "disposal_fee", "list_price", "core_cost")',
  forbiddenKeysIn({ disposal_fee: 1, list_price: 1, core_cost: 1 }).length === 3)
check('every required forbidden name is on the list', ['labor_rate', 'subtotal_labor', 'subtotal_parts', 'tax_amount', 'discount', 'diagnostic_fee', 'total', 'unit_cost', 'markup_percent', 'unit_price', 'customer_phone', 'customer_email'].every(n => FORBIDDEN_FIELD_NAMES.includes(n)))
check('the demo account is excluded from aggregates', EXCLUDED_FROM_AGGREGATES.includes('4a8c046f-7db3-42bb-8422-fd47efb7678c'))

console.log(`\n  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
