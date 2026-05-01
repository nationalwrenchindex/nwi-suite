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
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { job_id, customer_id, vehicle_id, notes } = body

  const quoteNumber = await genQuoteNumber(supabase, user.id)

  const { data: quote, error } = await supabase
    .from('quotes')
    .insert({
      user_id:      user.id,
      quote_number: quoteNumber,
      status:       'draft',
      source:       'job',
      job_id:       job_id      ? String(job_id)      : null,
      customer_id:  customer_id ? String(customer_id) : null,
      vehicle_id:   vehicle_id  ? String(vehicle_id)  : null,
      notes:        notes       ? String(notes)        : null,
      line_items:   [],
    })
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/quotes]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ quote }, { status: 201 })
}
