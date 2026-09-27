// GET /api/work-orders/public/[token]
//
// What the customer's approval page reads. No auth: the token IS the credential, the
// same arrangement the public quote and invoice pages use.
//
// Read with the SERVICE client rather than granting anon SELECT on work_order_segments.
// An anon policy on a table holding every shop's pricing is a far wider blast radius
// than this one route, which returns exactly the fields the page renders.

import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { rollupSegments } from '@/components/shared/segments'

export const dynamic = 'force-dynamic'

const FK = PARENTS.ld.fkColumn

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  if (!token) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const sc = createServiceClient()

  const { data: wo } = await sc
    .from('work_orders')
    .select(`
      id, work_order_number, po_number, job_description, status,
      customer_viewed_at, user_id,
      customer:customers(first_name, last_name),
      vehicle:vehicles(year, make, model)
    `)
    .eq('public_token', token)
    .single()

  if (!wo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [{ data: segRows }, { data: profile }] = await Promise.all([
    sc.from('work_order_segments')
      .select(SEGMENT_SELECT)
      .eq(FK, wo.id)
      .order('sequence', { ascending: true }),
    sc.from('profiles')
      .select('business_name, phone')
      .eq('id', wo.user_id as string)
      .single(),
  ])

  const segments = shapeSegments(segRows)

  // First view only, and never blocking the response — the page is the product, this
  // is telemetry for the tech's "customer opened it" indicator.
  if (!wo.customer_viewed_at) {
    void sc.from('work_orders')
      .update({ customer_viewed_at: new Date().toISOString() })
      .eq('id', wo.id)
  }

  const customer = wo.customer as unknown as { first_name: string; last_name: string } | null
  const vehicle  = wo.vehicle  as unknown as { year: number | null; make: string; model: string } | null

  return NextResponse.json({
    work_order: {
      work_order_number: wo.work_order_number,
      po_number:         wo.po_number,
      job_description:   wo.job_description,
      customer_name:     customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
      vehicle_label:     vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : null,
    },
    business: {
      name:  (profile?.business_name as string | null) ?? null,
      phone: (profile?.phone as string | null) ?? null,
    },
    segments,
    rollup: rollupSegments(segments),
  })
}
