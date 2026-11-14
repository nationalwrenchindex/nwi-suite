// npx tsx scripts/verify-invoice-edit-server.ts
//
// READ-ONLY. Fixtures are REAL ROWS, never an assumed shape:
//   - every stored HD invoice, for the server-side pricing of the PUT
//   - INV-2026-0057's real stock movements and WO-2026-1576's real part lines, for the
//     refresh stock planner
// Writes nothing.
import { loadEnv } from './lib/smoke-session'
import { serverPricedUpdate, serverLines } from '../src/lib/hd/invoice-edit-server'
import { openInvoiceEdit, invoiceSaveBody, invoiceDoesNotAddUp } from '../src/lib/hd/invoice-edit-save'
import { planInvoiceStockDiff, type DocMovement, type TargetPart } from '../src/lib/inventory/ledger'
import { isInvoiceLocked, holdsOlderCopy, changedAfterSendFields, wasSent, customerFacingChanges } from '../src/lib/hd/invoice-lock'
import { normalizePartNumber } from '../src/lib/parts/search'
loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!, K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}` }
async function get(q: string): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = []
  for (let f = 0; ; f += 1000) {
    const j = await (await fetch(`${S}/rest/v1/${q}`, { headers: { ...H, Range: `${f}-${f + 999}` } })).json()
    if (!Array.isArray(j)) throw new Error(`${q}: ${JSON.stringify(j)}`)
    out.push(...j); if (j.length < 1000) return out
  }
}
let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++; else fail++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`)
}
const usd = (n: unknown) => (Math.round(Number(n ?? 0) * 100) / 100).toFixed(2)
const NOW = new Date('2026-11-14T12:00:00Z')

