// npx tsx scripts/verify-document-lines.ts
//
// LD multi-line quotes and work orders, and spec section 7 items 1-2
// (docs/NWI-ESTIMATE-DOCUMENT-SPEC.md): labour lines, reorder, the line `detail`,
// included lines and customer-supplied parts.
//
// THE RULE UNDER TEST: an existing document keeps the rates, markup and tax it
// recorded, and opening and saving one without a change moves nothing. The last section
// proves that against EVERY real LD quote and work order in the database (read-only):
// a fixture built from an assumed shape is how a doubled markup survived every run once.

import { loadEnv } from './lib/smoke-session'
import {
  fromLineItems, toLineItems, computeTotals, markupOnReopen, type EditItem,
} from '../src/components/shared/line-items'
import { documentMoney, documentExtras } from '../src/lib/document-money'
import { documentTaxSettings, taxSettingsFrom, TAX_SETTINGS_SELECT, type TaxSettings } from '../src/lib/tax'
import { EXTRAS_OFF } from '../src/lib/billable-extras'
import type { LineItem } from '../src/types/financials'

let failures = 0
let passes = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passes++
  else failures++
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// The trial subscriber's real quote shape: one "Labor" row, 1.5 h at $110.
const TRIAL: LineItem[] = [{ type: 'labor', total: 165, quantity: 1.5, unit_price: 110, description: 'Labor' }]
// QT-2026-0003's real shape: untyped QuickWrench rows, $0 parts with unit_cost, two labour rows.
const QW: LineItem[] = [
  { total: 0, quantity: 1, unit_cost: 0, unit_price: 0, description: 'Front Ceramic Brake Pad Set' } as LineItem,
  { total: 162, quantity: 1.2, unit_price: 135, description: 'Labor — Front Brake Pad Replacement' },
  { total: 0, quantity: 8, unit_cost: 0, unit_price: 0, description: '0W-20 Full Synthetic Oil (1 Qt)' } as LineItem,
  { total: 67.5, quantity: 0.5, unit_price: 135, description: 'Labor — Oil & Filter Change' },
]

console.log('\nLabour lines: several, kept in order, never collapsed')
const qw = fromLineItems(QW, 30, undefined, { withLabor: true })
check('both labour rows load as labour lines, in their stored places',
  same(qw.map(i => i.kind ?? 'part'), ['part', 'labor', 'part', 'labor']))
check('the old path still drops labour (callers that hold one hours x rate pair)',
  fromLineItems(QW, 30).every(i => i.kind !== 'labor') && fromLineItems(QW, 30).length === 2)
const qwTotals = computeTotals({ items: qw, markupPct: 30, laborHours: 0, laborRate: 135, taxPct: 7.75 })
check('labour subtotal is the sum of the labour lines (229.50), parts 0',
  qwTotals.laborSubtotal === 229.5 && qwTotals.partsTotal === 0, `labor ${qwTotals.laborSubtotal}`)
check('a no-op save writes every row back verbatim - unit_cost and untyped rows survive',
  same(toLineItems({ items: qw, markupPct: 30, laborHours: 0, laborRate: 135 }), QW))

console.log('\nAdd, edit, reorder, remove')
const trial = fromLineItems(TRIAL, 30, undefined, { withLabor: true })
const added: EditItem[] = [...trial, {
  _id: 'n1', kind: 'labor', description: 'Labor: Clock Spring Replacement', quantity: 1.5, unit_price: 110, part_number: '',
  detail: 'Disarm the SRS system, remove the steering wheel,\ntransfer the sensor and reassemble the column.',
}, { _id: 'n2', description: 'Clock spring', quantity: 1, unit_price: 80, part_number: 'CS-1' }]
const written = toLineItems({ items: added, markupPct: 30, laborHours: 0, laborRate: 110 })
check('a second labour line is stored typed, hours x rate', same(written[1], {
  description: 'Labor: Clock Spring Replacement', quantity: 1.5, unit_price: 110, total: 165, type: 'labor',
  detail: 'Disarm the SRS system, remove the steering wheel,\ntransfer the sensor and reassemble the column.',
}), JSON.stringify(written[1]))
check('a part is stored post-markup (80 x 1.30 = 104)', written[2].unit_price === 104 && written[2].total === 104)
check('the untouched original row is written back unchanged', same(written[0], TRIAL[0]))
const reordered = [added[2], added[0], added[1]]
check('reorder: stored order is the order the tech arranged',
  same(toLineItems({ items: reordered, markupPct: 30, laborHours: 0, laborRate: 110 }).map(r => r.description),
    ['Clock spring', 'Labor', 'Labor: Clock Spring Replacement']))
