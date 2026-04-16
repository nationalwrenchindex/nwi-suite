import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── GET /api/expenses ────────────────────────────────────────────────────────
// Query params: category, from_date, to_date, limit, offset
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sp       = request.nextUrl.searchParams
  const category = sp.get('category')
  const fromDate = sp.get('from_date')
  const toDate   = sp.get('to_date')
  const limit    = Number(sp.get('limit')  ?? 100)
  const offset   = Number(sp.get('offset') ?? 0)

  let query = supabase
    .from('expenses')
    .select('*')
    .eq('user_id', user.id)
    .order('expense_date', { ascending: false })
    .order('created_at',   { ascending: false })
    .range(offset, offset + limit - 1)

  if (category) query = query.eq('category', category)
  if (fromDate) query = query.gte('expense_date', fromDate)
  if (toDate)   query = query.lte('expense_date', toDate)

  const { data, error } = await query

  if (error) {
    console.error('[GET /api/expenses]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ expenses: data ?? [] })
}

// ─── POST /api/expenses ───────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.expense_date || typeof body.expense_date !== 'string') {
    return NextResponse.json({ error: 'expense_date is required (YYYY-MM-DD)' }, { status: 400 })
  }
  if (!body.category || typeof body.category !== 'string') {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (!body.description || typeof body.description !== 'string') {
    return NextResponse.json({ error: 'description is required' }, { status: 400 })
  }
  if (body.amount === undefined || isNaN(Number(body.amount))) {
    return NextResponse.json({ error: 'amount is required (number)' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('expenses')
    .insert({
      user_id:      user.id,
      expense_date: body.expense_date,
      category:     body.category,
      description:  body.description,
      amount:       Number(body.amount),
      vendor:       body.vendor      ?? null,
      receipt_url:  body.receipt_url ?? null,
      job_id:       body.job_id      ?? null,
      notes:        body.notes       ?? null,
    })
    .select('*')
    .single()

  if (error) {
    console.error('[POST /api/expenses]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ expense: data }, { status: 201 })
}
