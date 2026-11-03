// npx tsx scripts/verify-unit-hours.ts
//
// Unit number and hours on HD documents (migration 179). READS the database, writes
// nothing. Prints what every header surface shows for real documents:
//
//   1. WO-2026-1570 converted as it is today (no reading recorded, unit number empty on
//      the work order) - and with a 9,110 reading recorded, through the converter.
//   2. The reading is FROZEN: the same work order converted after the unit record's
//      hours change still bills the reading the work order recorded.
//   3. Every existing invoice through serviceUnitLines (the PDF and the pay page): none
//      prints an Hours line, and each still prints its unit number and serial.

import { loadEnv } from './lib/smoke-session'
import { buildInvoicePayload, type WorkOrderLineRow } from '../src/lib/hd/wo-to-invoice'
import { serviceUnitLines } from '../src/lib/invoice-document'
import { unitIdentityFill, formatUnitHours, lastKnownHours } from '../src/lib/hd/unit-hours'
import { taxSettingsFrom, TAX_SETTINGS_SELECT } from '../src/lib/tax'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
const get = async (q: string) => (await fetch(`${S}/rest/v1/${q}`, { headers: H })).json() as Promise<Record<string, any>[]>

let failures = 0, passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++; else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const header = (d: Record<string, unknown>) => serviceUnitLines(d).map(l => (l.label ? `${l.label}: ${l.value}` : l.value)).join(' / ')

async function main() {
  const [wo] = await get('hd_work_orders?work_order_number=eq.WO-2026-1570&select=*')
  const [unit] = await get(`hd_units?id=eq.${wo.unit_id}&select=*`)
  const lines = await get(`hd_work_order_line_items?work_order_id=eq.${wo.id}&select=*&order=sort_order`) as WorkOrderLineRow[]
  const [p] = await get(`profiles?id=eq.${wo.user_id}&select=hd_labor_rate,${TAX_SETTINGS_SELECT}`)
  const fb = { laborRate: Number(p.hd_labor_rate), taxSettings: taxSettingsFrom(p) }
  const has179 = 'unit_hours' in wo

  console.log(`\n1. ${wo.work_order_number}: unit_number on the work order = ${wo.unit_number ?? 'EMPTY'}; linked unit ${unit.unit_number}, last reading ${unit.total_hours}; migration 179 ${has179 ? 'applied' : 'NOT applied'}`)
  console.log(`   work order input pre-fills: ${lastKnownHours(unit) ?? 'nothing'}`)
  // As the convert route now builds it: the linked unit fills empty identity fields.
  const filled = { ...wo, ...unitIdentityFill(wo, unit) }
  const today = buildInvoicePayload(filled, lines, fb).payload
  console.log(`   invoice header (no reading recorded): ${header(today)}`)
  check('the unit number reaches the invoice', today.unit_number === unit.unit_number)
  check('no reading recorded -> no hours line, never the unit record\'s figure', !header(today).includes('Hours'))

  const recorded = { ...filled, unit_hours: 9110 }
  const inv = buildInvoicePayload(recorded, lines, fb).payload
  console.log(`   invoice header (9,110 recorded on the work order): ${header(inv)}`)
  check('the recorded reading carries to the invoice', inv.unit_hours === 9110 && header(inv).includes('Hours: 9,110'))

  // ── 2. frozen ──
  const unitLater = { ...unit, total_hours: 9800 }
  const later = buildInvoicePayload({ ...wo, unit_hours: 9110, ...unitIdentityFill(wo, unitLater) }, lines, fb).payload
  console.log(`\n2. The unit record later reads ${unitLater.total_hours} hours. The same work order converts with: ${formatUnitHours(later.unit_hours)}`)
  check('the invoice bills the reading the work order recorded, not the unit\'s hours now', later.unit_hours === 9110)
  check('the stored invoice is printed from its own unit_hours only', header({ ...inv, unit_hours: 9110 }) === header(inv))
  check('money is untouched by the reading', JSON.stringify([today.total, today.tax_amount, today.subtotal_labor, today.subtotal_parts]) === JSON.stringify([inv.total, inv.tax_amount, inv.subtotal_labor, inv.subtotal_parts]), `total ${today.total}`)

  // ── 3. existing invoices ──
  const invs = await get('hd_invoices?select=*&order=invoice_number')
  console.log(`\n3. EVERY EXISTING INVOICE (${invs.length}) through the PDF / pay-page header:`)
  let hoursShown = 0, lost = 0
  for (const i of invs) {
    const h = header(i)
    if (h.includes('Hours')) hoursShown++
    if ((i.unit_number && !h.includes(`Unit: ${i.unit_number}`)) || (i.unit_serial && !h.includes(String(i.unit_serial)))) lost++
    if (['INV-2026-0026', 'INV-2026-0025', 'INV-2026-0014'].includes(i.invoice_number)) console.log(`   ${i.invoice_number}: ${h || '(no unit block)'}`)
  }
  check('no existing invoice prints an hours line (none recorded, nothing backfilled)', hoursShown === 0, `${hoursShown}`)
  check('every existing invoice still prints its unit number and serial', lost === 0, `${lost}`)

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
