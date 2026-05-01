import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { dispatchNotification, notifyMechanic } from '@/lib/notifications'
import { getServicesByBusinessType } from '@/lib/scheduler'
import { INSPECTION_POINTS, getMappedService } from '@/lib/mpi-catalog'

type RouteContext = { params: Promise<{ slug: string }> }

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Configurable defaults — can be moved to a per-tech profile field later
const DEFAULT_TIMEZONE       = 'America/New_York'
const BOOKING_BUFFER_MINUTES = 120 // 2-hour same-day lead time

interface DayHours { enabled: boolean; open: string; close: string }
type WorkingHours = Record<string, DayHours>

// Generate 60-min slots between open and close times (e.g. "08:00" → "17:00")
function generateSlots(open: string, close: string): string[] {
  const [oh, om] = open.split(':').map(Number)
  const [ch, cm] = close.split(':').map(Number)
  const openMin  = oh * 60 + om
  const closeMin = ch * 60 + cm
  const slots: string[] = []
  for (let m = openMin; m + 60 <= closeMin; m += 60) {
    slots.push(
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
    )
  }
  return slots
}

// Returns today's date string (YYYY-MM-DD) and current minutes-since-midnight in the given timezone
function getTechNow(tz: string): { dateStr: string; nowMin: number } {
  const now   = new Date()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)

  const get  = (type: string) => parts.find(p => p.type === type)?.value ?? '0'
  const hour = Number(get('hour'))
  const min  = Number(get('minute'))

  return {
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
    nowMin:  hour * 60 + min,
  }
}

// ─── GET /api/book/[slug] ─────────────────────────────────────────────────────
// Without ?date → profile + available services
// With    ?date → available + unavailable time slots for that date
export async function GET(request: NextRequest, { params }: RouteContext) {
  const { slug } = await params
  const supabase  = createServiceClient()

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, business_name, full_name, profession_type, service_area_description, working_hours, offer_mpi_on_booking, business_type')
    .eq('slug', slug)
    .single()

  if (error || !profile) {
    return NextResponse.json({ error: 'Technician not found' }, { status: 404 })
  }

  const date = request.nextUrl.searchParams.get('date')

  // ── Return available + unavailable slots for a specific date ──
  if (date) {
    const wh = (profile.working_hours ?? {}) as WorkingHours
    const dayName = DAY_NAMES[new Date(date + 'T00:00:00').getDay()]
    const daySchedule = wh[dayName]

    if (!daySchedule?.enabled) {
      return NextResponse.json({ slots: [], unavailable: [] })
    }

    const allSlots = generateSlots(daySchedule.open, daySchedule.close)

    // Fetch already-booked jobs for this date
    const { data: bookedJobs } = await supabase
      .from('jobs')
      .select('job_time, estimated_duration_minutes')
      .eq('user_id', profile.id)
      .eq('job_date', date)
      .neq('status', 'cancelled')
      .neq('status', 'no_show')

    // Build set of minute-marks blocked by existing bookings
    const blocked = new Set<number>()
    for (const job of bookedJobs ?? []) {
      if (!job.job_time) continue
      const [h, m] = (job.job_time as string).slice(0, 5).split(':').map(Number)
      const startMin = h * 60 + m
      const duration = (job.estimated_duration_minutes as number | null) ?? 60
      for (let offset = 0; offset < duration; offset += 60) {
        blocked.add(startMin + offset)
      }
    }

    // Cutoff = now + buffer (only applies when date === today in tech's timezone)
    const { dateStr: todayStr, nowMin } = getTechNow(DEFAULT_TIMEZONE)
    const cutoffMin = nowMin + BOOKING_BUFFER_MINUTES

    const available: string[]   = []
    const unavailable: string[] = []

    for (const slot of allSlots) {
      const [h, m] = slot.split(':').map(Number)
      const slotMin = h * 60 + m

      if (blocked.has(slotMin)) {
        // Booked by an existing customer — hide entirely (privacy)
        continue
      } else if (date === todayStr && slotMin < cutoffMin) {
        // Past or within the same-day lead-time buffer — show greyed
        unavailable.push(slot)
      } else {
        available.push(slot)
      }
    }

    return NextResponse.json({ slots: available, unavailable })
  }

  // ── Return public profile + service list ──
  return NextResponse.json({
    profile: {
      business_name:            profile.business_name,
      full_name:                profile.full_name,
      profession_type:          profile.profession_type,
      service_area_description: profile.service_area_description,
      working_hours:            profile.working_hours,
    },
    services:         [...getServicesByBusinessType((profile as Record<string, unknown>).business_type as string ?? 'mechanic')],
    offerMpi:         !!(profile as Record<string, unknown>).offer_mpi_on_booking,
  })
}

