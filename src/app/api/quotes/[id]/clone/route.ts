// POST /api/quotes/[id]/clone
// Clones any quote into a new Draft, linking back via parent_quote_id.
// Used by the "Edit as New Version" button for sent/approved/declined/expired/converted quotes.

import { NextResponse } from 'next/server'
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
    const parts  = data[0].quote_number.split('-')
    const parsed = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(parsed)) seq = parsed + 1
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: original, error: fetchErr } = await supabase
    .from('quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !original) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  const newNumber = await genQuoteNumber(supabase, user.id)

  const { data: cloned, error: insertErr } = await supabase
    .from('quotes')
    .insert({
      user_id:              user.id,
      quote_number:         newNumber,
      status:               'draft',
      parent_quote_id:      id,
      customer_id:          original.customer_id,
      vehicle_id:           original.vehicle_id,
      job_category:         original.job_category,
      job_subtype:          original.job_subtype,
      line_items:           original.line_items,
      labor_hours:          original.labor_hours,
      labor_rate:           original.labor_rate,
      parts_subtotal:       original.parts_subtotal,
      parts_markup_percent: original.parts_markup_percent,
      labor_subtotal:       original.labor_subtotal,
      tax_percent:          original.tax_percent,
      tax_amount:           original.tax_amount,
      grand_total:          original.grand_total,
      notes:                original.notes,
      source:               original.source,
    })
    .select(`
      *,
      customer:customers(id, first_name, last_name, phone, email),
      vehicle:vehicles(id, year, make, model, vin)
    `)
    .single()

  if (insertErr || !cloned) {
    console.error('[POST /api/quotes/[id]/clone]', insertErr)
    return NextResponse.json({ error: 'Failed to clone quote.' }, { status: 500 })
  }

  return NextResponse.json({ quote: cloned }, { status: 201 })
}
