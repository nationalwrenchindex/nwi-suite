import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  // Fetch completed jobs with labor data this month
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('service_type, arrived_at, departed_at, actual_labor_minutes, suggested_labor_minutes, estimated_duration_minutes, labor_rate, drive_minutes')
    .eq('user_id', user.id)
    .eq('status', 'completed')
    .not('arrived_at', 'is', null)
    .not('departed_at', 'is', null)
    .gte('arrived_at', monthStart.toISOString())
    .order('arrived_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = jobs ?? []

  if (rows.length === 0) {
    return NextResponse.json({
      efficiency_score:         null,
      monthly_variance_minutes: 0,
      monthly_variance_dollars: 0,
      total_jobs:               0,
      best_service_types:       [],
      worst_service_types:      [],
      weekly_trend:             [],
      total_drive_minutes:      0,
      avg_drive_minutes:        null,
      drive_jobs_count:         0,
    })
  }

  // Per-row quoted time: prefer suggested_labor_minutes, fall back to estimated_duration_minutes
  function quotedMins(row: typeof rows[0]): number | null {
    return row.suggested_labor_minutes ?? row.estimated_duration_minutes ?? null
  }

  // Monthly totals
  let totalActual   = 0
  let totalQuoted   = 0
  let totalVarDollars = 0
  let ratedJobs     = 0

  for (const r of rows) {
    if (!r.actual_labor_minutes) continue
    totalActual += r.actual_labor_minutes
    const q = quotedMins(r)
    if (q != null) {
      totalQuoted += q
      const varMins = q - r.actual_labor_minutes  // positive = faster (good)
      if (r.labor_rate) {
        totalVarDollars += (varMins / 60) * r.labor_rate
        ratedJobs++
      }
    }
  }

  const efficiency_score    = totalActual > 0 && totalQuoted > 0
    ? Math.round((totalQuoted / totalActual) * 100)
    : null
  const monthly_variance_minutes = totalQuoted - totalActual
  const monthly_variance_dollars = ratedJobs > 0 ? Math.round(totalVarDollars) : null

  // Group by service type
  type ServiceBucket = { actual: number; quoted: number; varDollars: number; count: number }
  const byService: Record<string, ServiceBucket> = {}

  for (const r of rows) {
    if (!r.actual_labor_minutes || !r.service_type) continue
    const q = quotedMins(r)
    if (q == null) continue
    const bucket = byService[r.service_type] ??= { actual: 0, quoted: 0, varDollars: 0, count: 0 }
    bucket.actual  += r.actual_labor_minutes
    bucket.quoted  += q
    bucket.count   += 1
    if (r.labor_rate) {
      bucket.varDollars += ((q - r.actual_labor_minutes) / 60) * r.labor_rate
    }
  }

  const serviceEntries = Object.entries(byService).map(([service_type, b]) => ({
    service_type,
    avg_variance_minutes: Math.round((b.quoted - b.actual) / b.count),
    job_count: b.count,
  }))

  serviceEntries.sort((a, b) => b.avg_variance_minutes - a.avg_variance_minutes)
  const best_service_types  = serviceEntries.slice(0, 3)
  const worst_service_types = [...serviceEntries].reverse().slice(0, 3)

  // Weekly trend (last 6 weeks)
  const weekBuckets: Record<string, { actual: number; quoted: number }> = {}
  for (const r of rows) {
    if (!r.actual_labor_minutes || !r.arrived_at) continue
    const q = quotedMins(r)
    if (q == null) continue
    const d    = new Date(r.arrived_at)
    const day  = d.getDay()
    const mon  = new Date(d)
    mon.setDate(d.getDate() - ((day === 0 ? 7 : day) - 1))
    const key  = mon.toISOString().slice(0, 10)
    const b    = weekBuckets[key] ??= { actual: 0, quoted: 0 }
    b.actual  += r.actual_labor_minutes
    b.quoted  += q
  }

  const weekly_trend = Object.entries(weekBuckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .map(([week, b]) => ({
      week,
      efficiency: b.actual > 0 ? Math.round((b.quoted / b.actual) * 100) : null,
    }))

  // Drive time metrics
  const driveRows          = rows.filter(r => r.drive_minutes != null)
  const total_drive_minutes = driveRows.reduce((sum, r) => sum + (r.drive_minutes ?? 0), 0)
  const avg_drive_minutes   = driveRows.length > 0
    ? Math.round(total_drive_minutes / driveRows.length)
    : null
  const drive_jobs_count    = driveRows.length

  return NextResponse.json({
    efficiency_score,
    monthly_variance_minutes,
    monthly_variance_dollars,
    total_jobs:         rows.length,
    best_service_types,
    worst_service_types,
    weekly_trend,
    total_drive_minutes,
    avg_drive_minutes,
    drive_jobs_count,
  })
}