// ─── POST /api/book/[slug] ────────────────────────────────────────────────────
// Public booking submission — creates customer + vehicle + job, fires confirmation
export async function POST(request: NextRequest, { params }: RouteContext) {
  const { slug } = await params
  const supabase  = createServiceClient()

  // Look up tech (include MPI fields for inspection handling)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, phone, offer_mpi_on_booking')
    .eq('slug', slug)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Technician not found' }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  const { service_type, job_date, job_time, notes, estimated_duration_minutes } = body
  const customer = body.customer as Record<string, unknown> | undefined
  const vehicle  = body.vehicle  as Record<string, unknown> | undefined

  if (!service_type || typeof service_type !== 'string')
    return NextResponse.json({ error: 'service_type is required' }, { status: 400 })
  if (!job_date || typeof job_date !== 'string')
    return NextResponse.json({ error: 'job_date is required' }, { status: 400 })
  if (!job_time || typeof job_time !== 'string')
    return NextResponse.json({ error: 'job_time is required' }, { status: 400 })
  if (!customer?.first_name || !customer?.last_name)
    return NextResponse.json({ error: 'customer first_name and last_name are required' }, { status: 400 })

  const smsConsent = body.sms_consent === true
  // Phone is required only when customer opted into SMS
  if (smsConsent && !customer?.phone)
    return NextResponse.json({ error: 'phone is required when SMS consent is given' }, { status: 400 })

  // Server-side time validation — reject past slots and same-day slots inside the buffer
  const { dateStr: todayStr, nowMin } = getTechNow(DEFAULT_TIMEZONE)
  const cutoffMin = nowMin + BOOKING_BUFFER_MINUTES
  const [jh, jm]  = job_time.slice(0, 5).split(':').map(Number)
  const jobSlotMin = jh * 60 + jm

  if (
    job_date < todayStr ||
    (job_date === todayStr && jobSlotMin < cutoffMin)
  ) {
    return NextResponse.json(
      { error: 'This time slot is no longer available. Please select a future time.' },
      { status: 400 },
    )
  }

  const techId = profile.id as string

  // ── Find or create customer ──
  const rawPhone = customer.phone ? String(customer.phone).trim() : ''
  const digits   = rawPhone.replace(/\D/g, '')
  let customerId: string

  if (digits.length >= 10) {
    // Try to match an existing customer by phone
    const { data: existingCustomers } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', techId)
      .ilike('phone', `%${digits.slice(-10)}%`)
      .limit(1)

    if (existingCustomers && existingCustomers.length > 0) {
      customerId = existingCustomers[0].id as string
    } else {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({
          user_id:    techId,
          first_name: String(customer.first_name),
          last_name:  String(customer.last_name),
          phone:      rawPhone,
          email:      customer.email ? String(customer.email) : null,
        })
        .select('id')
        .single()
      if (custErr || !newCustomer) {
        console.error('[POST /api/book] customer insert error:', custErr)
        return NextResponse.json({ error: 'Failed to create customer record' }, { status: 500 })
      }
      customerId = newCustomer.id as string
    }
  } else {
    // No phone provided — create customer without one
    const { data: newCustomer, error: custErr } = await supabase
      .from('customers')
      .insert({
        user_id:    techId,
        first_name: String(customer.first_name),
        last_name:  String(customer.last_name),
        phone:      null,
        email:      customer.email ? String(customer.email) : null,
      })
      .select('id')
      .single()
    if (custErr || !newCustomer) {
      console.error('[POST /api/book] customer insert error:', custErr)
      return NextResponse.json({ error: 'Failed to create customer record' }, { status: 500 })
    }
    customerId = newCustomer.id as string
  }

  // ── Create vehicle (if provided) ──
  let vehicleId: string | null = null
  if (vehicle?.make && vehicle?.model) {
    const { data: newVehicle } = await supabase
      .from('vehicles')
      .insert({
        customer_id: customerId,
        year:        vehicle.year  ? Number(vehicle.year)  : null,
        make:        String(vehicle.make),
        model:       String(vehicle.model),
      })
      .select('id')
      .single()
    vehicleId = newVehicle?.id ?? null
  }

  const wantsInspection =
    body.inspection_requested === true &&
    !!(profile as Record<string, unknown>).offer_mpi_on_booking

  const vehicleCategory = typeof body.vehicle_category === 'string' ? body.vehicle_category : null
  const photos          = Array.isArray(body.photos) ? (body.photos as string[]).filter(u => typeof u === 'string') : []

  // ── Create job ──
  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .insert({
      user_id:                    techId,
      customer_id:                customerId,
      vehicle_id:                 vehicleId,
      job_date:                   job_date,
      job_time:                   job_time,
      service_type:               service_type,
      status:                     'scheduled',
      estimated_duration_minutes: estimated_duration_minutes ? Number(estimated_duration_minutes) : null,
      notes:                      notes ? String(notes) : null,
      inspection_requested:       wantsInspection,
      sms_consent:                smsConsent,
      vehicle_category:           vehicleCategory,
      photos:                     photos,
    })
    .select('id, job_date, job_time, service_type')
    .single()

  if (jobErr || !job) {
    console.error('[POST /api/book] job insert error:', jobErr)
    return NextResponse.json({ error: 'Failed to create booking' }, { status: 500 })
  }

  const jobId = job.id as string

  // ── Create inspection record + seed 25 items ──
  if (wantsInspection) {
    try {
      const { data: inspection } = await supabase
        .from('inspections')
        .insert({
          job_id:                jobId,
          mechanic_id:           techId,
          customer_id:           customerId,
          status:                'pending',
          requested_by_customer: true,
          labor_charge_applied:  true,
        })
        .select('id')
        .single()

      if (inspection?.id) {
        const items = INSPECTION_POINTS.map((pt) => {
          const mapped = getMappedService(pt.point_name)
          return {
            inspection_id:       inspection.id as string,
            point_number:        pt.point_number,
            point_name:          pt.point_name,
            category:            pt.category,
            status:              'not_checked',
            mapped_service_name: mapped?.name ?? null,
          }
        })
        await supabase.from('inspection_items').insert(items)
      }

      // Notify mechanic of inspection request
      const p = profile as Record<string, unknown>
      const customerObj = customer as Record<string, unknown>
      const customerName = `${customerObj.first_name} ${customerObj.last_name}`
      notifyMechanic({
        supabase,
        mechanicId: techId,
        message:    `New booking with 25-Point Inspection requested: ${customerName} — ${service_type} on ${job_date}. Check your scheduler for details.`,
        subject:    `25-Point Inspection Requested — ${customerName}`,
      }).catch((e) => console.error('[POST /api/book] mechanic notify error:', e))

      void p // suppress unused warning
    } catch (e) {
      console.error('[POST /api/book] inspection creation error:', e)
    }
  }

  // ── Fire booking confirmation ──
  dispatchNotification({
    trigger:  'booking_confirmation',
    jobId,
    supabase,
  }).catch((err) => console.error('[POST /api/book] notification error:', err))

  return NextResponse.json({
    job: {
      id:                   job.id,
      job_date:             job.job_date,
      job_time:             job.job_time,
      service_type:         job.service_type,
      inspection_requested: wantsInspection,
    },
    customer: {
      first_name: customer.first_name,
      last_name:  customer.last_name,
    },
  }, { status: 201 })
}
