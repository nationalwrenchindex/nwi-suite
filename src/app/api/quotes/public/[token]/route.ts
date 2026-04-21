// GET /api/quotes/public/[token]
// Fetch a quote by its public_token — no auth required.
// Uses the service client (bypasses RLS) and filters by token.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

const QUOTE_SELECT = `
  id, quote_number, status, public_token,
  job_category, job_subtype, notes,
  line_items, labor_hours, labor_rate,
  parts_subtotal, parts_markup_percent, labor_subtotal,
  tax_percent, tax_amount, grand_total,
  view_count, viewed_at, times_sent,
  sent_at, approved_at, declined_at, quote_expires_at,
  customer_response_note,
  customer:customers(id, first_name, last_name, phone),
  vehicle:vehicles(id, year, make, model, vin),
  user_id
`

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token || token.length < 20) {
    return NextResponse.json({ error: 'Invalid token.' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: quote, error } = await serviceClient
    .from('quotes')
    .select(QUOTE_SELECT)
    .eq('public_token', token)
    .single()

  if (error || !quote) {
    return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })
  }

  // Fetch tech profile for display (business name, phone)
  const { data: profile } = await serviceClient
    .from('profiles')
    .select('full_name, business_name, phone')
    .eq('id', quote.user_id)
    .single()

  return NextResponse.json({
    quote,
    tech: {
      full_name:     (profile as { full_name?: string } | null)?.full_name     ?? null,
      business_name: (profile as { business_name?: string } | null)?.business_name ?? null,
      phone:         (profile as { phone?: string } | null)?.phone             ?? null,
    },
  })
}
