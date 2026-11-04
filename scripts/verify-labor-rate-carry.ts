// npx tsx scripts/verify-labor-rate-carry.ts
//
// The labor rate a new line pre-fills, and what carries between HD documents. READS the
// database, writes nothing.
//
//   1. The rate rule (lib/hd/labor-rate): the shop's hd_labor_rate only - never LD's
//      default_labor_rate, never 125 - and a document's recorded rate wins.
//   2. Every work order made from a quote: what its invoice now gains from the quote
//      (notes, email, service address, the quote link) and proof the money is untouched.
//   3. The quote -> work order notes: a quote with only printed notes gives the work
//      order the same text it always did.

import { loadEnv } from './lib/smoke-session'
import { hdLaborRateFrom, newLaborLineRate } from '../src/lib/hd/labor-rate'
import { invoiceCarryFromQuote, serviceLocationFromQuote, workOrderNotesFromQuote } from '../src/lib/hd/document-carry'
import { buildInvoicePayload, type WorkOrderLineRow } from '../src/lib/hd/wo-to-invoice'
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
const MONEY = ['total', 'subtotal_labor', 'subtotal_parts', 'tax_amount', 'tax_rate', 'tax_breakdown', 'labor_rate', 'line_items', 'discount',
  'diagnostic_fee', 'road_call_fee', 'service_call_fee', 'travel_amount', 'mileage_amount', 'shop_supplies_fee']

async function main() {
  // ── 1. the rate rule, on the real profile ──
  console.log('\n1. THE RATE A NEW LABOR LINE PRE-FILLS')
  const [owner] = await get(`hd_work_orders?select=user_id&limit=1`)
  const [p] = await get(`profiles?id=eq.${owner.user_id}&select=hd_labor_rate,default_labor_rate,${TAX_SETTINGS_SELECT}`)
  const shop = hdLaborRateFrom(p)
  console.log(`   profiles.hd_labor_rate = ${p.hd_labor_rate}, default_labor_rate (LD) = ${p.default_labor_rate}`)
  check('the shop rate is hd_labor_rate', shop === Number(p.hd_labor_rate), `${shop}`)
  check('LD\'s default_labor_rate never stands in for an unset HD rate', hdLaborRateFrom({ hd_labor_rate: null, default_labor_rate: 135 }) === null)
  check('no HD rate -> NULL, not 125', hdLaborRateFrom({}) === null && hdLaborRateFrom({ hd_labor_rate: '' }) === null && hdLaborRateFrom({ hd_labor_rate: 0 }) === null)
  check('a work order with no recorded rate pre-fills the shop rate', newLaborLineRate(null, shop) === shop)
  check('a work order from a quote at 135 pre-fills 135, the rate the customer agreed to', newLaborLineRate(135, shop) === 135)
  check('no rate anywhere -> NULL (the screen says so)', newLaborLineRate(null, null) === null)

  // ── 2. work order -> invoice, for every work order made from a quote ──
  console.log('\n2. WORK ORDERS FROM A QUOTE -> INVOICE: what now carries')
  const wos = await get('hd_work_orders?quote_id=not.is.null&select=*&order=work_order_number')
  const fb = { laborRate: shop, taxSettings: taxSettingsFrom(p) }
  let moneySame = 0
  for (const wo of wos) {
    const [quote] = await get(`hd_quotes?id=eq.${wo.quote_id}&select=*`)
    const [fleet] = wo.fleet_account_id ? await get(`hd_fleet_accounts?id=eq.${wo.fleet_account_id}&select=contact_email`) : [null]
    const lines = await get(`hd_work_order_line_items?work_order_id=eq.${wo.id}&select=*&order=sort_order`) as WorkOrderLineRow[]
    const { payload } = buildInvoicePayload({ ...wo }, lines, fb)
    const before = JSON.stringify(MONEY.map(k => payload[k] ?? null))
    const carry = invoiceCarryFromQuote(payload, wo, quote ?? null, fleet ?? null)
    const after = { ...payload, ...carry }
    if (JSON.stringify(MONEY.map(k => after[k] ?? null)) === before) moneySame++
    const moved = (wo.location ?? '') !== '' && wo.location !== serviceLocationFromQuote(quote ?? {})
    console.log(`   ${wo.work_order_number} (${quote?.quote_number}, ${lines.length} lines): quote_id ${payload.quote_id ? 'linked' : 'MISSING'}; ` +
      `email ${carry.customer_email ? `"${carry.customer_email}"` : '(none on fleet or quote)'}; ` +
      `notes ${carry.notes ? `"${String(carry.notes).slice(0, 40)}"` : '(quote has none)'}; ` +
      `service address ${carry.has_corp_address ? `"${carry.corp_address_line1}"` : quote?.has_corp_address ? (moved ? '(job moved - not carried)' : '(none)') : '(quote has none apart from billing)'}`)
    check(`${wo.work_order_number}: the invoice links back to its quote`, payload.quote_id === wo.quote_id)
    if (quote?.notes) check(`${wo.work_order_number}: the quote's printed notes reach the invoice`, after.notes === String(quote.notes).trim())
  }
  check(`no money key changes on any of the ${wos.length} work orders`, moneySame === wos.length, `${moneySame}/${wos.length}`)

  // No live quote has a service address apart from billing, so this is built from a real
  // quote-made work order and its real quote with one added - the shape the quote form
  // saves when "service address is different" is ticked.
  if (wos.length) {
    const wo = wos[wos.length - 1]
    const [real] = await get(`hd_quotes?id=eq.${wo.quote_id}&select=*`)
    const quote = { ...real, has_corp_address: true, corp_address_line1: '400 Yard Rd', corp_address_line2: null, corp_city: 'Fontana', corp_state: 'CA', corp_zip: '92335' }
    const opened = { ...wo, location: serviceLocationFromQuote(quote) }
    const c1 = invoiceCarryFromQuote({}, opened, quote, null)
    check('a service address on the quote reaches the invoice while the job is where the quote put it',
      c1.has_corp_address === true && c1.corp_address_line1 === '400 Yard Rd' && c1.corp_city === 'Fontana', `location "${opened.location}"`)
    const c2 = invoiceCarryFromQuote({}, { ...wo, location: '12 Other St, Ontario, CA' }, quote, null)
    check('a job the tech moved to another site is not billed at the quote service address', !('has_corp_address' in c2))
  }

  // ── 3. quote -> work order notes ──
  console.log('\n3. QUOTE -> WORK ORDER NOTES')
  const quotes = await get('hd_quotes?select=notes,internal_notes,customer_response_note,quote_number&order=quote_number')
  let same = 0, gained = 0
  for (const q of quotes) {
    const now = workOrderNotesFromQuote(q)
    const was = q.notes ?? null
    const onlyPrinted = !String(q.internal_notes ?? '').trim() && !String(q.customer_response_note ?? '').trim()
    if (onlyPrinted) { if ((now ?? null) === (was === null || String(was).trim() === '' ? null : String(was).trim())) same++; else console.log(`   DIFFERS ${q.quote_number}: ${JSON.stringify(was)} -> ${JSON.stringify(now)}`) }
    else { gained++; console.log(`   ${q.quote_number}: now carries ${[q.internal_notes && 'its internal notes', q.customer_response_note && "the customer's approval note"].filter(Boolean).join(' and ')}`) }
  }
  check('a quote with only printed notes gives the work order the same text as before', same === quotes.length - gained, `${same}/${quotes.length - gained}`)
  console.log(`   ${gained} of ${quotes.length} quotes have internal or approval notes that now carry`)

  console.log(`\n${passes} passed, ${failures} failed`)
  if (failures) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
