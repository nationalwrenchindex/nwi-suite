// npx tsx scripts/verify-fleet-unit-history.ts
//
// The fleet-view layer (src/lib/fleet-view/unit-history), both tiers, fed raw rows shaped
// like the live tables (the invoice line shape is the one lib/hd/wo-to-invoice writes:
// unit_cost = the customer's price, unit_cost_base = the shop's cost):
//   * CUSTOMER tier (fleet manager): the invoice as printed - lines, fees, discount, tax,
//     total - present; the shop's cost, markup and internal notes absent by name AND value.
//   * OUTSIDE-TECH tier (QR page): no money at all, by name and by value.
// The deployed routes are proved by the smoke flow Fm.

import {
  buildVisits, safeUnit, printedInvoice, rateThatMultiplies, customerVisit, outsideTechVisit, outsideTechUnit,
  marginKeysIn, moneyKeysIn, assertCustomerSafe, assertOutsideTechSafe, MARGIN_FIELD_NAMES, EXCLUDED_FROM_AGGREGATES,
} from '../src/lib/fleet-view/unit-history'
import { hdInvoiceSummaryRows } from '../src/lib/hd/invoice-print'

let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}

// THE SHOP'S MARGIN - never in either tier: cost 61.37, parts cost 122.74, markup 37.5.
const MARGIN = { parts_cost: 122.74, parts_markup_percent: 37.5, internal_notes: 'SECRET-INTERNAL', estimated_value: 9191.19 }
const MARGIN_RE = /61\.37|122\.74|\b37\.5\b|9191\.19|SECRET-INTERNAL/
// Contact and identity - never in either tier.
const CONTACT = { customer_name: 'SECRET-CUSTOMER', customer_phone: '+15550009999', customer_email: 'secret@customer.example', address_line1: 'SECRET-ADDRESS', user_id: 'shop-id', customer_id: 'cust-id' }
// What the customer was charged - printed on his invoice. Customer tier only.
const PRINTED = { labor_rate: 137.11, subtotal_labor: 274.22, subtotal_parts: 168.76, diagnostic_fee: 41.09, travel_hours: 1.25, travel_rate: 96.2, travel_amount: 120.25,
  mileage_miles: 31, mileage_rate: 2, mileage_amount: 62, shop_supplies_fee: 8.44, shop_supplies_percent_applied: 5,
  discount: { version: 1, type: 'flat', value: 25, scope: 'document', amount: 25, labor_amount: 0, parts_amount: 0, subtotal_before: 674.76, tax_before: 0 },
  tax_breakdown: { version: 1, parts: { base: 177.2, rate: 7.5, amount: 13.29, taxed: true }, labor: { base: 394.47, rate: 0, amount: 0, taxed: false } },
  tax_amount: 13.29, tax_rate: 7.5, total: 663.05 }
const PRINTED_RE = /137\.11|274\.22|168\.76|41\.09|120\.25|663\.05|13\.29|84\.38/

const unit = { id: '11111111-1111-1111-1111-111111111111', unit_number: 'T-101', manufacturer: 'Thermo King', model: 'S-600', serial_number: 'SN1',
  year: 2019, total_hours: 9800, engine_hours: null, current_odometer: null, next_pm_due_hours: 9900, last_pm_date: '2026-01-01', last_pm_type: 'a_service',
  ...MARGIN, ...CONTACT }
