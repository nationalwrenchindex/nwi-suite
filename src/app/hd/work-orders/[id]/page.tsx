import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { fetchWorkOrderInspections } from '@/lib/hd/inspections'
import { BRANDING_SELECT, resolveBranding, type BrandingSource } from '@/lib/branding'
import WorkOrderDetail from './WorkOrderDetail'

export const metadata = { title: 'Work Order — NWI HD Suite' }

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const [{ data: wo }, { data: photos }, inspections, { data: brandingRow }] = await Promise.all([
    supabase
      .from('hd_work_orders')
      // '*' rather than a column list so the migration-159 unit columns (unit_year,
      // truck_*, vin) are read when they exist, and the page still loads before 159 is
      // applied - naming them would fail the whole read until then.
      .select(`
        *,
        unit:hd_units(id, unit_number, manufacturer, model, year, serial_number),
        fleet:hd_fleet_accounts(id, fleet_name, contact_email, contact_phone, address)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('hd_work_order_photos')
      .select('id, category, file_url, file_name, caption, taken_at')
      .eq('work_order_id', id)
      .order('taken_at', { ascending: true }),
    fetchWorkOrderInspections(supabase, user.id, id),
    // Subscriber white-label branding for the document header. Scoped to the
    // signed-in user, since a work order belongs to whoever is looking at it.
    supabase
      .from('profiles')
      .select(BRANDING_SELECT)
      .eq('id', user.id)
      .single(),
  ])

  if (!wo) notFound()

  // THE QUOTE'S RECORDED UNIT, for a work order made before migration 159 gave the
  // work order its own year / truck / VIN columns. The document chain's value wins
  // over the hd_units record, same rule as the rates, the tax and the terms; this only
  // fills what the work order itself does not carry.
  const woRow = wo as Record<string, unknown>
  const UNIT_DOC_FIELDS = ['unit_year', 'truck_make', 'truck_model', 'truck_year', 'vin'] as const
  if (woRow.quote_id && UNIT_DOC_FIELDS.some(k => !woRow[k])) {
    const { data: q } = await supabase
      .from('hd_quotes')
      .select(UNIT_DOC_FIELDS.join(', '))
      .eq('id', String(woRow.quote_id))
      .eq('user_id', user.id)
      .maybeSingle()
    const quote = (q ?? {}) as Record<string, unknown>
    for (const k of UNIT_DOC_FIELDS) if (!woRow[k] && quote[k]) woRow[k] = quote[k]
  }

  const branding = resolveBranding(brandingRow as BrandingSource | null)

  // Generate signed URLs for each photo (1-hour expiry)
  const photosWithUrls = await Promise.all(
    (photos ?? []).map(async (photo) => {
      const { data } = await supabase.storage
        .from('hd-work-order-photos')
        .createSignedUrl(photo.file_url, 3600)
      return { ...photo, signedUrl: data?.signedUrl ?? null }
    })
  )

  return (
    <main className="flex-1 min-h-screen" style={{ background: 'var(--hd-bg)' }}>
      <WorkOrderDetail
        workOrder={wo as unknown as Parameters<typeof WorkOrderDetail>[0]['workOrder']}
        photos={photosWithUrls}
        inspections={inspections}
        workOrderId={id}
        branding={branding}
      />
    </main>
  )
}
