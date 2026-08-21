import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendPmDueEmail, type PmDueUnit } from '@/lib/fleet-pro/pm-alert-email'
import { pmStateFor } from '@/types/fleet-pro'

export const dynamic = 'force-dynamic'

const LIVE_FLEET_STATUSES = ['active', 'trialing', 'past_due']
const WARNING_WINDOW_DAYS = 30

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

interface ScheduleJoin {
  id:               string
  fleet_account_id: string
  next_due_date:    string | null
  alert_sent_for:   string | null
  hd_units:         { unit_number: string | null } | null
  hd_fleet_accounts:{ fleet_name: string | null } | null
}

// ─── GET /api/cron/fleet-pro-pm-alerts ───────────────────────────────────────
// Runs daily at 13:00 UTC (see vercel.json). Emails each fleet ONE digest listing
// every unit due within 30 days or already overdue. Gated by CRON_SECRET.
export async function GET(request: NextRequest) {
  const incomingSecret =
    request.headers.get('x-cron-secret') ??
    request.headers.get('authorization')?.replace('Bearer ', '')

  const expected = process.env.CRON_SECRET
  if (expected && incomingSecret !== expected) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const supabase = createServiceClient()
  const today    = todayIso()
  const horizon  = addDays(today, WARNING_WINDOW_DAYS)

  // 1. Schedules inside the window (overdue included — lte, no lower bound), on
  //    fleets whose Fleet Pro subscription is still live.
  const { data: rows, error } = await supabase
    .from('fleet_pro_pm_schedules')
    .select(`
      id, fleet_account_id, next_due_date, alert_sent_for,
      hd_units!inner ( unit_number ),
      hd_fleet_accounts!inner ( fleet_name, fleet_pro_enabled, fleet_pro_status )
    `)
    .not('next_due_date', 'is', null)
    .lte('next_due_date', horizon)
    .eq('hd_fleet_accounts.fleet_pro_enabled', true)
    .in('hd_fleet_accounts.fleet_pro_status', LIVE_FLEET_STATUSES)

  if (error) {
    console.error('[fleet-pro-pm-alerts] schedule load failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const candidates = (rows ?? []) as unknown as ScheduleJoin[]

  // 2. DEDUPE. Only alert when this exact due date has not already been alerted
  //    for. Without this a unit sitting 25 days out is emailed every morning for
  //    a month. The stamp is cleared whenever next_due_date moves (see PATCH).
  const due = candidates.filter(r => r.next_due_date && r.alert_sent_for !== r.next_due_date)

  if (due.length === 0) {
    console.log('[fleet-pro-pm-alerts] nothing to send')
    return NextResponse.json({ fleets: 0, units: 0, emailsSent: 0 })
  }

  // 3. One digest per fleet, not one email per unit.
  const byFleet = new Map<string, { fleetName: string; ids: string[]; units: PmDueUnit[]; dueDates: Map<string, string> }>()
  for (const r of due) {
    const key = r.fleet_account_id
    let group = byFleet.get(key)
    if (!group) {
      group = {
        fleetName: r.hd_fleet_accounts?.fleet_name ?? 'Your Fleet',
        ids:       [],
        units:     [],
        dueDates:  new Map(),
      }
      byFleet.set(key, group)
    }
    const { daysUntilDue } = pmStateFor(r.next_due_date, today)
    group.ids.push(r.id)
    group.dueDates.set(r.id, r.next_due_date as string)
    group.units.push({
      unit_number:    r.hd_units?.unit_number ?? 'Unit',
      next_due_date:  r.next_due_date,
      days_until_due: daysUntilDue,
    })
  }

  let emailsSent = 0
  let unitsStamped = 0

  for (const [fleetAccountId, group] of byFleet) {
    // 4. Recipients: active managers and supervisors. Read-only viewers do not
    //    get operational alerts.
    const { data: members, error: memberErr } = await supabase
      .from('fleet_pro_members')
      .select('email')
      .eq('fleet_account_id', fleetAccountId)
      .eq('status', 'active')
      .in('role', ['manager', 'supervisor'])

    if (memberErr) {
      console.error(`[fleet-pro-pm-alerts] member load failed for ${fleetAccountId}:`, memberErr.message)
      continue
    }

    const to = [...new Set((members ?? [])
      .map(m => (m.email as string | null)?.trim().toLowerCase())
      .filter((e): e is string => !!e))]

    if (to.length === 0) {
      // No one to tell. Leave the stamps alone so it sends once someone is seated.
      console.warn(`[fleet-pro-pm-alerts] no recipients for fleet ${fleetAccountId}`)
      continue
    }

    const result = await sendPmDueEmail({ to, fleetName: group.fleetName, units: group.units })
    if (!result.success) {
      console.error(`[fleet-pro-pm-alerts] send failed for ${fleetAccountId}: ${result.error}`)
      continue  // no stamp — retry tomorrow
    }
    emailsSent++

    // 5. Stamp only what was actually reported, and stamp the due date it was
    //    reported FOR, so a later change to that date re-arms the alert.
    const now = new Date().toISOString()
    for (const scheduleId of group.ids) {
      const { error: stampErr } = await supabase
        .from('fleet_pro_pm_schedules')
        .update({
          alert_sent_at:  now,
          alert_sent_for: group.dueDates.get(scheduleId),
          updated_at:     now,
        })
        .eq('id', scheduleId)
        .eq('fleet_account_id', fleetAccountId)

      if (stampErr) console.error(`[fleet-pro-pm-alerts] stamp failed for ${scheduleId}:`, stampErr.message)
      else unitsStamped++
    }
  }

  console.log(`[fleet-pro-pm-alerts] done: fleets=${byFleet.size} units=${due.length} emailsSent=${emailsSent} stamped=${unitsStamped}`)
  return NextResponse.json({ fleets: byFleet.size, units: due.length, emailsSent, stamped: unitsStamped })
}
