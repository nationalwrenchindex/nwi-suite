// GET  /api/parts/stock   this shop's stock, locations and recent ledger rows
// POST /api/parts/stock   { action: 'receive' | 'count' | 'transfer' | 'settings' | 'location', ... }
//
// The inventory screen's one route, for HD and Reefer Standalone alike.
//
// EVERY CHANGE TO ON-HAND IS A LEDGER ROW. Receive, count and transfer go through
// src/lib/inventory/ledger.ts - the same functions the work-order allocation and the
// invoice deduction use - and migration 151's trigger refuses any other write to
// on_hand. `settings` edits only bin, minimum and sell price, which 151 leaves editable.
//
// SCOPED TWICE. The ledger functions run on the service role, so the user id they get
// comes from the session, never the body, and every part and location in a request is
// checked against this shop before anything is written. Reads go through the user's
// own client, where row level security (and, for the view, migration 173) scopes them.
//
// NO VENDOR. A receipt records quantity, what was paid and a reference number. There
// is no supplier field: no store, retailer or vendor name is stored next to a price.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { adjustToCount, defaultLocationId, receiveStock, transferStock } from '@/lib/inventory/ledger'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

// The ledger rows whose unit_cost is what the shop PAID. A 'used' row carries the
// figure from the invoice line, which on an HD invoice is the SELL price (a known,
// unfixed ledger bug - see the parts counter report), so it is never shown as a cost.
const COST_REASONS = new Set(['received', 'opening', 'transferred_in', 'transferred_out', 'returned'])

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const allowed = (await checkHDAccess(user.id)) || (await reeferStandaloneCan(user.id, 'reefer_parts_reference'))
  if (!allowed) return { error: NextResponse.json({ error: 'A parts subscription is required' }, { status: 403 }) } as const
  return { supabase, userId: user.id } as const
}

export async function GET(request: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { supabase, userId } = g
  const partId = request.nextUrl.searchParams.get('part_id')

  const [pos, locs, moves] = await Promise.all([
    supabase.from('inventory_position')
      .select('inventory_id, part_id, location_id, location_name, location_kind, bin, on_hand, min_qty, last_cost, sell_price, allocated, available, below_minimum, negative')
      .eq('user_id', userId),
    supabase.from('stock_location')
      .select('id, name, kind, is_default, active')
      .eq('user_id', userId)
      .order('created_at'),
    (() => {
      let mq = supabase.from('stock_movement')
        .select('id, part_id, location_id, delta, reason, unit_cost, source_type, source_ref, note, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(partId ? 200 : 50)
      if (partId) mq = mq.eq('part_id', partId)
      return mq
    })(),
  ])
  if (pos.error) {
    console.error('[parts/stock GET] position read failed:', pos.error.message)
    return NextResponse.json({ error: 'Could not read stock' }, { status: 500 })
  }

  // Part numbers for every part on a stock row or a ledger row, in one read.
  const ids = [...new Set([...(pos.data ?? []).map(r => String(r.part_id)), ...(moves.data ?? []).map(r => String(r.part_id))])]
  const parts = new Map<string, { part_number: string; description: string | null; part_type: string; manufacturer: string }>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('parts')
      .select('id, part_number, description, part_type, manufacturer')
      .in('id', ids.slice(i, i + 100))
    for (const p of data ?? []) parts.set(String(p.id), {
      part_number: String(p.part_number), description: (p.description as string | null) ?? null,
      part_type: String(p.part_type), manufacturer: String(p.manufacturer),
    })
  }

  return NextResponse.json({
    stock: (pos.data ?? [])
      .map(r => ({ ...r, ...(parts.get(String(r.part_id)) ?? { part_number: '?', description: null, part_type: '', manufacturer: '' }) }))
      .sort((a, b) => String(a.part_number).localeCompare(String(b.part_number)) || String(a.location_name).localeCompare(String(b.location_name))),
    locations: locs.data ?? [],
    movements: (moves.data ?? []).map(m => ({
      ...m,
      unit_cost: COST_REASONS.has(String(m.reason)) ? m.unit_cost : null,
      part_number: parts.get(String(m.part_id))?.part_number ?? '?',
    })),
  })
}

const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isInteger(n) ? n : null
}
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN
}
const text = (v: unknown, max = 80): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