async function main() {
  // ── 1. THE PUT, priced on the server, against every stored invoice ──────────
  const invoices = await get('hd_invoices?select=*&order=id')
  const shop = { laborRate: null, extras: null }
  let adding = 0, ignored = 0, unchanged = 0, match = 0, refusedBroken = 0
  const misses: string[] = []
  for (const inv of invoices) {
    const broken = invoiceDoesNotAddUp(inv)
    const opened = openInvoiceEdit(inv, null)
    // a. A body that sends only a forged total changes no money.
    const forged = serverPricedUpdate(inv, { total: 1, tax_amount: 0, subtotal_parts: 0 }, shop, NOW)
    if (forged.ok && !('total' in forged.update) && !('tax_amount' in forged.update) && forged.ignoredTotals.length === 3) ignored++
    else misses.push(`forged ${inv.invoice_number}`)
    // b. The editor's unchanged save, sent with its lines: no money moves.
    const same = serverPricedUpdate(inv, { line_items: inv.line_items, total: 99999 }, shop, NOW)
    if (broken) {
      if (!same.ok && same.status === 409) refusedBroken++
      else misses.push(`broken ${inv.invoice_number} was priced`)
      continue
    }
    if (same.ok && !('total' in same.update) && !('tax_amount' in same.update)) unchanged++
    else misses.push(`unchanged ${inv.invoice_number}: ${JSON.stringify(same).slice(0, 160)}`)
    // c. Add a $100.00 part in the editor: the server writes exactly the editor's figures.
    const edited = { ...opened.state, lines: [...opened.state.lines, {
      id: 'verify-part', type: 'parts' as const, description: 'verify part', mobile_hours: 0,
      part_number: '', quantity: 1, unit_cost: 100, amount: 100,
    }] }
    let client: Record<string, unknown>
    try { client = invoiceSaveBody(inv, opened, edited, NOW) } catch { continue }
    adding++
    // The browser's totals are sent too, tampered: they must not survive.
    const server = serverPricedUpdate(inv, { ...client, total: Number(client.total ?? 0) + 50 }, shop, NOW)
    if (server.ok && usd(server.update.total) === usd(client.total) && usd(server.update.tax_amount ?? inv.tax_amount) === usd(client.tax_amount ?? inv.tax_amount)) match++
    else misses.push(`add-part ${inv.invoice_number}: client ${usd(client.total)} server ${server.ok ? usd(server.update.total) : server.error}`)
  }
  check(`a forged total is dropped on all ${invoices.length} invoices`, ignored === invoices.length, `${ignored}/${invoices.length}`)
  check('an unchanged save with a forged total moves no money (every invoice that adds up)', unchanged === invoices.length - refusedBroken, `${unchanged}`)
  check('an invoice that does not add up is refused, never re-priced', refusedBroken === invoices.filter(i => invoiceDoesNotAddUp(i)).length, `${refusedBroken} refused`)
  check(`adding a $100 part: the server writes the editor's own total, not the browser's (${adding} invoices)`, adding > 0 && match === adding, `${match}/${adding}`)
  if (misses.length) console.log('   ', misses.slice(0, 8).join('\n    '))

  // Line amounts: parts re-derived, a stored labor line kept as billed.
  const odd = invoices.find(i => i.invoice_number === 'INV-2026-0023')
  if (odd) {
    const stored = openInvoiceEdit(odd, null).state.lines
    const back = serverLines(odd.line_items, stored, Number(odd.labor_rate))
    check('a stored labor line priced off-rate (INV-2026-0023 6h at $870) keeps its billed amount',
      JSON.stringify(back.map(l => l.amount)) === JSON.stringify(stored.map(l => l.amount)), back.map(l => l.amount).join(','))
    const forgedPart = serverLines([{ type: 'parts', description: 'x', quantity: 2, unit_cost: 10, amount: 1 }], stored, 135)
    check('a part line with a forged amount is billed quantity x price', forgedPart[0].amount === 20, String(forgedPart[0].amount))
    const changedLabor = serverLines([{ ...stored.find(l => l.type === 'labor')!, mobile_hours: 7 }], stored, Number(odd.labor_rate))
    check('a labor line whose hours changed is priced hours x the invoice rate', changedLabor[0].amount === 7 * Number(odd.labor_rate), String(changedLabor[0].amount))
  } else check('INV-2026-0023 exists to test the off-rate labor line', false)

  // ── 2. LOCK RULES ──────────────────────────────────────────────────────────
  const statuses = [...new Set(invoices.map(i => String(i.status)))].sort()
  check('paid, partial and void are locked; unpaid, sent and overdue are not',
    ['paid', 'partial', 'void'].every(isInvoiceLocked) && !['unpaid', 'sent', 'overdue'].some(isInvoiceLocked), `statuses in use: ${statuses.join(', ')}`)
  const sentOne = invoices.find(i => wasSent(i) && !isInvoiceLocked(i.status))
  if (sentOne) {
    const f = changedAfterSendFields({ ...sentOne, changed_after_send_at: null }, { total: Number(sentOne.total) + 1 }, 'edit', NOW)
    check(`a change to a sent invoice (${sentOne.invoice_number}) is stamped and noted`,
      typeof f.changed_after_send_at === 'string' && String(f.internal_notes).includes('Changed after it was sent'), String(f.internal_notes).split('\n').pop())
    const noop = changedAfterSendFields(sentOne, { status: 'paid', internal_notes: 'x' }, 'edit', NOW)
    check('a status-only change to a sent invoice is not a customer-facing change', Object.keys(noop).length === 0)
    check('the banner shows while the change is later than the last send, and clears after a resend',
      holdsOlderCopy({ ...sentOne, changed_after_send_at: NOW.toISOString() })
        && !holdsOlderCopy({ ...sentOne, changed_after_send_at: NOW.toISOString(), last_sent_at: '2026-11-15T00:00:00Z' }))
  } else check('a sent, unpaid real invoice to test the stamp on', false, 'none found')
  // jsonb hands keys back in its own order: the same split, keys reversed, is no change.
  const withSplit = invoices.find(i => i.tax_breakdown && typeof i.tax_breakdown === 'object')
  if (withSplit) {
    const reorder = (o: unknown): unknown => (o && typeof o === 'object' && !Array.isArray(o)
      ? Object.fromEntries(Object.entries(o as Record<string, unknown>).reverse().map(([k, v]) => [k, reorder(v)])) : o)
    check(`${withSplit.invoice_number}'s stored tax split with its keys reordered is not a change`,
      customerFacingChanges(withSplit, { tax_breakdown: reorder(withSplit.tax_breakdown) }).length === 0)
  }
  const neverSent = invoices.find(i => !wasSent(i))
  if (neverSent) check(`a change to an unsent invoice (${neverSent.invoice_number}) records nothing extra`,
    Object.keys(changedAfterSendFields(neverSent, { total: 1 }, 'edit', NOW)).length === 0)

  // ── 3. THE REFRESH STOCK PLAN, on INV-2026-0057's real movements ────────────
  const inv57 = invoices.find(i => i.invoice_number === 'INV-2026-0057')
  if (!inv57) { check('INV-2026-0057 exists', false); return report() }
  const mv = await get(`stock_movement?select=part_id,location_id,delta,reason,unit_cost&source_type=eq.hd_invoice&source_id=eq.${inv57.id}`)
  const existing: DocMovement[] = mv.map(m => ({ partId: m.part_id, locationId: m.location_id, delta: m.delta, reason: m.reason, unitCost: m.unit_cost == null ? null : Number(m.unit_cost) }))
  const lines = await get(`hd_work_order_line_items?select=type,part_number,quantity,unit_cost&work_order_id=eq.${inv57.work_order_id}`)
  const catalog = await get('parts?select=id,part_number,part_number_normalized&order=id')
  const byNorm = new Map(catalog.map(p => [String(p.part_number_normalized), String(p.id)]))
  const target: TargetPart[] = []
  for (const l of lines) {
    if (String(l.type).toLowerCase() !== 'part' || !l.part_number) continue
    const pid = byNorm.get(normalizePartNumber(l.part_number))
    if (pid) target.push({ partId: pid, partNumber: l.part_number, quantity: Number(l.quantity), unitCost: l.unit_cost == null ? null : Number(l.unit_cost) })
  }
  const loc = existing[0]?.locationId ?? 'default'
  check(`INV-2026-0057 has ${existing.length} real movements and WO-2026-1576 ${target.length} catalog parts`, existing.length > 0 && target.length === existing.length)
  const none = planInvoiceStockDiff(existing, target, loc)
  check('refreshing with the same lines moves nothing', none.length === 0, JSON.stringify(none))
  const ids = target.map(t => t.partId)
  const moreSeals = target.map(t => t.partNumber === '22-1101' ? { ...t, quantity: t.quantity + 1 } : t)
  const p1 = planInvoiceStockDiff(existing, moreSeals, loc)
  check('one more 22-1101 billed: one adjusted movement of -1, not a second deduction of the whole line',
    p1.length === 1 && p1[0].delta === -1 && p1[0].reason === 'adjusted' && p1[0].was === 1 && p1[0].now === 2, JSON.stringify(p1))
  const fewer = target.filter(t => t.partNumber !== '33-2805')
  const p2 = planInvoiceStockDiff(existing, fewer, loc)
  check('33-2805 x3 taken off the invoice: +3 returned to the shelf, at the cost it was taken at',
    p2.length === 1 && p2[0].delta === 3 && p2[0].reason === 'returned' && p2[0].unitCost === Number(mv.find(m => m.part_id === p2[0].partId)?.unit_cost), JSON.stringify(p2))
  const added = [...target, { partId: 'new-part', partNumber: '11-9959', quantity: 2, unitCost: 5 }]
  const p3 = planInvoiceStockDiff(existing, added, loc)
  check('a part new to the invoice is a "used" movement for its quantity',
    p3.length === 1 && p3[0].reason === 'used' && p3[0].delta === -2 && p3[0].locationId === loc, JSON.stringify(p3))
  const after = [...existing, ...p1.map(p => ({ partId: p.partId, locationId: p.locationId, delta: p.delta, reason: p.reason }))]
  check('a second refresh after the first moves nothing more', planInvoiceStockDiff(after, moreSeals, loc).length === 0)
  check('the plan never writes a second "used" for a part the invoice already used', [p1, p2].flat().every(p => p.reason !== 'used'))
  void ids
  report()
}
function report() {
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}
main().catch(e => { console.error(e); process.exit(1) })