const edited = added.map(i => i._id === trial[0]._id ? { ...i, quantity: 2 } : i)
const ew = toLineItems({ items: edited, markupPct: 30, laborHours: 0, laborRate: 110 })
check('edit: a changed labour line is re-written from its new hours (2 x 110)', ew[0].total === 220 && ew[0].type === 'labor')
check('remove: a removed line is gone', toLineItems({ items: added.slice(1), markupPct: 30, laborHours: 0, laborRate: 110 }).length === 2)
const mt = computeTotals({ items: added, markupPct: 30, laborHours: 0, laborRate: 110, taxPct: 7 })
check('subtotals recalc from the lines: labor 330, parts 104', round(mt.laborSubtotal) === 330 && round(mt.partsTotal) === 104)

console.log('\nDetail text (spec 2.5, item 1)')
check('detail is stored on the row, multi-line, trimmed', written[1].detail?.includes('\n') === true)
const blankDetail = toLineItems({ items: [{ _id: 'b', description: 'Wiper', quantity: 1, unit_price: 10, part_number: '', detail: '   ' }], markupPct: 0, laborHours: 0, laborRate: 0 })
check('a blank detail is not stored at all (absent key, not "")', !('detail' in blankDetail[0]))
const reloaded = fromLineItems(written, 30, undefined, { withLabor: true })
check('detail survives a reload', reloaded[1].detail === added[1].detail)
check('a row without the new fields stores exactly the keys it always did',
  same(Object.keys(written[2]).sort(), ['description', 'part_number', 'quantity', 'total', 'type', 'unit_price']))

console.log('\n$0.00, included and customer-supplied (spec 2.5, item 2)')
const zero: EditItem[] = [
  { _id: 'z1', kind: 'labor', description: 'Diagnostic scan', quantity: 0.5, unit_price: 110, part_number: '', included: true },
  { _id: 'z2', description: 'Clock spring (customer supplied)', quantity: 1, unit_price: 95, part_number: '', customer_supplied: true },
  { _id: 'z3', description: 'Shop rag', quantity: 1, unit_price: 0, part_number: '' },
]
const zw = toLineItems({ items: zero, markupPct: 30, laborHours: 0, laborRate: 110 })
check('an included line stores is_included and charges 0', zw[0].is_included === true && zw[0].total === 0 && zw[0].unit_price === 0)
check('a customer-supplied part stores the flag and prints at $0.00', zw[1].customer_supplied === true && zw[1].total === 0)
check('a plain $0 line is kept, not dropped', zw.length === 3 && zw[2].total === 0)
const zt = computeTotals({ items: zero, markupPct: 30, laborHours: 0, laborRate: 110, taxPct: 7 })
check('none of the three adds money', zt.grandTotal === 0, `grand ${zt.grandTotal}`)
check('customer_supplied is never stored on a labour line', !('customer_supplied' in toLineItems({
  items: [{ ...zero[0], included: false, customer_supplied: true }], markupPct: 0, laborHours: 0, laborRate: 0 })[0]))

console.log('\nRecorded terms beat current settings')
const TODAY: TaxSettings = { tax_parts: true, tax_labor: true, tax_rate_parts: 9, tax_rate_labor: 9 }
const rec = documentTaxSettings({ labor: { base: 165, rate: 7, taxed: true, amount: 11.55 }, version: 1 }, TODAY, 7)
check('a recorded labour bucket keeps its 7%, not today\'s 9%', rec?.tax_rate_labor === 7 && rec.tax_labor)
check('a bucket the document never had takes the current setting', rec?.tax_rate_parts === 9)
check('no breakdown -> null, so the document\'s single tax_percent applies as it did', documentTaxSettings(null, TODAY, 7) === null)
const exempt = documentTaxSettings({ labor: { base: 100, rate: 0, taxed: false, amount: 0 }, version: 1 }, TODAY, 7)
check('labour recorded EXEMPT stays exempt when today taxes it', exempt?.tax_labor === false)
const ex = documentExtras({ travel_hours: 1.5, travel_rate: 90, mileage_miles: 0, mileage_rate: null, shop_supplies_percent_applied: null })
check('stored travel hours and rate come back, not zero', ex.input.travelHours === 1.5 && ex.input.travelRateOverride === 90)
check('an extra the document never recorded stays off (EXTRAS_OFF + overrides only)', same(ex.settings, EXTRAS_OFF) && ex.input.shopSuppliesPercentOverride === null)

