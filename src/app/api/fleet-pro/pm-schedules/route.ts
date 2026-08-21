import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember, requireFleetProManager } from '@/lib/fleet-pro/access'
import { pmStateFor, type PmScheduleRow } from '@/types/fleet-pro'

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

// ─── GET /api/fleet-pro/pm-schedules ─────────────────────────────────────────
// Every unit in the fleet, whether or not it has a schedule yet — a manager
// cannot add a schedule to a unit the list does not show. Units with no row come
// back as pm_state 'unscheduled' with an empty id.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })
  const { membership } = gate

  const svc = createServiceClient()

  const { data: units, error: unitsErr } = await svc
    .from('hd_units')
    .select('id, unit_number')
    .eq('fleet_account_id', membership.fleet_account_id)
    .order('unit_number', { ascending: true })

  if (unitsErr) {
    console.error('[fleet-pro/pm-schedules] unit load failed:', unitsErr.message)
    return NextResponse.json({ error: unitsErr.message }, { status: 500 })
  }

  const { data: schedules, error: schedErr } = await svc
    .from('fleet_pro_pm_schedules')
    .select('id, unit_id, interval_days, last_service_date, next_due_date, service_description')
    .eq('fleet_account_id', membership.fleet_account_id)

  if (schedErr) {
    console.error('[fleet-pro/pm-schedules] schedule load failed:', schedErr.message)
    return NextResponse.json({ error: schedErr.message }, { status: 500 })
  }

  const byUnit = new Map((schedules ?? []).map(s => [s.unit_id as string, s]))
  const today  = todayIso()

  const rows: PmScheduleRow[] = (units ?? []).map(u => {
    const s = byUnit.get(u.id as string)
    const nextDue = (s?.next_due_date as string | null) ?? null
    const { state, daysUntilDue } = pmStateFor(nextDue, today)
    return {
      id:                  (s?.id as string) ?? '',
      unit_id:             u.id as string,
      unit_number:         (u.unit_number as string) ?? '',
      interval_days:       (s?.interval_days as number) ?? 0,
      last_service_date:   (s?.last_service_date as string | null) ?? null,
      next_due_date:       nextDue,
      service_description: (s?.service_description as string | null) ?? null,
      pm_state:            state,
      days_until_due:      daysUntilDue,
    }
  })

  return NextResponse.json({
    schedules:  rows,
    role:       membership.role,
    fleet_name: membership.fleet_name,
  })
}

// ─── POST /api/fleet-pro/pm-schedules ────────────────────────────────────────
// Manager only. Upserts on unit_id — the unique index means one schedule per unit,
// so re-posting an existing unit is an edit, not a duplicate.
export async function POST(req: NextRequest) {
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

  const unitId = typeof body.unit_id === 'string' ? body.unit_id : ''
  if (!unitId) return NextResponse.json({ error: 'unit_id is required' }, { status: 400 })

  const intervalDays = Number(body.interval_days)
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > MAX_INTERVAL_DAYS) {
    return NextResponse.json(
      { error: `interval_days must be a whole number between 1 and ${MAX_INTERVAL_DAYS}` },
      { status: 400 },
    )
  }

  const lastServiceDate = body.last_service_date == null || body.last_service_date === ''
    ? null
    : body.last_service_date
  if (lastServiceDate !== null && !isIsoDate(lastServiceDate)) {
    return NextResponse.json({ error: 'last_service_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const description = typeof body.service_description === 'string' && body.service_description.trim()
    ? body.service_description.trim().slice(0, 500)
    : null

  const svc = createServiceClient()

  // The unit must belong to THIS fleet. Checked before the insert, never taken
  // from the request body — a manager may not attach a schedule to someone
  // else's equipment by guessing a uuid.
  const { data: unit } = await svc
    .from('hd_units')
    .select('id')
    .eq('id', unitId)
    .eq('fleet_account_id', membership.fleet_account_id)
    .maybeSingle()

  if (!unit) return NextResponse.json({ error: 'Unit not found in this fleet' }, { status: 404 })

  const nextDueDate = addDays(lastServiceDate ?? todayIso(), intervalDays)
  const now = new Date().toISOString()

  const { data, error } = await svc
    .from('fleet_pro_pm_schedules')
    .upsert({
      fleet_account_id:    membership.fleet_account_id,
      unit_id:             unitId,
      interval_days:       intervalDays,
      last_service_date:   lastServiceDate,
      next_due_date:       nextDueDate,
      service_description: description,
      // A new due date deserves a fresh alert.
      alert_sent_at:       null,
      alert_sent_for:      null,
      created_by:          user?.id ?? null,
      updated_at:          now,
    }, { onConflict: 'unit_id' })
    .select('id, unit_id, interval_days, last_service_date, next_due_date, service_description')
    .single()

  if (error) {
    console.error('[fleet-pro/pm-schedules] upsert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ schedule: data }, { status: 201 })
}
