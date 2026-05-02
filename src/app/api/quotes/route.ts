// GET  /api/quotes  — list quotes for the authenticated user
// POST /api/quotes  — create a new draft quote (e.g. from a job)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'

async function genQuoteNumber(supabase: SupabaseClient, userId: string): Promise<string> {
  const year   = new Date().getFullYear()
  const prefix = `QT-${year}-`
  const { data } = await supabase
    .from('quotes')
    .select('quote_number')
    .eq('user_id', userId)
    .like('quote_number', `${prefix}%`)
    .order('quote_number', { ascending: false })
    .limit(1)
  let seq = 1
  if (data && data.length > 0) {
    const parts  = (data[0].quote_number as string).split('-')
    const parsed = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(parsed)) seq = parsed + 1
  }
  return `${prefix}${String(seq).padStart(4, '0')}`
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status    = searchParams.get('status') ?? ''
  const dateRange = searchParams.get('date_range') ?? ''

  let query = supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model, vin)
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  if (dateRange && dateRange !== 'all') {
    const days =
      dateRange === '7d'  ? 7  :
      dateRange === '30d' ? 30 :
      dateRange === '90d' ? 90 : null
    if (days) {
      const since = new Date()
      since.setDate(since.getDate() - days)
      query = query.gte('created_at', since.toISOString())
    }
  }

  const { data: quotes, error } = await query

  if (error) {
    console.error('[quotes] list failed:', error)
    return NextResponse.json({ error: 'Failed to load quotes.' }, { status: 500 })
  }

  return NextResponse.json({ quotes: quotes ?? [] })
}

// ─── POST /api/quotes ─────────────────────────────────────────────────────────
// Creates a new draft quote, optionally linked to a job.
// For detailers with a job_id, pre-populates labor_rate from saved service catalog pricing.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id, customer_id, vehicle_id, notes } = body

  // Check business type; detailers get service catalog pre-population
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_type')
    .eq('id', user.id)
    .single()
  const isDetailer = profile?.business_type === 'detailer'

  let prePopLaborRate: number | null = null
  let prePopLaborHours: number | null = null
  let prePopMarkupPct: number | null = null
  let prePopServiceLines: Array<{ service_name: string; vehicle_category: string | null; price_cents: number }> = []

  if (isDetailer) {
    prePopLaborRate  = 0
    prePopLaborHours = 0
    prePopMarkupPct  = 0

    if (job_id) {
      const { data: jobRow } = await supabase
        .from('jobs')
        .select('services, service_type, vehicle_category')
        .eq('id', String(job_id))
        .eq('user_id', user.id)
        .single()

      if (jobRow) {
        const services: string[] = Array.isArray(jobRow.services) && jobRow.services.length > 0
          ? jobRow.services
          : (jobRow.service_type ? [jobRow.service_type] : [])
        const vehicleCategory: string | null = jobRow.vehicle_category ?? null

        if (services.length > 0 && vehicleCategory) {
          const { data: pricingRows } = await supabase
            .from('detailer_service_pricing')
            .select('service_name, base_price')
            .eq('profile_id', user.id)
            .in('service_name', services)
            .eq('vehicle_category', vehicleCategory)
            .eq('is_offered', true)

          if (pricingRows && pricingRows.length > 0) {
            prePopServiceLines = pricingRows.map(p => ({
              service_name:     p.service_name as string,
              vehicle_category: vehicleCategory,
              price_cents:      Math.round((Number(p.base_price) || 0) * 100),
            }))
          }
        }
      }
    }
  }

  const quoteNumber = await genQuoteNumber(supabase, user.id)

  const insertData: Record<string, unknown> = {
    user_id:      user.id,
    quote_number: quoteNumber,
    status:       'draft',
    source:       'job',
    job_id:       job_id      ? String(job_id)      : null,
    customer_id:  customer_id ? String(customer_id) : null,
    vehicle_id:   vehicle_id  ? String(vehicle_id)  : null,
    notes:        notes       ? String(notes)        : null,
    line_items:   [],
  }

  if (prePopLaborRate  !== null) insertData.labor_rate           = prePopLaborRate
  if (prePopLaborHours !== null) insertData.labor_hours          = prePopLaborHours
  if (prePopMarkupPct  !== null) insertData.parts_markup_percent = prePopMarkupPct
  if (isDetailer) {
    insertData.service_lines = prePopServiceLines
    insertData.adjustments   = []
  }

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert(insertData)
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/quotes]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ quote }, { status: 201 })
}
