// GET /api/quotes/[id] — fetch a single quote with joined customer and vehicle

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: quote, error } = await supabase
    .from('quotes')
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model, vin)
    `)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  return NextResponse.json({ quote })
}
