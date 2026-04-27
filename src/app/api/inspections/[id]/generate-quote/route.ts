// POST /api/inspections/[id]/generate-quote
// Generates a fully-priced draft quote from failed/needs-attention inspection items.
// Calls the same Claude AI tech-guide system as QuickWrench, with parallel execution.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { getMappedService } from '@/lib/mpi-catalog'
import { callTechGuide } from '@/lib/tech-guide'
import type { TechGuidePart } from '@/types/quickwrench'

type RouteContext = { params: Promise<{ id: string }> }

function r2(n: number): number {
  return Math.round(n * 100) / 100
}

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

export async function POST(_req: Request, { params }: RouteContext) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  // Fetch inspection + items + vehicle (via job FK)
  type VehicleRow = { year: number | null; make: string; model: string; engine: string | null } | null
  type JobRow     = { vehicle_id: string | null; vehicle: VehicleRow } | null
  type RawItem    = { point_name: string; status: string; mapped_service_name: string | null }

  const { data: inspection, error: fetchErr } = await supabase
    .from('inspections')
    .select(`
      *,
      items:inspection_items(*),
      job:jobs(vehicle_id, vehicle:vehicles(year, make, model, engine))
    `)
    .eq('id', id)
    .eq('mechanic_id', user.id)
    .single()

  if (fetchErr || !inspection) {
    return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
  }

  if (inspection.status !== 'completed') {
    return NextResponse.json({ error: 'Inspection must be completed before generating a quote.' }, { status: 409 })
  }

  const jobRow     = inspection.job as JobRow
  const vehicleRow = jobRow?.vehicle ?? null
  const vehicleId  = jobRow?.vehicle_id ?? null

  if (!vehicleRow) {
    console.warn(`[generate-quote] No vehicle linked to inspection ${id} — AI will use generic context`)
  }

  // Pull mechanic's most-recent rate settings from their quote history
  const { data: recentQuotes } = await supabase
    .from('quotes')
    .select('labor_rate, tax_percent')
    .eq('user_id', user.id)
    .not('labor_rate', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)

  const recentQ  = recentQuotes?.[0]
  const laborRate = Number(recentQ?.labor_rate ?? 125)
  const taxPct    = Number(recentQ?.tax_percent ?? 8.5)

  // Identify failed/needs_attention items, deduplicate by mapped service name
  const failedItems = ((inspection.items as RawItem[]) ?? []).filter(
    (item) => item.status === 'fail' || item.status === 'needs_attention',
  )

  if (failedItems.length === 0) {
    return NextResponse.json({ error: 'No failed or needs-attention items to quote.' }, { status: 422 })
  }

  type ServiceEntry = {
    serviceName:  string
    pointName:    string
    isMapped:     boolean
    catalogHours: number
  }

  const seen     = new Set<string>()
  const services: ServiceEntry[] = []

  for (const item of failedItems) {
    const mapped = item.mapped_service_name
      ? { name: item.mapped_service_name, hours: getMappedService(item.point_name)?.hours ?? 0 }
      : getMappedService(item.point_name)

    const displayName = mapped?.name ?? `Service for: ${item.point_name} — labor TBD`
    if (seen.has(displayName)) continue
    seen.add(displayName)

    services.push({
      serviceName:  displayName,
      pointName:    item.point_name,
      isMapped:     !!mapped,
      catalogHours: mapped?.hours ?? 0,
    })
  }

  // Run AI tech-guide calls in parallel (15 s timeout each).
  // Unmapped services skip AI and get placeholder entries only.
  const apiKey = process.env.ANTHROPIC_API_KEY

  type ServiceResult = {
    serviceName: string
    hours:       number
    parts:       TechGuidePart[]
    aiPowered:   boolean
  }

  let results:     ServiceResult[]
  let usedFallback = false

  if (apiKey) {
    const vehicle = vehicleRow
      ? {
          year:   vehicleRow.year != null ? String(vehicleRow.year) : undefined,
          make:   vehicleRow.make  ?? undefined,
          model:  vehicleRow.model ?? undefined,
          engine: vehicleRow.engine ?? undefined,
        }
      : {}

    results = await Promise.all(
      services.map(async (svc): Promise<ServiceResult> => {
        if (!svc.isMapped) {
          return { serviceName: svc.serviceName, hours: 0, parts: [], aiPowered: false }
        }

        const guide = await callTechGuide(
          apiKey,
          vehicle,
          { name: svc.serviceName, categoryLabel: 'Automotive Service' },
          15000,
        )

        if (!guide) {
          console.warn(`[generate-quote] AI fallback for "${svc.serviceName}" — using catalog hours`)
          return { serviceName: svc.serviceName, hours: svc.catalogHours, parts: [], aiPowered: false }
        }

        const parts = (guide.parts ?? []).filter(
          (p): p is TechGuidePart =>
            typeof p === 'object' && p !== null && 'unit_cost' in p && 'unit_price' in p,
        )

        return { serviceName: svc.serviceName, hours: guide.hours, parts, aiPowered: true }
      }),
    )

    if (!results.some(r => r.aiPowered) && services.some(s => s.isMapped)) {
      usedFallback = true
    }
  } else {
    console.warn('[generate-quote] ANTHROPIC_API_KEY not set — using catalog fallback')
    usedFallback = true
    results = services.map(svc => ({
      serviceName: svc.serviceName,
      hours:       svc.catalogHours,
      parts:       [],
      aiPowered:   false,
    }))
  }

  // Build line items (parts only — QuotesTab renders labor separately via labor_hours + labor_rate)
  // unit_price = AI retail price; parts_markup_percent = 0 since AI already included markup.
  type LineItem = { description: string; quantity: number; unit_price: number; total: number }

  const lineItems: LineItem[] = []
  let totalHours   = 0
  let partsRevenue = 0  // retail total (for grand_total)
  let costBasis    = 0  // mechanic's cost (for parts_subtotal)

  for (const result of results) {
    totalHours += result.hours

    for (const p of result.parts) {
      const retail = r2(p.unit_price)
      lineItems.push({
        description: p.name,
        quantity:    p.qty,
        unit_price:  retail,
        total:       r2(retail * p.qty),
      })
      partsRevenue += retail * p.qty
      costBasis    += p.unit_cost * p.qty
    }
  }

  totalHours   = r2(totalHours)
  partsRevenue = r2(partsRevenue)
  costBasis    = r2(costBasis)

  const laborSubtotal = r2(totalHours * laborRate)
  const preTax        = r2(partsRevenue + laborSubtotal)
  const taxAmount     = r2(preTax * taxPct / 100)
  const grandTotal    = r2(preTax + taxAmount)

  const completedDate = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const quoteNumber = await genQuoteNumber(supabase, user.id)

  const serviceLabel = results.length === 1
    ? results[0].serviceName
    : `${results.length} Services`

  const { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert({
      user_id:              user.id,
      quote_number:         quoteNumber,
      customer_id:          inspection.customer_id ?? null,
      vehicle_id:           vehicleId,
      status:               'draft',
      source:               'mpi',
      job_category:         'Multi-Point Inspection',
      job_subtype:          serviceLabel,
      line_items:           lineItems,
      jobs:                 [],
      labor_hours:          totalHours,
      labor_rate:           laborRate,
      parts_subtotal:       costBasis,
      parts_markup_percent: 0,
      labor_subtotal:       laborSubtotal,
      tax_percent:          taxPct,
      tax_amount:           taxAmount,
      grand_total:          grandTotal,
      notes: `Generated from 25-Point Multi-Point Inspection (${completedDate}).${
        usedFallback
          ? ' AI pricing unavailable — please add parts and pricing manually.'
          : ' Pricing provided by AI — review before sending to customer.'
      }`,
    })
    .select('id')
    .single()

  if (quoteErr || !quote) {
    console.error('[POST /api/inspections/[id]/generate-quote]', quoteErr)
    return NextResponse.json({ error: 'Failed to create quote.' }, { status: 500 })
  }

  return NextResponse.json({ quoteId: quote.id, quoteNumber, usedFallback }, { status: 201 })
}
