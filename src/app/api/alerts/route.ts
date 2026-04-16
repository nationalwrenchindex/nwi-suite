import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ServiceAlert, AlertStatus } from '@/types/intel'

// ─── GET /api/alerts ──────────────────────────────────────────────────────────
// Returns all vehicles belonging to the user's customers, each annotated with
// an alert_status calculated from their service history.
//
// Alert rules:
//   overdue   — next_service_date < today  OR  vehicle.mileage >= next_service_mileage
//   due_soon  — next_service_date within 30 days  OR  vehicle.mileage >= next_service_mileage - 500
//   up_to_date— next_service_date exists but not due yet
//   no_history — vehicle has never been serviced
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Step 1: get all customer IDs for this user
  const { data: customers, error: custErr } = await supabase
    .from('customers')
    .select('id, first_name, last_name, phone, email')
    .eq('user_id', user.id)

  if (custErr) {
    console.error('[GET /api/alerts] customers:', custErr)
    return NextResponse.json({ error: custErr.message }, { status: 500 })
  }
  if (!customers || customers.length === 0) {
    return NextResponse.json({ alerts: [] })
  }

  const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]))
  const customerIds = customers.map((c) => c.id)

  // Step 2: get all vehicles with their service history
  const { data: vehicles, error: vErr } = await supabase
    .from('vehicles')
    .select(`
      id, customer_id, year, make, model, trim, vin, color, mileage,
      license_plate, engine, transmission, notes, created_at, updated_at,
      service_history(
        service_date, service_type, mileage_at_service,
        next_service_date, next_service_mileage
      )
    `)
    .in('customer_id', customerIds)
    .order('make', { ascending: true })

  if (vErr) {
    console.error('[GET /api/alerts] vehicles:', vErr)
    return NextResponse.json({ error: vErr.message }, { status: 500 })
  }

  const today     = new Date()
  today.setHours(0, 0, 0, 0)
  const alerts: ServiceAlert[] = []

  for (const v of vehicles ?? []) {
    const history = ((v.service_history ?? []) as {
      service_date: string
      service_type: string
      mileage_at_service: number | null
      next_service_date: string | null
      next_service_mileage: number | null
    }[]).sort(
      (a, b) => new Date(b.service_date).getTime() - new Date(a.service_date).getTime(),
    )

    const latest = history[0] ?? null
    const currentMileage = v.mileage ?? null

    let alert_status: AlertStatus = 'no_history'
    let days_overdue: number | null = null
    let days_until_due: number | null = null

    if (latest) {
      const nextDate     = latest.next_service_date
        ? new Date(latest.next_service_date + 'T00:00:00')
        : null
      const nextMileage  = latest.next_service_mileage ?? null
      const diffDays     = nextDate
        ? Math.round((nextDate.getTime() - today.getTime()) / 86_400_000)
        : null

      // Mileage-based overdue
      const mileageOverdue =
        nextMileage !== null && currentMileage !== null && currentMileage >= nextMileage
      const mileageDueSoon =
        nextMileage !== null && currentMileage !== null && currentMileage >= nextMileage - 500

      if (diffDays !== null && diffDays < 0) {
        alert_status = 'overdue'
        days_overdue = -diffDays
      } else if (mileageOverdue) {
        alert_status = 'overdue'
      } else if (diffDays !== null && diffDays <= 30) {
        alert_status = 'due_soon'
        days_until_due = diffDays
      } else if (mileageDueSoon) {
        alert_status = 'due_soon'
      } else if (nextDate || nextMileage) {
        alert_status = 'up_to_date'
        if (diffDays !== null) days_until_due = diffDays
      } else {
        // No future service scheduled — flag if last service > 90 days ago
        const lastDate = new Date(latest.service_date + 'T00:00:00')
        const daysSince = Math.round((today.getTime() - lastDate.getTime()) / 86_400_000)
        alert_status = daysSince > 90 ? 'due_soon' : 'up_to_date'
      }
    }

    const customer = customerMap[v.customer_id]
    if (!customer) continue

    alerts.push({
      vehicle: {
        id:            v.id,
        customer_id:   v.customer_id,
        year:          v.year,
        make:          v.make,
        model:         v.model,
        trim:          v.trim,
        vin:           v.vin,
        color:         v.color,
        mileage:       v.mileage,
        license_plate: v.license_plate,
        engine:        v.engine,
        transmission:  v.transmission,
        notes:         v.notes,
        created_at:    v.created_at,
        updated_at:    v.updated_at,
      },
      customer: {
        id:         customer.id,
        first_name: customer.first_name,
        last_name:  customer.last_name,
        phone:      customer.phone,
        email:      customer.email,
      },
      last_service: latest
        ? {
            service_date:       latest.service_date,
            service_type:       latest.service_type,
            mileage_at_service: latest.mileage_at_service,
          }
        : null,
      next_service_date:    latest?.next_service_date    ?? null,
      next_service_mileage: latest?.next_service_mileage ?? null,
      alert_status,
      days_overdue,
      days_until_due,
    })
  }

  // Sort: overdue → due_soon → no_history → up_to_date
  const ORDER: Record<AlertStatus, number> = {
    overdue: 0, due_soon: 1, no_history: 2, up_to_date: 3,
  }
  alerts.sort((a, b) => ORDER[a.alert_status] - ORDER[b.alert_status])

  return NextResponse.json({ alerts })
}
