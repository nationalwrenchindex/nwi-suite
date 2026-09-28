import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/service'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import SegmentApprovalClient from '@/components/shared/SegmentApprovalClient'
import { BRANDING_SELECT, resolveBranding, type BrandingSource } from '@/lib/branding'
import { publicDocumentMetadata } from '@/lib/public-metadata'

// Public. No auth, no AppNav — the token is the credential, same arrangement as
// /quote/[token] and /invoice/[token]. Read with the service client so no anon policy
// is needed on a table holding every shop's pricing.
export const dynamic = 'force-dynamic'

export async function generateMetadata(
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const sc = createServiceClient()
  const { data } = await sc
    .from('work_orders')
    .select('work_order_number, user_id')
    .eq('public_token', token)
    .single()

  // The shop's name on the tab, not ours. Two queries rather than an embed: this
  // runs on a public route and a plain lookup cannot become ambiguous later.
  let businessName: string | null = null
  if (data?.user_id) {
    const { data: p } = await sc
      .from('profiles')
      .select('business_name, full_name')
      .eq('id', data.user_id as string)
      .single()
    businessName = (p?.business_name as string | null) || (p?.full_name as string | null) || null
  }

  return publicDocumentMetadata(
    data?.work_order_number ? `Approve work — ${data.work_order_number}` : 'Approve work',
    businessName,
  )
}

export default async function PublicWorkOrderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const sc = createServiceClient()

  const { data: wo } = await sc
    .from('work_orders')
    .select(`
      id, work_order_number, po_number, job_description, user_id, customer_viewed_at,
      customer:customers(first_name, last_name),
      vehicle:vehicles(year, make, model)
    `)
    .eq('public_token', token)
    .single()

  if (!wo) notFound()

  const [{ data: segRows }, { data: profile }] = await Promise.all([
    sc.from('work_order_segments')
      .select(SEGMENT_SELECT)
      .eq(PARENTS.ld.fkColumn, wo.id)
      .order('sequence', { ascending: true }),
    sc.from('profiles')
      // Through BRANDING_SELECT so this page gets the same logo and the same
      // full_name fallback every other customer-facing document already had. It
      // was reading business_name alone, so a subscriber who had uploaded a logo
      // saw it on their invoice and not on their approval page.
      .select(BRANDING_SELECT)
      .eq('id', wo.user_id as string)
      .single(),
  ])

  // Stamped on first view so the tech can see the customer opened it. Fire and forget:
  // the page is the product and a telemetry write must never delay or block it.
  if (!wo.customer_viewed_at) {
    void sc.from('work_orders')
      .update({ customer_viewed_at: new Date().toISOString() })
      .eq('id', wo.id)
  }

  const customer = wo.customer as unknown as { first_name: string; last_name: string } | null
  const vehicle  = wo.vehicle  as unknown as { year: number | null; make: string; model: string } | null

  return (
    <div className="min-h-dvh bg-dark">
      <SegmentApprovalClient
        token={token}
        apiBase="/api/work-orders/public"
        variant="ld"
        workOrder={{
          work_order_number: wo.work_order_number as string,
          po_number:         (wo.po_number as string | null) ?? null,
          job_description:   (wo.job_description as string | null) ?? null,
          customer_name:     customer ? `${customer.first_name} ${customer.last_name}`.trim() : null,
          vehicle_label:     vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') : null,
        }}
        business={(() => {
          const b = resolveBranding(profile as BrandingSource | null)
          return { name: b.name, phone: b.phone, logoUrl: b.logoUrl }
        })()}
        initialSegments={shapeSegments(segRows)}
      />
    </div>
  )
}
