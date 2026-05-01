import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { dispatchNotification } from '@/lib/notifications'

// ─── Inventory auto-deduct ────────────────────────────────────────────────────
// Runs fire-and-forget after a job is marked complete.
// Looks up service_products mappings for the job's services, decrements
// uses_remaining on each matched inventory product, logs the usage, and
// creates an expense entry for COGS attribution.
async function deductInventoryProducts(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job: Record<string, any>,
) {
  const services: string[] = Array.isArray(job.services) && job.services.length > 0
    ? job.services
    : (job.service_type ? [job.service_type] : [])

  if (services.length === 0) return

  const { data: mappings } = await supabase
    .from('service_products')
    .select('*, product:products_inventory(*)')
    .eq('user_id', userId)
    .in('service_name', services)

  if (!mappings || mappings.length === 0) return

  const today = new Date().toISOString().slice(0, 10)

  for (const m of mappings) {
    const product = m.product as { id: string; cost_cents: number; total_uses: number; uses_remaining: number } | null
    if (!product) continue

    const qty   = Number(m.quantity_used) || 1
    const newUses = Math.max(0, product.uses_remaining - qty)
    const cogsCents = product.total_uses > 0
      ? Math.round((product.cost_cents / product.total_uses) * qty)
      : 0

    // Decrement uses_remaining
    await supabase
      .from('products_inventory')
      .update({ uses_remaining: newUses, updated_at: new Date().toISOString() })
      .eq('id', product.id)
      .eq('user_id', userId)

    // Log the usage
    await supabase
      .from('product_usage_log')
      .insert({
        user_id:              userId,
        product_inventory_id: product.id,
        job_id:               jobId,
        service_name:         m.service_name,
        quantity_used:        qty,
        cost_cents_attributed: cogsCents,
      })

    // Add COGS expense entry
    if (cogsCents > 0) {
      await supabase
        .from('expenses')
        .insert({
          user_id:          userId,
          expense_date:     today,
          category:         'shop_supplies',
          description:      `${m.product.name} — ${m.service_name} (auto)`,
          amount:           cogsCents / 100,
          job_id:           jobId,
          transaction_type: 'auto_invoice',
        })
    }
  }
}

const JOB_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, color, license_plate)
`

type RouteContext = { params: Promise<{ id: string }> }

// ─── GET /api/jobs/[id] ───────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json({ job: data })
}

// ─── PUT /api/jobs/[id] ───────────────────────────────────────────────────────
export async function PUT(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Strip server-managed and relation fields before updating
  const {
    id: _id,
    user_id: _uid,
    created_at: _ca,
    updated_at: _ua,
    customer: _c,
    vehicle: _v,
    ...updateData
  } = body as Record<string, unknown>

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('jobs')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(JOB_SELECT)
    .single()

  if (error) {
    console.error('[PUT /api/jobs/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 })
  }

  // Auto-send job_completed notification when tech marks the job done
  if (updateData.status === 'completed' && data.customer_id) {
    dispatchNotification({
      trigger:  'job_completed',
      jobId:    id,
      supabase,
    }).catch((err) => console.error('[PUT /api/jobs/[id]] notification error:', err))
  }

  // Auto-deduct inventory products on job completion
  if (updateData.status === 'completed') {
    deductInventoryProducts(supabase, user.id, id, data).catch(
      (err) => console.error('[PUT /api/jobs/[id]] inventory deduct error:', err)
    )
  }

  return NextResponse.json({ job: data })
}

// ─── DELETE /api/jobs/[id] ────────────────────────────────────────────────────
// Soft-delete: sets status → 'cancelled', preserves the record for history
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('jobs')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status')
    .single()

  if (error) {
    console.error('[DELETE /api/jobs/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Job not found or access denied' }, { status: 404 })
  }

  return NextResponse.json({ success: true, job: data })
}
