import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const since = searchParams.get('since')

  let q = supabase
    .from('hd_expenses')
    .select('id, category, description, amount, expense_date, notes, created_at')
    .eq('user_id', user.id)
    .order('expense_date', { ascending: false })
    .limit(200)

  if (since) q = q.gte('expense_date', since)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expenses: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD access required' }, { status: 403 })

  const body = await req.json()
  const { category, description, amount, expense_date, notes } = body

  if (!category || !description || !amount || !expense_date) {
    return NextResponse.json({ error: 'category, description, amount, and expense_date are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('hd_expenses')
    .insert({ user_id: user.id, category, description, amount: Number(amount), expense_date, notes })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ expense: data }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('hd_expenses')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