const U = unit.id
const workOrders = [
  { id: 'wo-new', unit_id: U, fleet_account_id: 'F', work_order_number: 'WO-2026-0901', status: 'invoiced', completed_at: '2026-10-02T15:00:00Z', created_at: '2026-10-01', unit_hours: 9800, vehicle_odometer: 123000,
    service_requests: 'Unit not cooling', comments: 'Replaced belt', ...MARGIN, ...CONTACT, labor_rate: 731.47, total_amount: 4321.09 },
  { id: 'wo-old', unit_id: U, fleet_account_id: null, work_order_number: 'WO-2025-0100', status: 'completed', completed_at: '2025-06-01T15:00:00Z', created_at: '2025-06-01', unit_hours: 7000, vehicle_odometer: null,
    service_requests: 'PM', comments: 'Did PM', ...MARGIN, ...CONTACT, labor_rate: 731.47, total_amount: 4321.09 },
  { id: 'wo-open', unit_id: U, fleet_account_id: 'F', status: 'open', completed_at: null, created_at: '2026-11-01', unit_hours: 9900, service_requests: 'Not done yet', comments: null, ...MARGIN, ...CONTACT, labor_rate: 731.47, total_amount: 4321.09 },
]
const woLines = [
  { id: 'l1', work_order_id: 'wo-old', type: 'part', part_number: '11-9959', description: 'Oil filter', quantity: 2, unit_cost: 731.47, unit_price: 731.47, markup_percent: 41.09, total: 731.47, sort_order: 1 },
  { id: 'l2', work_order_id: 'wo-old', type: 'labor', part_number: null, description: 'PM labor', quantity: 3, unit_cost: 731.47, unit_price: 731.47, total: 731.47, sort_order: 0 },
  { id: 'l3', work_order_id: 'wo-new', type: 'part', part_number: 'WO-LINE-ONLY', description: 'superseded by the invoice', quantity: 1, unit_cost: 731.47, sort_order: 0 },
]
const invoices = [
  { id: 'inv-new', unit_id: U, fleet_account_id: 'F', work_order_id: 'wo-new', invoice_number: 'INV-2026-0901', work_order_number: 'WO-2026-0901', status: 'unpaid',
    created_at: '2026-10-03', unit_hours: null, vehicle_odometer: null, complaint: 'x', diagnosis: 'Belt worn, replaced', ...MARGIN, ...CONTACT, ...PRINTED,
    line_items: [{ id: 'p1', type: 'parts', part_number: '78-1968', description: 'Belt', quantity: 2, unit_cost: 84.38, unit_cost_base: 61.37, markup_percent: 37.5, amount: 168.76, mobile_hours: 0 },
                 { id: 'l1', type: 'labor', description: 'Belt labor', quantity: 0, unit_cost: 0, amount: 274.22, mobile_hours: 2 }] },
  { id: 'inv-direct', unit_id: U, fleet_account_id: null, work_order_id: null, invoice_number: 'INV-2026-0800', status: 'void', created_at: '2026-03-15', unit_hours: 8800, vehicle_odometer: 110000, complaint: 'Alarm 18',
    diagnosis: 'Cleared, sensor', ...MARGIN, ...CONTACT, labor_rate: 731.47, total_amount: 4321.09, line_items: [{ type: 'parts', part_number: '40-0974', description: 'Graded sensor', quantity: 1, unit_cost: 50.5, unit_cost_base: 61.37, amount: 50.5 }] },
]
const pmSheets = [
  { id: 'pm-on-wo', unit_id: U, work_order_id: 'wo-old', invoice_id: null, pm_type: 'a_service', completed_at: '2025-06-01' },
  { id: 'pm-alone', unit_id: U, work_order_id: null, invoice_id: null, pm_type: 'b_service', completed_at: '2026-05-05' },
]
const dotSheets = [
  { id: 'dot-on-inv', unit_id: U, fleet_account_id: 'F', work_order_id: null, invoice_id: 'inv-new', inspection_date: '2026-10-03', overall_result: 'pass' },
]

const visits = buildVisits({ workOrders, woLines, invoices, pmSheets, dotSheets })
const su = safeUnit(unit, { hours: null, miles: 123000 })
const printedById = new Map(invoices.map(i => [i.id, printedInvoice(i)]))
const customer = { unit: su, visits: visits.map(v => customerVisit(v, v.invoice_id ? printedById.get(v.invoice_id) ?? null : null)) }
const outside = { unit: outsideTechUnit(su), visits: visits.map(outsideTechVisit) }
const cOut = JSON.stringify(customer), oOut = JSON.stringify(outside)
const cNew = customer.visits.find(v => v.key === 'wo:wo-new')!
const cOld = customer.visits.find(v => v.key === 'wo:wo-old')!

console.log('\n  customer tier (the fleet manager): his invoice, as printed')
check('the invoice total, tax, labor, part price and fees are present', !!cNew.invoice && cNew.invoice.total === 663.05 &&
  cNew.invoice.summary.some(r => r.label.startsWith('Tax on parts') && r.amount === 13.29) &&
  cNew.invoice.summary.some(r => r.label === 'Diagnostic Fee' && r.amount === 41.09) &&
  cNew.invoice.summary.some(r => r.label.startsWith('Travel Time') && r.amount === 120.25) &&
  cNew.invoice.summary.some(r => r.label.startsWith('Mileage') && r.amount === 62) &&
  cNew.invoice.summary.some(r => r.label.startsWith('Shop Supplies') && r.amount === 8.44) &&
  cNew.invoice.summary.some(r => r.amount === -25), JSON.stringify(cNew.invoice?.summary))
