import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import WorkOrderForm from '@/components/work-orders/WorkOrderForm'
import { WORK_ORDER_SELECT } from '@/app/api/work-orders/list'
import { STATUS_META, unitLabelFor, type WorkOrder, type WorkOrderPhoto } from '@/types/work-orders'
import SegmentList from '@/components/shared/SegmentList'
import { PARENTS } from '@/lib/segments/parent'
import { SEGMENT_SELECT, shapeSegments } from '@/lib/segments/select'
import { isParentPriced } from '@/components/shared/segments'
import type { PhotoWithUrl } from '@/components/work-orders/WorkOrderPhotos'

export const metadata = { title: 'Work Order — National Wrench Index Suite™' }

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled, default_labor_rate, default_parts_markup_percent, default_tax_percent')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (profile.work_orders_enabled !== true) redirect('/dashboard')

  const [{ data }, { data: photoRows }] = await Promise.all([
    supabase
      .from('work_orders')
      .select(WORK_ORDER_SELECT)
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('work_order_photos')
      .select('id, work_order_id, file_url, caption, created_at')
      .eq('work_order_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: true }),
  ])

  if (!data) notFound()
  const wo = data as unknown as WorkOrder

  // The bucket is private, so every photo is displayed through a short-lived signed
  // URL. Signed here rather than stored, because a stored URL expires and leaves a
  // permanently broken image on the record.
  const photos: PhotoWithUrl[] = await Promise.all(
    ((photoRows ?? []) as WorkOrderPhoto[]).map(async photo => {
      const { data: signed } = await supabase.storage
        .from('work-order-photos')
        .createSignedUrl(photo.file_url, 3600)
      return { ...photo, signedUrl: signed?.signedUrl ?? null }
    }),
  )
  const { data: segRows } = await supabase
    .from('work_order_segments')
    .select(SEGMENT_SELECT)
    .eq(PARENTS.ld.fkColumn, wo.id)
    .eq('user_id', user.id)
    .order('sequence', { ascending: true })

  const segments = shapeSegments(segRows)
  // Legacy: priced by its own line items and created before segments. A brand-new
  // work order has neither, and reads as segment-priced — which is the intent.
  const parentPriced = isParentPriced(wo.line_items, segments)

  const meta = STATUS_META[wo.status]

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        workOrdersEnabled
        businessName={profile.business_name}
        businessType={(profile as Record<string, unknown>).business_type as string | undefined}
      />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <Link href="/work-orders" className="text-white/40 hover:text-orange text-xs transition-colors">
            ← Work Orders
          </Link>
          <div className="flex items-center gap-3 flex-wrap mt-2">
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              {wo.work_order_number}
            </h1>
            <span
              className="px-2.5 py-0.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: meta.bg, color: meta.text }}
            >
              {meta.label}
            </span>
          </div>
          <p className="text-white/40 text-sm mt-1">
            {wo.customer ? `${wo.customer.first_name} ${wo.customer.last_name}` : 'No customer'}
            {' · '}{unitLabelFor(wo)}
            {wo.po_number ? ` · PO ${wo.po_number}` : ''}
          </p>
        </div>

        <WorkOrderForm
          workOrder={wo}
          photos={photos}
          ownsPricing={parentPriced}
          defaults={{
            labor_rate:     Number(profile.default_labor_rate ?? 125),
            markup_percent: Number(profile.default_parts_markup_percent ?? 20),
            tax_percent:    Number(profile.default_tax_percent ?? 8.5),
          }}
        />

        {/* Segment-priced work orders get their money here instead. A legacy
            parent-priced record never shows this — it is one model or the other, and
            the segments route refuses to let a record become both. */}
        {!parentPriced && (
          <div className="mt-6 space-y-3">
            <h2 className="font-condensed font-bold text-xl text-white tracking-wide">SEGMENTS</h2>
            <p className="text-white/40 text-sm">
              One per complaint. The customer approves or declines each separately, and only
              what they authorize gets invoiced.
            </p>
            <SegmentList
              apiBase={`/api/work-orders/${wo.id}`}
              variant="ld"
              initialSegments={segments}
              defaultMarkup={Number(profile.default_parts_markup_percent ?? 20)}
              laborRate={Number(profile.default_labor_rate ?? 125)}
              defaultTaxPercent={Number(profile.default_tax_percent ?? 8.5)}
              locked={!!wo.converted_invoice_id}
            />
          </div>
        )}

        {parentPriced && (
          <p className="mt-4 text-white/30 text-xs">
            This work order is priced with its own line items, so it does not use segments.
            Start a new work order to use segments for additional work.
          </p>
        )}
      </main>
    </div>
  )
}
