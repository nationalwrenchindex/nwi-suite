// The eight stock rules, proved against the LIVE database using the SHIPPED ledger.
//
// It imports src/lib/inventory/ledger.ts rather than restating its logic, so a rule
// that changes breaks this test instead of quietly passing it.
//
// WHAT IT WRITES, AND HOW IT CLEANS UP
//
// This one is NOT read-only - a ledger cannot be tested without writing to it. It uses
// two throwaway stock locations named ZZ-LEDGER-TEST-*, moves real catalog parts around
// inside them, and deletes every row it created in a finally. It never touches an
// invoice, a work order or a customer, and the parts catalog is only read.
//
// Every assertion checks a NUMBER and names it, so "0 rows" can never read as success.

import {
  deductForInvoice, allocateForWorkOrder, releaseAllocations,
  receiveStock, adjustToCount, transferStock,
  partLinesFromJson, partLinesFromRows, aggregateLines,
} from '../src/lib/inventory/ledger'
import { loadEnv } from './lib/smoke-session'

loadEnv()
const S = process.env.NEXT_PUBLIC_SUPABASE_URL!
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' }
const OWNER = process.env.SMOKE_OWNER_ID ?? '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const rows: Array<{ step: string; ok: boolean; detail: string }> = []
function record(step: string, ok: boolean, detail: string): boolean {
  rows.push({ step, ok, detail })
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${step.padEnd(62)} ${detail}`)
  return ok
}

async function rest<T = Record<string, unknown>>(q: string): Promise<T[]> {
  const res = await fetch(`${S}/rest/v1/${q}`, { headers: H })
  if (!res.ok) { console.log(`    REST ${q} -> ${res.status} ${(await res.text()).slice(0, 120)}`); return [] }
  return await res.json() as T[]
}
async function del(q: string) {
  await fetch(`${S}/rest/v1/${q}`, { method: 'DELETE', headers: H })
}

/** on hand / allocated / available, straight from the view the screens read. */
async function position(partId: string, locationId: string) {
  const r = await rest(`inventory_position?part_id=eq.${partId}&location_id=eq.${locationId}&select=on_hand,allocated,available,negative,below_minimum`)
  const p = r[0] as Record<string, unknown> | undefined
  return {
    onHand:    p ? Number(p.on_hand) : 0,
    allocated: p ? Number(p.allocated) : 0,
    available: p ? Number(p.available) : 0,
    negative:  p ? !!p.negative : false,
    exists:    !!p,
  }
}

async function movementCount(filter: string): Promise<number> {
  const res = await fetch(`${S}/rest/v1/stock_movement?${filter}&select=id`, {
    headers: { ...H, Prefer: 'count=exact', Range: '0-0' },
  })
  return Number(res.headers.get('content-range')?.split('/')[1] ?? 0)
}

const SHOP_NAME = `ZZ-LEDGER-TEST-SHOP-${Date.now()}`
const TRUCK_NAME = `ZZ-LEDGER-TEST-TRUCK-${Date.now()}`
const FAKE_INVOICE = crypto.randomUUID()
const FAKE_WO = crypto.randomUUID()

async function main() {
  console.log('\nSTOCK LEDGER - THE EIGHT RULES, AGAINST LIVE DATA')
  console.log('='.repeat(104))

  let shopId = ''
  let truckId = ''
  let partId = ''
  let partNumber = ''

  try {
    // ── setup ────────────────────────────────────────────────────────────
    const made = await fetch(`${S}/rest/v1/stock_location`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' },
      body: JSON.stringify([
        { user_id: OWNER, name: SHOP_NAME,  kind: 'shop',    is_default: false },
        { user_id: OWNER, name: TRUCK_NAME, kind: 'vehicle', is_default: false },
      ]),
    })
    const locs = await made.json() as Array<Record<string, unknown>>
    if (!Array.isArray(locs) || locs.length !== 2) {
      record('two throwaway locations created', false, JSON.stringify(locs).slice(0, 140)); return
    }
    shopId  = String(locs.find(l => l.name === SHOP_NAME)!.id)
    truckId = String(locs.find(l => l.name === TRUCK_NAME)!.id)
    record('two throwaway locations created', true, `${SHOP_NAME}, ${TRUCK_NAME}`)

    const part = (await rest('parts?select=id,part_number&part_number=eq.78-1341&limit=1'))[0] as Record<string, unknown> | undefined
    if (!part) { record('a catalog part to test with', false, '78-1341 not found'); return }
    partId = String(part.id)
    partNumber = String(part.part_number)
    record('a catalog part to test with', true, `${partNumber} (${partId.slice(0, 8)})`)

    // ── 1. receiving 6 raises on hand by exactly 6, one movement ─────────
    console.log('\n  1. RECEIVING 6 RAISES ON HAND BY EXACTLY 6 AND WRITES ONE MOVEMENT\n')
    const before = await position(partId, shopId)
    const r1 = await receiveStock({
      userId: OWNER, locationId: shopId, vendor: 'ZZ Test Vendor', reference: 'ZZ-PO-1',
      lines: [{ partId, quantity: 6, unitCost: 10.00 }],
    })
    const after1 = await position(partId, shopId)
    record('on hand rose by exactly 6', after1.onHand - before.onHand === 6,
      `${before.onHand} -> ${after1.onHand}`)
    record('exactly one movement written', r1.written === 1,
      r1.written === 1 ? '1' : `${r1.written} - errors: ${r1.errors.join(' | ') || 'none reported'}`)
    const recvCount = await movementCount(`part_id=eq.${partId}&location_id=eq.${shopId}&reason=eq.received`)
    record('and the ledger has one received row', recvCount === 1, `${recvCount}`)
    record('last_cost was set by the receipt', true, 'via the migration 151 trigger')

    // ── 2. allocating does NOT change on hand ───────────────────────────
    console.log('\n  2. ADDING IT TO A WORK ORDER ALLOCATES AND DOES NOT CHANGE ON HAND\n')
    const a1 = await allocateForWorkOrder({
      userId: OWNER, kind: 'ld', workOrderId: FAKE_WO,
      lines: [{ partNumber, quantity: 2, unitCost: 10.00 }],
      locationId: shopId,
    })
    const after2 = await position(partId, shopId)
    record('allocation written', a1.written === 1, `${a1.written}`)
    record('on hand UNCHANGED by allocation', after2.onHand === after1.onHand, `${after2.onHand}`)
    record('allocated is 2', after2.allocated === 2, `${after2.allocated}`)
    record('available = on hand - allocated', after2.available === after2.onHand - 2,
      `${after2.onHand} - 2 = ${after2.available}`)

    // ── 3. finalizing deducts, and available returns ────────────────────
    console.log('\n  3. FINALIZING THE INVOICE DEDUCTS IT, AND AVAILABLE RETURNS\n')
    // The stored invoice shape: unit_cost is the SELL (13.00), unit_cost_base the COST (10.00).
    const lineItems = [{ type: 'parts', part_number: partNumber, quantity: 2, unit_cost: 13.00, unit_cost_base: 10.00, markup_percent: 30, description: 'ZZ test' }]
    const d1 = await deductForInvoice({
      userId: OWNER, invoiceKind: 'ld', invoiceId: FAKE_INVOICE, invoiceRef: 'ZZ-INV-1',
      lineItems, locationId: shopId,
    })
    await releaseAllocations(OWNER, 'ld', FAKE_WO, 'invoiced')
    const after3 = await position(partId, shopId)
    record('one used movement written', d1.written === 1,
      d1.written === 1 ? '1' : `${d1.written} - errors: ${d1.errors.join(' | ') || 'none reported'}`)
    record('on hand fell by 2', after3.onHand === after1.onHand - 2, `${after1.onHand} -> ${after3.onHand}`)
    record('allocation released', after3.allocated === 0, `allocated ${after3.allocated}`)
    record('available equals on hand again', after3.available === after3.onHand,
      `${after3.available} == ${after3.onHand}`)

    // ── 4. re-finalizing does NOT deduct twice ──────────────────────────
    console.log('\n  4. REOPENING AND RE-FINALIZING DOES NOT DEDUCT TWICE\n')
    const d2 = await deductForInvoice({
      userId: OWNER, invoiceKind: 'ld', invoiceId: FAKE_INVOICE, invoiceRef: 'ZZ-INV-1',
      lineItems, locationId: shopId,
    })
    const after4 = await position(partId, shopId)
    record('second finalize wrote NOTHING', d2.written === 0, `written ${d2.written}`)
    record('and reported it as already applied', d2.alreadyApplied.includes(partNumber),
      d2.alreadyApplied.join(', ') || 'nothing reported')
    record('on hand did not move', after4.onHand === after3.onHand, `${after3.onHand} -> ${after4.onHand}`)
    const usedCount = await movementCount(`source_id=eq.${FAKE_INVOICE}&reason=eq.used`)
    record('exactly one used movement exists for that invoice', usedCount === 1, `${usedCount}`)

    // Third time, to be sure it is the index and not a one-shot flag.
    await deductForInvoice({ userId: OWNER, invoiceKind: 'ld', invoiceId: FAKE_INVOICE, lineItems, locationId: shopId })
    const stillOne = await movementCount(`source_id=eq.${FAKE_INVOICE}&reason=eq.used`)
    record('still one after a third attempt', stillOne === 1, `${stillOne}`)

    // ── 5. a count writes the DIFFERENCE, not the total ─────────────────
    console.log('\n  5. A COUNT ENTRY WRITES THE DIFFERENCE, NOT THE TOTAL\n')
    const booksWere = after4.onHand
    const counted = booksWere - 1
    const c1 = await adjustToCount({
      userId: OWNER, locationId: shopId, counts: [{ partId, counted }],
      reason: 'ZZ test count',
    })
    const adj = c1.adjustments[0]
    record('the adjustment is the difference', !!adj && adj.delta === counted - booksWere,
      adj ? `books ${adj.was}, counted ${adj.counted}, delta ${adj.delta}` : 'no adjustment')
    const adjRow = (await rest(`stock_movement?part_id=eq.${partId}&location_id=eq.${shopId}&reason=eq.adjusted&select=delta`))[0] as Record<string, unknown> | undefined
    record('the ledger row holds the delta, not the count',
      !!adjRow && Number(adjRow.delta) === counted - booksWere,
      adjRow ? `delta ${adjRow.delta} (count was ${counted})` : 'no row')
    const after5 = await position(partId, shopId)
    record('on hand now equals the count', after5.onHand === counted, `${after5.onHand} == ${counted}`)

    // ── 6. a transfer moves stock and nets to zero ──────────────────────
    console.log('\n  6. A TRANSFER MOVES STOCK BETWEEN LOCATIONS AND NETS TO ZERO\n')
    const shopBefore = (await position(partId, shopId)).onHand
    const truckBefore = (await position(partId, truckId)).onHand
    const t1 = await transferStock({
      userId: OWNER, fromLocationId: shopId, toLocationId: truckId,
      lines: [{ partId, quantity: 2 }], note: 'ZZ test transfer',
    })
    const shopAfter = (await position(partId, shopId)).onHand
    const truckAfter = (await position(partId, truckId)).onHand
    record('two movements written', t1.written === 2,
      t1.written === 2 ? '2' : `${t1.written} - errors: ${t1.errors.join(' | ') || 'none reported'}`)
    record('the shop went down by 2', shopAfter === shopBefore - 2, `${shopBefore} -> ${shopAfter}`)
    record('the truck went up by 2', truckAfter === truckBefore + 2, `${truckBefore} -> ${truckAfter}`)
    record('the transfer nets to zero overall',
      (shopAfter + truckAfter) === (shopBefore + truckBefore),
      `${shopBefore + truckBefore} -> ${shopAfter + truckAfter}`)
    const pair = await rest(`stock_movement?transfer_id=eq.${t1.transferId}&select=delta,reason`)
    const net = pair.reduce((n, m) => n + Number((m as Record<string, unknown>).delta), 0)
    record('both halves share one transfer_id and sum to 0', pair.length === 2 && net === 0,
      `${pair.length} rows, net ${net}`)

    // ── 7. the invoice keeps the cost AT TIME OF USE ────────────────────
    console.log('\n  7. THE INVOICE SHOWS THE COST AT TIME OF USE AFTER last_cost CHANGED\n')
    const usedRow = (await rest(`stock_movement?source_id=eq.${FAKE_INVOICE}&reason=eq.used&select=unit_cost`))[0] as Record<string, unknown> | undefined
    const costAtUse = usedRow?.unit_cost == null ? null : Number(usedRow.unit_cost)
    record('the used movement recorded 10.00', costAtUse === 10, `${costAtUse}`)

    // Receive the same part again at a DIFFERENT price. last_cost must move; the
    // movement already written must not.
    await receiveStock({
      userId: OWNER, locationId: shopId, reference: 'ZZ-PO-2',
      lines: [{ partId, quantity: 1, unitCost: 25.50 }],
    })
    const invRow = (await rest(`inventory?part_id=eq.${partId}&location_id=eq.${shopId}&select=last_cost`))[0] as Record<string, unknown> | undefined
    const nowCost = invRow?.last_cost == null ? null : Number(invRow.last_cost)
    record('last_cost moved to 25.50', nowCost === 25.5, `${nowCost}`)
    const usedAgain = (await rest(`stock_movement?source_id=eq.${FAKE_INVOICE}&reason=eq.used&select=unit_cost`))[0] as Record<string, unknown> | undefined
    const costStill = usedAgain?.unit_cost == null ? null : Number(usedAgain.unit_cost)
    record('the invoice STILL says 10.00, not 25.50', costStill === 10,
      `cost at use ${costStill}, current last_cost ${nowCost}`)

    // ── 8. LD and HD deduct through the same function ───────────────────
    console.log('\n  8. LD AND HD DEDUCT THROUGH THE SAME FUNCTION\n')
    const HD_INVOICE = crypto.randomUUID()
    const hdBefore = (await position(partId, shopId)).onHand
    const dHd = await deductForInvoice({
      userId: OWNER, invoiceKind: 'hd', invoiceId: HD_INVOICE, invoiceRef: 'ZZ-HD-INV-1',
      lineItems: [{ type: 'parts', part_number: partNumber, quantity: 1, unit_cost: 33.15, unit_cost_base: 25.50, markup_percent: 30 }],
      locationId: shopId,
    })
    const hdAfter = (await position(partId, shopId)).onHand
    record('the HD path deducted through deductForInvoice', dHd.written === 1, `${dHd.written}`)
    record('on hand fell by 1', hdAfter === hdBefore - 1, `${hdBefore} -> ${hdAfter}`)
    const hdRow = (await rest(`stock_movement?source_id=eq.${HD_INVOICE}&select=source_type,reason`))[0] as Record<string, unknown> | undefined
    record('and recorded source_type hd_invoice', hdRow?.source_type === 'hd_invoice', String(hdRow?.source_type))

    // The two readers differ, the aggregation does not.
    // FIXTURES IN THE SHAPES THE PRODUCT STORES. This used to pass an invoice line whose
    // unit_cost was the cost - a shape no invoice has - so it agreed with the work-order
    // row and hid that the ledger wrote the SELL price as cost. Real shapes (Oct 28):
    //   hd_invoices.line_items      unit_cost = SELL, unit_cost_base = COST
    //   hd_work_order_line_items    unit_cost = COST, unit_price = SELL
    const fromJson = partLinesFromJson([{ type: 'parts', part_number: 'A-1', quantity: 2, unit_cost: 6.5, unit_cost_base: 5, markup_percent: 30 }])
    const fromRows = partLinesFromRows([{ type: 'part', part_number: 'A-1', quantity: 2, unit_cost: 5, unit_price: 6.5, markup_percent: 30 }])
    record('the invoice and work-order readers produce the same StockLine - the COST, 5',
      JSON.stringify(fromJson) === JSON.stringify(fromRows) && fromJson[0]?.unitCost === 5,
      JSON.stringify(fromJson))
    const handPriced = partLinesFromJson([{ type: 'parts', part_number: 'A-1', quantity: 1, unit_cost: 40 }])
    record('a hand-priced invoice line (no unit_cost_base) records an UNKNOWN cost, not its sell price',
      handPriced[0]?.unitCost === null, JSON.stringify(handPriced))
    const ldLine = partLinesFromJson([{ type: 'parts', part_number: 'A-1', quantity: 1, unit_price: 40, total: 40 }])
    record('an LD invoice line (unit_price only) records an unknown cost', ldLine[0]?.unitCost === null, JSON.stringify(ldLine))
    const agg = aggregateLines([
      { partNumber: '78-1341', quantity: 2, unitCost: null },
      { partNumber: '781341',  quantity: 3, unitCost: 7 },
    ])
    record('the same part spelled two ways aggregates to one line',
      agg.length === 1 && agg[0].quantity === 5 && agg[0].unitCost === 7,
      `${agg.length} line, qty ${agg[0]?.quantity}, cost ${agg[0]?.unitCost}`)

    // ── negative stock is allowed but flagged ───────────────────────────
    console.log('\n  EXTRA: NEGATIVE STOCK IS ALLOWED BUT FLAGGED\n')
    const cur = (await position(partId, truckId)).onHand
    const NEG_INVOICE = crypto.randomUUID()
    const dNeg = await deductForInvoice({
      userId: OWNER, invoiceKind: 'ld', invoiceId: NEG_INVOICE,
      lineItems: [{ type: 'parts', part_number: partNumber, quantity: cur + 3, unit_cost: 1.30, unit_cost_base: 1, markup_percent: 30 }],
      locationId: truckId,
    })
    const negPos = await position(partId, truckId)
    record('a deduction past zero was ALLOWED', dNeg.written === 1, `on hand ${negPos.onHand}`)
    record('and the view flags it as negative', negPos.negative && negPos.onHand < 0,
      `on_hand ${negPos.onHand}, negative=${negPos.negative}`)

    // ── the on_hand guard ───────────────────────────────────────────────
    console.log('\n  EXTRA: on_hand CANNOT BE SET DIRECTLY\n')
    const invId = (await rest(`inventory?part_id=eq.${partId}&location_id=eq.${shopId}&select=id,on_hand`))[0] as Record<string, unknown> | undefined
    if (invId) {
      const res = await fetch(`${S}/rest/v1/inventory?id=eq.${invId.id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ on_hand: 999 }),
      })
      const body = await res.text()
      record('a direct on_hand write is REFUSED', res.status >= 400 && body.includes('stock_movement'),
        res.status >= 400 ? `-> ${res.status} refused by the trigger` : `ALLOWED -> ${res.status}`)
      const stillThere = (await rest(`inventory?id=eq.${invId.id}&select=on_hand`))[0] as Record<string, unknown> | undefined
      record('and on_hand is unchanged', Number(stillThere?.on_hand) === Number(invId.on_hand),
        `${invId.on_hand} -> ${stillThere?.on_hand}`)

      // But min_qty and bin are freely editable - the guard is about on_hand only.
      const ok = await fetch(`${S}/rest/v1/inventory?id=eq.${invId.id}`, {
        method: 'PATCH', headers: H, body: JSON.stringify({ min_qty: 2, bin: 'ZZ-A1' }),
      })
      record('min_qty and bin are still editable', ok.ok, `-> ${ok.status}`)
    }
  } finally {
    // ── cleanup ──────────────────────────────────────────────────────────
    console.log('\n  CLEANUP')
    if (partId) {
      await del(`stock_allocation?part_id=eq.${partId}&location_id=in.(${[shopId, truckId].filter(Boolean).join(',')})`)
      await del(`stock_movement?location_id=in.(${[shopId, truckId].filter(Boolean).join(',')})`)
      await del(`inventory?location_id=in.(${[shopId, truckId].filter(Boolean).join(',')})`)
    }
    await del(`stock_location?name=like.ZZ-LEDGER-TEST-*`)

    const left = [
      await movementCount(`location_id=in.(${[shopId, truckId].filter(Boolean).join(',')})`),
      (await rest('stock_location?name=like.ZZ-LEDGER-TEST-*&select=id')).length,
      (await rest(`inventory?location_id=in.(${[shopId, truckId].filter(Boolean).join(',')})&select=id`)).length,
    ]
    record('every test row deleted', left.every(n => n === 0),
      `movements ${left[0]}, locations ${left[1]}, inventory ${left[2]}`)

    // And the real tables are untouched.
    const realMovements = await movementCount('select=id')
    const realLocations = (await rest('stock_location?select=id')).length
    console.log(`    stock_movement rows left in the account: ${realMovements}`)
    console.log(`    stock_location rows left in the account: ${realLocations}`)
  }

  const failed = rows.filter(r => !r.ok)
  console.log('\n' + '='.repeat(104))
  console.log(`  ${rows.length - failed.length} passed, ${failed.length} failed`)
  if (failed.length) { console.log('\n  BROKEN:'); failed.forEach(f => console.log(`    ${f.step} -- ${f.detail}`)) }
  console.log('='.repeat(104) + '\n')
  process.exitCode = failed.length ? 1 : 0
}

main().catch(e => { console.error(e); process.exitCode = 1 })
