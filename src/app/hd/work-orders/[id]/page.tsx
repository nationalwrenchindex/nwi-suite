import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
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

  const [{ data: wo }, { data: photos }] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select(`
        id, work_order_number, status, service_type, location, service_requests, comments,
        tech_name, labor_hours, labor_rate, total_amount, flagged_items, current_setpoint,
        started_at, completed_at, created_at,
        unit:hd_units(id, unit_number, manufacturer, model, year, serial_number),
        fleet:hd_fleet_accounts(id, fleet_name)
      `)
      .eq('id', id)
      .eq('user_id', user.id)
      .single(),
    supabase
      .from('hd_work_order_photos')
      .select('id, category, file_url, file_name, caption, taken_at')
      .eq('work_order_id', id)
      .order('taken_at', { ascending: true }),
  ])

  if (!wo) notFound()

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
    <main className="flex-1 min-h-screen" style={{ background: '#0a0f14' }}>
      <WorkOrderDetail
        workOrder={wo as unknown as Parameters<typeof WorkOrderDetail>[0]['workOrder']}
        photos={photosWithUrls}
        workOrderId={id}
      />
    </main>
  )
}
