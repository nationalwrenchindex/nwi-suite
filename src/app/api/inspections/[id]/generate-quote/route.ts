// POST /api/inspections/[id]/generate-quote
// Generates a draft quote (labor priced, part costs left blank for the tech) from failed/needs-attention inspection items.
// Calls the same Gemini tech-guide system as QuickWrench, with parallel execution.

import { NextResponse } from 'next/server'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'
import { loadDocumentDefaults } from '@/lib/document-defaults.server'
import { newDocumentServiceCall } from '@/lib/document-defaults'
import { quickwrenchMoney, partsCostTotal, type QwJob } from '@/lib/quickwrench-money'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { getMappedService } from '@/lib/mpi-catalog'
import { callTechGuideGemini } from '@/lib/tech-guide'
import { isGeminiConfigured } from '@/lib/gemini/client'
import type { TechGuidePart } from '@/types/quickwrench'
import { partNameOnly } from '@/lib/quickwrench-parts'

// Parallel Gemini tech-guide calls (grounded, up to 55s each); 60s prevents Vercel's default timeout kill.
export const maxDuration = 60

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

  // The shop's document defaults - the one read every LD surface makes
  // (lib/document-defaults). These were read here with their own 125 / 20 / 8.5.
  const defaults  = await loadDocumentDefaults(supabase, user.id)
  const laborRate = defaults.laborRate
  const markupPct = defaults.markupPct
  const taxPct    = defaults.taxPct

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

  // Run Gemini tech-guide calls in parallel.
  // Unmapped services skip AI and get placeholder entries only.
  type ServiceResult = {
    serviceName: string
    hours:       number
    parts:       TechGuidePart[]
    aiPowered:   boolean
  }

  let results:     ServiceResult[]
  let usedFallback = false

  if (isGeminiConfigured()) {
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

        const guide = await callTechGuideGemini(
          vehicle,
          { name: svc.serviceName, categoryLabel: 'Automotive Service' },
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
    console.warn('[generate-quote] GEMINI_API_KEY not set — using catalog fallback')
    usedFallback = true
    results = services.map(svc => ({
      serviceName: svc.serviceName,
      hours:       svc.catalogHours,
      parts:       [],
      aiPowered:   false,
    }))
  }

  // Priced through the one shared calculator (lib/quickwrench-money -> lib/document-money),
  // exactly as QuickWrench and the New Quote form price a job: one labour line per service
  // at the shop's rate, the AI retail price as each part's customer price with its cost
  // kept on the line, shop supplies, the service call fee per its setting, and the tax in
  // a parts and a labor bucket. This used to total parts + labour + tax itself with no
  // extras, and stored labour only as labor_hours - which the quote editor, holding
  // labour as lines, does not read.
  const qwJobs: QwJob[] = results.map(r => ({
    subtype: r.serviceName, labor_hours: r2(r.hours),
    // Name and quantity only; cost and price BLANK (0) for the tech to fill from their
    // own supplier. The model's prices used to be billed here as the customer price -
    // the same decision as QuickWrench's Nov 7 change. lib/tech-guide no longer returns
    // a price at all; partNameOnly drops any part number or dollar figure in a name.
    parts: r.parts.map(p => ({ name: partNameOnly(p.name), qty: Number(p.qty) || 1, unit_cost: 0, unit_price: 0 })),
  }))
  const qm = quickwrenchMoney({
    jobs: qwJobs, extraLabor: [], laborRate, markupPct, taxPct,
    taxSettings: defaults.taxSettings, defaults,
    travelHours: 0, mileageMiles: 0,
    serviceCallFee: newDocumentServiceCall(defaults)?.fee ?? 0,
  })

  const completedDate = new Date().toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const quoteNumber = await genQuoteNumber(supabase, user.id)

  const serviceLabel = results.length === 1
    ? results[0].serviceName
    : `${results.length} Services`

  const quoteRow = {
      user_id:              user.id,
      quote_number:         quoteNumber,
      customer_id:          inspection.customer_id ?? null,
      vehicle_id:           vehicleId,
      status:               'draft',
      source:               'mpi',
      job_category:         'Multi-Point Inspection',
      job_subtype:          serviceLabel,
      jobs:                 [],
      // Every money column from lib/document-money, part costs kept on their lines.
      ...qm.columns,
      parts_cost_total:     partsCostTotal(qwJobs),
      notes: `Generated from 25-Point Multi-Point Inspection (${completedDate}).${
        usedFallback
          ? ' AI pricing unavailable — please add parts and pricing manually.'
          : ' Parts are listed by name and quantity only - enter the cost of each part before sending. Labor hours are an AI estimate - check them.'
      }`,
  }

  let { data: quote, error: quoteErr } = await supabase
    .from('quotes')
    .insert(quoteRow)
    .select('id')
    .single()

  // Migration 140 is applied by hand. A quote generated from an inspection must not
  // be lost because a display column is not there yet.
  if (quoteErr && isMissingTaxBreakdownColumn(quoteErr)) {
    console.error('[generate-quote] tax_breakdown missing — run migration 140')
    ;({ data: quote, error: quoteErr } = await supabase
      .from('quotes')
      .insert(withoutTaxBreakdown(quoteRow))
      .select('id')
      .single())
  }

  if (quoteErr || !quote) {
    console.error('[POST /api/inspections/[id]/generate-quote]', quoteErr)
    return NextResponse.json({ error: 'Failed to create quote.' }, { status: 500 })
  }

  return NextResponse.json({ quoteId: quote.id, quoteNumber, usedFallback }, { status: 201 })
}