export async function POST(request: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error
  const { supabase, userId } = g

  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const action = String(body.action ?? '')

  // A location must be this shop's. Checked with the user's client, so RLS answers.
  const ownLocation = async (id: unknown): Promise<{ id: string; kind: string; name: string } | null> => {
    if (typeof id !== 'string' || !id) return null
    const { data } = await supabase.from('stock_location').select('id, kind, name').eq('id', id).eq('user_id', userId).maybeSingle()
    return data ? { id: String(data.id), kind: String(data.kind), name: String(data.name) } : null
  }
  const catalogPart = async (id: unknown): Promise<string | null> => {
    if (typeof id !== 'string' || !id) return null
    const { data } = await supabase.from('parts').select('id').eq('id', id).maybeSingle()
    return data ? String(data.id) : null
  }

  if (action === 'location') {
    const name = text(body.name, 60)
    const kind = body.kind === 'vehicle' ? 'vehicle' : 'shop'
    if (!name) return NextResponse.json({ error: 'Name the location - for a truck, the name the crew calls it.' }, { status: 422 })
    const { data, error } = await supabase.from('stock_location')
      .insert({ user_id: userId, name, kind })
      .select('id, name, kind, is_default, active').single()
    if (error) {
      return NextResponse.json({ error: error.code === '23505' ? `There is already a location called "${name}".` : error.message }, { status: 422 })
    }
    return NextResponse.json({ location: data }, { status: 201 })
  }

  const partId = await catalogPart(body.part_id)
  if (!partId) return NextResponse.json({ error: 'Pick a part from the catalog.' }, { status: 422 })

  if (action === 'receive') {
    const quantity = int(body.quantity)
    const unitCost = money(body.unit_cost)
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'Quantity must be a whole number above zero.' }, { status: 422 })
    if (Number.isNaN(unitCost)) return NextResponse.json({ error: 'Cost must be a number, zero or more - or left blank if unknown.' }, { status: 422 })
    let locationId: string | null
    if (body.location_id) {
      const loc = await ownLocation(body.location_id)
      if (!loc) return NextResponse.json({ error: 'That location is not one of yours.' }, { status: 422 })
      locationId = loc.id
    } else {
      locationId = await defaultLocationId(createServiceClient(), userId)
    }
    if (!locationId) return NextResponse.json({ error: 'No stock location is available.' }, { status: 500 })
    const res = await receiveStock({
      userId, locationId, createdBy: userId,
      reference: text(body.reference, 60),
      lines: [{ partId, quantity, unitCost }],
    })
    if (res.errors.length) return NextResponse.json({ error: res.errors.join('; ') }, { status: 500 })
    return NextResponse.json({ ok: true, location_id: locationId, cost_changes: res.costChanges }, { status: 201 })
  }

  if (action === 'count') {
    const counted = int(body.counted)
    const loc = await ownLocation(body.location_id)
    if (counted === null || counted < 0) return NextResponse.json({ error: 'The count must be a whole number, zero or more.' }, { status: 422 })
    if (!loc) return NextResponse.json({ error: 'That location is not one of yours.' }, { status: 422 })
    const res = await adjustToCount({
      userId, locationId: loc.id, createdBy: userId,
      reason: text(body.note, 120),
      counts: [{ partId, counted }],
    })
    if (res.errors.length) return NextResponse.json({ error: res.errors.join('; ') }, { status: 500 })
    return NextResponse.json({ ok: true, adjustments: res.adjustments })
  }

  if (action === 'transfer') {
    const quantity = int(body.quantity)
    const from = await ownLocation(body.from_location_id)
    const to = await ownLocation(body.to_location_id)
    if (!quantity || quantity <= 0) return NextResponse.json({ error: 'Quantity must be a whole number above zero.' }, { status: 422 })
    if (!from || !to) return NextResponse.json({ error: 'Both locations must be yours.' }, { status: 422 })
    const res = await transferStock({
      userId, fromLocationId: from.id, toLocationId: to.id, createdBy: userId,
      note: text(body.note, 120),
      lines: [{ partId, quantity }],
    })
    if (res.errors.length) return NextResponse.json({ error: res.errors.join('; ') }, { status: 422 })
    return NextResponse.json({ ok: true, transfer_id: res.transferId })
  }

  if (action === 'settings') {
    const loc = await ownLocation(body.location_id)
    if (!loc) return NextResponse.json({ error: 'That location is not one of yours.' }, { status: 422 })
    // Three states for the minimum, as /api/parts/inventory documents: absent leaves it,
    // null clears it to "no minimum set", 0 means the shop deliberately stocks none.
    const patch: Record<string, unknown> = {}
    if ('bin' in body) patch.bin = text(body.bin, 30)
    if ('min_qty' in body) {
      const m = body.min_qty === null || String(body.min_qty).trim() === '' ? null : int(body.min_qty)
      if (m !== null && m < 0) return NextResponse.json({ error: 'The minimum must be zero or more.' }, { status: 422 })
      if (body.min_qty !== null && String(body.min_qty).trim() !== '' && m === null) {
        return NextResponse.json({ error: 'The minimum must be a whole number.' }, { status: 422 })
      }
      patch.min_qty = m
    }
    if ('sell_price' in body) {
      const s = money(body.sell_price)
      if (Number.isNaN(s)) return NextResponse.json({ error: 'Sell price must be a number, zero or more.' }, { status: 422 })
      patch.sell_price = s
    }
    if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 422 })

    const { data: existing } = await supabase.from('inventory').select('id')
      .eq('user_id', userId).eq('part_id', partId).eq('location_id', loc.id).maybeSingle()
    const { error } = existing
      ? await supabase.from('inventory').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', existing.id)
      // A part not yet stocked here gets its row with nothing on hand. on_hand 0 on an
      // INSERT is not a change to on_hand - 151's guard covers updates - and the first
      // receipt moves it from there through the ledger.
      : await supabase.from('inventory').insert({
          user_id: userId, part_id: partId, location_id: loc.id, on_hand: 0,
          // The same two legacy columns apply_stock_movement (151) fills on a first receipt.
          location_type: loc.kind, location_name: loc.name,
          ...patch,
        })
    if (error) return NextResponse.json({ error: error.message }, { status: 422 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 })
}