const lab = cNew.invoice?.groups[0].labor[0], prt = cNew.invoice?.groups[0].parts[0]
check('labor prints hours x the invoice rate and its amount', lab?.hours === 2 && lab?.rate === 137.11 && lab?.amount === 274.22, JSON.stringify(lab))
check("a part prints the price HE was charged (the line's unit_cost), never the shop's cost", prt?.unit_price === 84.38 && prt?.amount === 168.76 && prt?.quantity === 2, JSON.stringify(prt))
check('the summary rows are exactly the customer copy\'s rows', JSON.stringify(cNew.invoice?.summary) === JSON.stringify(hdInvoiceSummaryRows(invoices[0]).map(r => ({ label: r.label, amount: r.amount }))))
check('the work order and invoice numbers are on the visit', cNew.work_order_number === 'WO-2026-0901' && cNew.invoice_number === 'INV-2026-0901' && cOld.work_order_number === 'WO-2025-0100')
check('a voided invoice says so', customer.visits.find(v => v.key === 'inv:inv-direct')?.invoice?.voided === true)
check('a job never invoiced carries no money (no paper priced it)', cOld.invoice === null && !/731\.47|4321\.09/.test(cOut))
check("absent BY NAME: parts_cost, unit_cost_base, markup, internal_notes, contact, identities", marginKeysIn(customer).length === 0, marginKeysIn(customer).join(', '))
check("absent BY VALUE: the shop's cost (61.37 / 122.74), markup (37.5), unit value, internal note", !MARGIN_RE.test(cOut), cOut.match(MARGIN_RE)?.[0] ?? '')
check('no contact detail by value', !/SECRET|\+1555|secret@/.test(cOut))
check('the margin list names every field Brock listed', ['parts_cost', 'unit_cost_base', 'markup_percent', 'parts_markup_percent', 'internal_notes'].every(n => MARGIN_FIELD_NAMES.includes(n)))

console.log('\n  outside-tech tier (the QR page): no money at all')
check('no money or margin field name anywhere', moneyKeysIn(outside).length === 0, moneyKeysIn(outside).join(', '))
check('no printed money value anywhere', !PRINTED_RE.test(oOut) && !MARGIN_RE.test(oOut) && !/731\.47|4321\.09/.test(oOut), oOut.match(PRINTED_RE)?.[0] ?? '')
check('no document number, no complaint, no sheets: only what Brock listed', !/WO-20|INV-20|"requested"|"sheets"/.test(oOut))
check('a part is number and quantity only', outside.visits.every(v => v.parts.every(p => JSON.stringify(Object.keys(p)) === '["part_number","quantity"]')))
check('the unit is number, make, model, serial, year only', JSON.stringify(Object.keys(outside.unit)) === '["unit_number","manufacturer","model","serial_number","year"]')
check('hours at each visit and the repair comments carry', outside.visits.some(v => v.hours_at_visit === 9800 && v.comments === 'Replaced belt' && v.final_comments === 'Belt worn, replaced'))
check('handed a FULL customer visit, the stripped builder still drops every money field', moneyKeysIn(outsideTechVisit(cNew)).length === 0 && !PRINTED_RE.test(JSON.stringify(outsideTechVisit(cNew))))
let threwO = false
try { assertOutsideTechSafe({ visits: [{ total: 1 }] }) } catch { threwO = true }
check('assertOutsideTechSafe throws on any money field', threwO)

console.log('\n  history')
check('newest first, open work order left out', visits.map(v => v.key).join(' ') === 'wo:wo-new pm:pm-alone inv:inv-direct wo:wo-old', visits.map(v => v.key).join(' '))
const vNew = cNew
check('hours and miles are the ones recorded AT that visit', vNew.hours_at_visit === 9800 && vNew.miles_at_visit === 123000 && cOld.hours_at_visit === 7000, `${vNew.hours_at_visit} / ${vNew.miles_at_visit}`)
check("an invoiced job lists the invoice's parts, not the superseded work order line", vNew.parts.length === 1 && vNew.parts[0].part_number === '78-1968')
check('labor lines are not parts used', cOld.parts.map(p => p.part_number).join() === '11-9959')
check("work order comments and the invoice's work done both carry", vNew.comments === 'Replaced belt' && vNew.final_comments === 'Belt worn, replaced' && vNew.requested === 'Unit not cooling')
check('a DOT sheet attached to the invoice shows on that job', vNew.sheets.length === 1 && vNew.sheets[0].kind === 'dot' && vNew.sheets[0].result === 'pass')
check('a PM sheet attached to the work order shows on that job', cOld.sheets.map(s => s.id).join() === 'pm-on-wo')
check('a PM sheet with no job is its own visit', visits.some(v => v.key === 'pm:pm-alone' && v.sheets[0]?.kind === 'pm'))
check('an invoice billed with no work order is its own visit', visits.some(v => v.key === 'inv:inv-direct' && v.requested === 'Alarm 18' && v.parts[0]?.part_number === '40-0974'))
check('the unit keeps exactly its allowed fields', JSON.stringify(Object.keys(su).sort()) ===
  JSON.stringify(['id', 'latest_hours', 'latest_miles', 'manufacturer', 'model', 'serial_number', 'unit_number', 'year'].sort()), Object.keys(su).join(','))