console.log('\nEvery real LD quote and work order: a no-op save changes nothing')
async function realRows() {
  loadEnv()
  const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const H = { apikey: K, Authorization: `Bearer ${K}` }
  const get = async (q: string) => {
    const r = await fetch(`${S}/rest/v1/${q}`, { headers: H })
    if (!r.ok) throw new Error(`${q.split('?')[0]} ${r.status} ${await r.text()}`)
    return r.json() as Promise<Record<string, unknown>[]>
  }
  const COLS = 'id,user_id,line_items,labor_hours,labor_rate,parts_subtotal,parts_markup_percent,labor_subtotal,' +
    'tax_percent,tax_amount,grand_total,tax_breakdown,travel_hours,travel_rate,travel_amount,mileage_miles,' +
    'mileage_rate,mileage_amount,shop_supplies_percent_applied,shop_supplies_cap_applied,shop_supplies_fee'
  const profiles = new Map<string, TaxSettings>()
  for (const [table, extraCols] of [['quotes', ',service_lines'], ['work_orders', ',pricing_mode']] as const) {
    const rows = await get(`${table}?select=${COLS}${extraCols}&limit=1000`)
    let checked = 0
    const bad: string[] = []
    const inconsistent: string[] = []
    for (const r of rows) {
      const li = Array.isArray(r.line_items) ? r.line_items as LineItem[] : []
      if (li.length === 0) continue
      // Detailer quotes bill service_lines; segment work orders bill their segments.
      if (Array.isArray(r.service_lines) && r.service_lines.length > 0) continue
      if (r.pricing_mode === 'segments') continue
      // A document whose stored total does not equal its own lines + extras + tax was
      // already wrong before this editor existed. Listed so it is visible, and still
      // checked: an unchanged save must leave even a wrong document exactly as it is.
      const stated = li.reduce((s, l) => s + Number(l.total ?? 0), 0) +
        Number(r.travel_amount ?? 0) + Number(r.mileage_amount ?? 0) + Number(r.shop_supplies_fee ?? 0) +
        Number(r.tax_amount ?? 0)
      if (Math.abs(stated - Number(r.grand_total ?? 0)) > 0.011) {
        inconsistent.push(`${String(r.id).slice(0, 8)}: stored grand ${r.grand_total}, its own lines + extras + tax ${round(stated)}`)
      }
      const uid = String(r.user_id)
      if (!profiles.has(uid)) {
        const p = (await get(`profiles?select=${TAX_SETTINGS_SELECT}&id=eq.${uid}`))[0]
        profiles.set(uid, taxSettingsFrom(p))
      }
      const markup = markupOnReopen(r.parts_markup_percent as number | null)
      const items  = fromLineItems(li, markup.percent, undefined, { withLabor: true })
      const taxPct = Number(r.tax_percent ?? 0)
      const ext    = documentExtras(r)
      const m = documentMoney({
        items, markupPct: markup.percent, laborRate: Number(r.labor_rate ?? 0), taxPct,
        taxSettings: documentTaxSettings(r.tax_breakdown, profiles.get(uid)!, taxPct),
        extrasSettings: ext.settings, extras: ext.input, stored: r,
      })
      // And the same lines with ONE real edit still re-total from the lines, so the
      // no-op rule cannot be hiding a calculator that ignores edits.
      if (items.length > 0) {
        const bumped = items.map((it, i) => i === 0 ? { ...it, quantity: Number(it.quantity) + 1 } : it)
        const e = documentMoney({
          items: bumped, markupPct: markup.percent, laborRate: Number(r.labor_rate ?? 0), taxPct,
          taxSettings: documentTaxSettings(r.tax_breakdown, profiles.get(uid)!, taxPct),
          extrasSettings: ext.settings, extras: ext.input, stored: r,
        })
        const first = li[0]
        const expectUp = !first.is_included && !first.customer_supplied && Number(first.unit_price) > 0
        if (expectUp && !(Number(e.columns.grand_total) > Number(r.grand_total))) {
          bad.push(`${String(r.id).slice(0, 8)}: one more of line 1 did not raise the total`)
        }
      }
      checked++
      const c = m.columns
      const diffs: string[] = []
      if (!same(c.line_items, li)) diffs.push('line_items')
      for (const k of ['grand_total', 'tax_amount', 'labor_subtotal', 'parts_subtotal', 'travel_amount', 'mileage_amount', 'shop_supplies_fee'] as const) {
        if (r[k] == null) continue
        if (Math.abs(Number(c[k]) - Number(r[k])) > 0.005) diffs.push(`${k} ${r[k]} -> ${c[k]}`)
      }
      if (r.labor_hours != null && Math.abs(Number(c.labor_hours) - Number(r.labor_hours)) > 0.0001) diffs.push(`labor_hours ${r.labor_hours} -> ${c.labor_hours}`)
      if (diffs.length) bad.push(`${String(r.id).slice(0, 8)}: ${diffs.join('; ')}`)
    }
    check(`${table}: real rows to check (guards a vacuous pass)`, checked > 0, `${checked}`)
    check(`${table}: opening and saving every one changes no line and no total`, bad.length === 0,
      bad.length ? `${bad.length} moved:\n        ${bad.join('\n        ')}` : `${checked} documents`)
    if (inconsistent.length) {
      console.log(`  note  ${table}: ${inconsistent.length} stored document(s) already disagree with themselves (pre-existing; each still saves unchanged):`)
      for (const s of inconsistent) console.log(`          ${s}`)
    }
  }
}

function round(n: number) { return Math.round(n * 100) / 100 }

realRows()
  .catch(e => { failures++; console.log(`  FAIL  real rows could not be read: ${e instanceof Error ? e.message : e}`) })
  .finally(() => {
    console.log(`\n${passes} passed, ${failures} failed`)
    if (failures) process.exit(1)
  })
