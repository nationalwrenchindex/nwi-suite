// POST /api/inspections/[id]/generate-quote
// Generates a draft quote from failed / needs_attention inspection items.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { getMappedService } from '@/lib/mpi-catalog'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(
  _req: Request,
  { params }: RouteContext,
) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  // Fetch inspection + items, verify ownership
  const { data: inspection, error: fetchErr } = await supabase
    .from('inspections')
    .select(`*, items:inspection_items(*)`)
    .eq('id', id)
    .eq('mechanic_id', user.id)
    .single()

  if (fetchErr || !inspection) {
    return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
  }

  if (inspection.status !== 'completed') {
    return NextResponse.json({ error: 'Inspection must be completed before generating a quote.' }, { status: 409 })
  }

  type RawItem = { point_name: string; status: string; mapped_service_name: string | null }
  const failedItems = ((inspection.items as RawItem[]) ?? []).filter(
    (item) => item.status === 'fail' || item.status === 'needs_attention',
  )

  if (failedItems.length === 0) {
    return NextResponse.json({ error: 'No failed or needs-attention items to quote.' }, { status: 422 })
  }

  // Deduplicate by service name so we don't create two line items for
  // e.g. "Engine Oil" + "Oil Filter" both mapping to Oil & Filter Change
  const seen = new Set<string>()
  const lineItems: Array<{ description: string; quantity: number; unit_price: number; total: number }> = []
  let totalHours = 0

  for (const item of failedItems) {
    const mapped = item.mapped_service_name
      ? { name: item.mapped_service_name, hours: getMappedService(item.point_name)?.hours ?? 0 }
      : getMappedService(item.point_name)

    const serviceName = mapped?.name ?? `Service for: ${item.point_name} — labor TBD`

    if (seen.has(serviceName)) continue
    seen.add(serviceName)

    lineItems.push({
      description: serviceName,
      quantity:    1,
      unit_price:  0,
      total:       0,
    })

    totalHours += mapped?.hours ?? 0
  }

  const completedDate = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  // Generate the next sequential quote number for this user
  const { count: existingCount } = await supabase
    .from('quotes')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const quoteNumber = `Q-${String((existingCount ?? 0) + 1).padStart(4, '0')}`

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      user_id:              user.id,
      quote_number:         quoteNumber,
      customer_id:          inspection.customer_id ?? null,
      status:               'draft',
      line_items:           lineItems,
      labor_hours:          Math.round(totalHours * 100) / 100,
      labor_rate:           0,
      parts_subtotal:       0,
      parts_markup_percent: 0,
      labor_subtotal:       0,
      tax_percent:          0,
      tax_amount:           0,
      grand_total:          0,
      notes: `Generated from 25-Point Multi-Point Inspection (${completedDate}). Update labor rate and add parts pricing before sending.`,
    })
    .select('id')
    .single()

  if (quoteErr || !quote) {
    console.error('[POST /api/inspections/[id]/generate-quote]', quoteErr)
    return NextResponse.json({ error: 'Failed to create quote.' }, { status: 500 })
  }

  return NextResponse.json({ quoteId: quote.id }, { status: 201 })
}
