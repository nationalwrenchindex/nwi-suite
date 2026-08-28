import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_WORK_ORDER_LINES,
  normalizeLine,
  sumLines,
  type WorkOrderLineInput,
} from '@/lib/hd/work-order-lines'

export const dynamic = 'force-dynamic'

// Line items on an HD work order (migration 120).
//
// RLS already scopes these rows to the owner of the parent work order, but every
// handler re-checks ownership explicitly so a missing row and someone else's row
// both answer 404 — a 403 would confirm the id exists.

// Either half is spelled with the other key optional-undefined so `if (gate.error)`
// narrows to the client in the success branch without a cast.
type Gate =
  | { error: NextResponse; supabase?: undefined }
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>> }

// Shared ownership gate. Returns an authed client scoped to the caller, or a
// response to hand straight back.
async function requireOwnedWorkOrder(workOrderId: string): Promise<Gate> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: wo } = await supabase
    .from('hd_work_orders')
    .select('id')
    .eq('id', workOrderId)
    .eq('user_id', user.id)
    .single()
  if (!wo) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }

  return { supabase }
}

const SELECT = 'id, work_order_id, type, description, part_number, quantity, unit_cost, unit_price, markup_percent, total, sort_order'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const gate = await requireOwnedWorkOrder(workOrderId)
  if (gate.error) return gate.error

  const { data, error } = await gate.supabase
    .from('hd_work_order_line_items')
    .select(SELECT)
    .eq('work_order_id', workOrderId)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[hd/work-orders/line-items GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const lines = data ?? []
  return NextResponse.json({ line_items: lines, totals: sumLines(lines) })
}

// PUT replaces the whole set rather than patching rows.
//
// The editor is a spreadsheet-style card where the tech reorders and deletes rows
// freely, so a per-row diff would need the client to track which ids it removed and
// send three request kinds. Replacing the set makes the sent array the truth, which
// is also what makes reordering work at all — sort_order is positional.
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: workOrderId } = await params
  const gate = await requireOwnedWorkOrder(workOrderId)
  if (gate.error) return gate.error
  const supabase = gate.supabase

  let body: { line_items?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const raw = body.line_items
  if (!Array.isArray(raw)) return NextResponse.json({ error: 'line_items array required' }, { status: 400 })
  if (raw.length > MAX_WORK_ORDER_LINES) {
    return NextResponse.json({ error: `Too many line items (max ${MAX_WORK_ORDER_LINES})` }, { status: 400 })
  }

  // Position in the sent array IS the sort order, so the tech's arrangement survives
  // the round trip without the client inventing index numbers.
  const rows = []
  for (let i = 0; i < raw.length; i++) {
    const line = normalizeLine(raw[i] as WorkOrderLineInput, i)
    // A row with no usable type is a client bug, not something to silently drop —
    // dropping it would lose a billable line without telling anyone.
    if (!line) return NextResponse.json({ error: `Line ${i + 1}: type must be "labor" or "part"` }, { status: 400 })
    rows.push({ ...line, work_order_id: workOrderId })
  }

  // Delete-then-insert. Supabase's REST client has no multi-statement transaction, so
  // the window between the two is real: a failed insert leaves the set empty. The
  // insert is checked and reported rather than swallowed so the tech re-saves from a
  // form that still holds their rows, instead of discovering the loss later.
  const { error: delError } = await supabase
    .from('hd_work_order_line_items')
    .delete()
    .eq('work_order_id', workOrderId)

  if (delError) {
    console.error('[hd/work-orders/line-items PUT delete]', delError)
    return NextResponse.json({ error: delError.message }, { status: 500 })
  }

  if (rows.length === 0) return NextResponse.json({ line_items: [], totals: sumLines([]) })

  const { data, error } = await supabase
    .from('hd_work_order_line_items')
    .insert(rows)
    .select(SELECT)
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('[hd/work-orders/line-items PUT insert]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const lines = data ?? []
  return NextResponse.json({ line_items: lines, totals: sumLines(lines) })
}
