// GET  /api/quotes  — list quotes for the authenticated user
// (POST will be added in a later phase when manual quote creation is needed)

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