console.log('\n  no PM due, nothing predictive (Fleet Pro, not this tier)')
check('neither tier carries PM due, a PM alert or a next-due figure', !/pm_due|next_pm|due_soon|overdue|last_pm|hoursUntil|nextDueDate/i.test(cOut + oOut))

console.log('\n  every printed rate is the RECORDED one, and only when it multiplies out')
// INV-2026-0023's shape: labor_rate recorded 135 (the settings fallback), the line priced at 145.
const inv0023 = printedInvoice({ id: 'x', invoice_number: 'INV-2026-0023', status: 'unpaid', created_at: '2026-11-01', labor_rate: 135, subtotal_labor: 870, total: 870,
  line_items: [{ type: 'labor', description: 'Diag + repair', quantity: 0, unit_cost: 0, amount: 870, mobile_hours: 6 }] })
const l23 = inv0023.groups[0].labor[0]
check('INV-2026-0023 shape: a recorded rate that does not multiply to its line prints NO rate (hours and amount only)', l23.rate === null && l23.hours === 6 && l23.amount === 870, JSON.stringify(l23))
check('INV-2026-0023 shape: neither $135 nor a back-worked $145 appears anywhere', !/\b135\b|\b145\b/.test(JSON.stringify(inv0023)))
check('the recorded rate prints when it multiplies (2h x 137.11 = 274.22)', lab?.rate === 137.11 && Math.round((lab.hours ?? 0) * lab.rate * 100) === Math.round(lab.amount * 100))
const noRate = printedInvoice({ id: 'y', status: 'unpaid', labor_rate: null, total: 100, line_items: [{ type: 'labor', description: 'L', amount: 100, mobile_hours: 1 }] })
check('an invoice that recorded no labor rate prints no rate - never a setting', noRate.groups[0].labor[0].rate === null)
const badExtras = printedInvoice({ id: 'z', status: 'unpaid', total: 200, travel_hours: 2, travel_rate: 90, travel_amount: 200, mileage_miles: 10, mileage_rate: 2, mileage_amount: 25,
  tax_amount: 5, tax_rate: null, line_items: [{ type: 'parts', part_number: 'P', quantity: 3, unit_cost: 10, amount: 33 }] })
const tRow = badExtras.summary.find(r => r.label.startsWith('Travel')), mRow = badExtras.summary.find(r => r.label.startsWith('Mileage'))
check('travel / mileage rates that do not multiply print no "x rate", amount kept', !!tRow && !/×|90/.test(tRow.label) && tRow.amount === 200 && !!mRow && !/×/.test(mRow.label) && mRow.amount === 25, JSON.stringify(badExtras.summary))
check('travel / mileage rates that DO multiply print', cNew.invoice!.summary.some(r => /Travel Time.*96\.20\/hr/.test(r.label)) && cNew.invoice!.summary.some(r => /Mileage.*2\.0000\/mi/.test(r.label)), JSON.stringify(cNew.invoice?.summary))
check('a part price that does not multiply to its line prints no unit price', badExtras.groups[0].parts[0].unit_price === null && badExtras.groups[0].parts[0].amount === 33)
check('a null tax rate prints "Tax", never "Tax (null%)"', badExtras.summary.some(r => r.label === 'Tax' && r.amount === 5), JSON.stringify(badExtras.summary))
check('rateThatMultiplies is exact to the cent', rateThatMultiplies(6, 145, 870) === 145 && rateThatMultiplies(6, 135, 870) === null && rateThatMultiplies(0, 1, 0) === null && rateThatMultiplies(1.25, 96.2, 120.25) === 96.2)

console.log('\n  the walls')
let threw = false
try { assertCustomerSafe({ unit: { id: 'x', parts_cost: 1 } }) } catch { threw = true }
check('assertCustomerSafe throws on a leaked margin field', threw)
check('the patterns catch a future column (e.g. "core_cost", "markup_amount", "internal_memo")', marginKeysIn({ core_cost: 1, markup_amount: 1, internal_memo: 1 }).length === 3)
check('the demo account is excluded from aggregates', EXCLUDED_FROM_AGGREGATES.includes('4a8c046f-7db3-42bb-8422-fd47efb7678c'))

console.log(`\n  ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
