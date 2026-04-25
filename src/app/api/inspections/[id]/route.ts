// GET /api/inspections/[id]  — fetch inspection with items
// PUT /api/inspections/[id]  — update items, status, labor_charge_applied

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: RouteContext,
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const { data: inspection, error } = await supabase
    .from('inspections')
    .select(`*, items:inspection_items(*)`)
    .eq('id', id)
    .eq('mechanic_id', user.id)
    .single()

  if (error || !inspection) {
    return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
  }

  if (Array.isArray(inspection.items)) {
    inspection.items.sort(
      (a: { point_number: number }, b: { point_number: number }) => a.point_number - b.point_number,
    )
  }

  return NextResponse.json({ inspection })
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

interface ItemUpdate {
  id:     string
  status: string
  notes?: string | null
}

export async function PUT(
  req: Request,
  { params }: RouteContext,
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  // Verify ownership
  const { data: existing } = await supabase
    .from('inspections')
    .select('id, status')
    .eq('id', id)
    .eq('mechanic_id', user.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })

  let body: {
    status?:               string
    labor_charge_applied?: boolean
    items?:                ItemUpdate[]
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const inspectionUpdate: Record<string, unknown> = {}

  if (body.status) {
    const valid = ['pending', 'in_progress', 'completed']
    if (!valid.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
    }
    inspectionUpdate.status = body.status
    if (body.status === 'completed') {
      inspectionUpdate.completed_at = new Date().toISOString()
    }
  }

  if (typeof body.labor_charge_applied === 'boolean') {
    inspectionUpdate.labor_charge_applied = body.labor_charge_applied
  }

  if (Object.keys(inspectionUpdate).length > 0) {
    const { error: upErr } = await supabase
      .from('inspections')
      .update(inspectionUpdate)
      .eq('id', id)
      .eq('mechanic_id', user.id)

    if (upErr) {
      console.error('[PUT /api/inspections/[id]]', upErr)
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }
  }

  // Batch update items if provided
  if (Array.isArray(body.items) && body.items.length > 0) {
    for (const item of body.items) {
      if (!item.id) continue
      const validStatuses = ['not_checked', 'pass', 'fail', 'needs_attention']
      if (item.status && !validStatuses.includes(item.status)) continue

      await supabase
        .from('inspection_items')
        .update({
          status: item.status,
          notes:  item.notes ?? null,
        })
        .eq('id', item.id)
        .eq('inspection_id', id)
    }
  }

  // Return updated inspection with items
  const { data: updated } = await supabase
    .from('inspections')
    .select(`*, items:inspection_items(*)`)
    .eq('id', id)
    .single()

  if (updated && Array.isArray(updated.items)) {
    updated.items.sort(
      (a: { point_number: number }, b: { point_number: number }) => a.point_number - b.point_number,
    )
  }

  return NextResponse.json({ inspection: updated })
}
