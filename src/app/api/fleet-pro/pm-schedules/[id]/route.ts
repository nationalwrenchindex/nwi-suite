import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProManager } from '@/lib/fleet-pro/access'

export const dynamic = 'force-dynamic'

const MAX_INTERVAL_DAYS = 3650  // matches the CHECK constraint in migration 105

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Date-only arithmetic at noon UTC so a DST shift can never move the day. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function isIsoDate(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(`${v}T12:00:00Z`))
}

// ─── PATCH /api/fleet-pro/pm-schedules/[id] ──────────────────────────────────
// Manager only, scoped to the caller's fleet on both the read and the write.
// When the interval or the last service date moves, next_due_date is recomputed
// and the dedupe stamps are cleared so the new date is allowed to alert.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const svc = createServiceClient()

  const { data: existing } = await svc
    .from('fleet_pro_pm_schedules')
    .select('id, interval_days, last_service_date, next_due_date')
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

  let intervalDays  = existing.interval_days as number
  let lastService   = (existing.last_service_date as string | null) ?? null
  let recompute     = false

  if ('interval_days' in body) {
    const n = Number(body.interval_days)
    if (!Number.isInteger(n) || n < 1 || n > MAX_INTERVAL_DAYS) {
      return NextResponse.json(
        { error: `interval_days must be a whole number between 1 and ${MAX_INTERVAL_DAYS}` },
        { status: 400 },
      )
    }
    if (n !== intervalDays) recompute = true
    intervalDays = n
    update.interval_days = n
  }

  if ('last_service_date' in body) {
    const raw = body.last_service_date
    const next = raw == null || raw === '' ? null : raw
    if (next !== null && !isIsoDate(next)) {
      return NextResponse.json({ error: 'last_service_date must be YYYY-MM-DD' }, { status: 400 })
    }
    if (next !== lastService) recompute = true
    lastService = next as string | null
    update.last_service_date = next
  }

  if ('service_description' in body) {
    const raw = body.service_description
    update.service_description = typeof raw === 'string' && raw.trim()
      ? raw.trim().slice(0, 500)
      : null
  }

  if (recompute) {
    update.next_due_date  = addDays(lastService ?? todayIso(), intervalDays)
    // Clear the dedupe stamps — the unit has a new due date and must be
    // eligible for a fresh 30-day warning.
    update.alert_sent_at  = null
    update.alert_sent_for = null
  }

  const { data, error } = await svc
    .from('fleet_pro_pm_schedules')
    .update(update)
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select('id, unit_id, interval_days, last_service_date, next_due_date, service_description')
    .single()

  if (error) {
    console.error('[fleet-pro/pm-schedules] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ schedule: data })
}

// ─── DELETE /api/fleet-pro/pm-schedules/[id] ─────────────────────────────────
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProManager(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()

  const { data, error } = await svc
    .from('fleet_pro_pm_schedules')
    .delete()
    .eq('id', id)
    .eq('fleet_account_id', membership.fleet_account_id)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[fleet-pro/pm-schedules] delete failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })

  return NextResponse.json({ success: true })
}
