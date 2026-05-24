import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'

const VALID_TRANSITIONS: Record<string, string[]> = {
  open:        ['on_the_way', 'in_progress', 'cancelled'],
  on_the_way:  ['in_progress', 'open', 'cancelled'],
  in_progress: ['completed', 'open', 'cancelled'],
  completed:   ['invoiced'],
  invoiced:    [],
  cancelled:   ['open'],
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { id } = await params

  let body: { status?: string; labor_minutes?: number }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const { status: newStatus, labor_minutes } = body
  if (!newStatus) return NextResponse.json({ error: 'status required' }, { status: 400 })

  const svc = createServiceClient()

  const { data: wo } = await svc
    .from('hd_work_orders')
    .select('id, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const allowed = VALID_TRANSITIONS[wo.status] ?? []
  if (!allowed.includes(newStatus)) {
    return NextResponse.json({ error: `Cannot transition from ${wo.status} to ${newStatus}` }, { status: 422 })
  }

  const updates: Record<string, unknown> = { status: newStatus }
  if (newStatus === 'on_the_way')  updates.on_the_way_at  = new Date().toISOString()
  if (newStatus === 'in_progress') updates.arrived_at     = new Date().toISOString()
  if (newStatus === 'completed') {
    updates.completed_at = new Date().toISOString()
    if (labor_minutes !== undefined) updates.labor_minutes = labor_minutes
  }

  const { data: updated, error } = await svc
    .from('hd_work_orders')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status')
    .single()

  if (error) {
    console.error('[work-orders/status]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
}
