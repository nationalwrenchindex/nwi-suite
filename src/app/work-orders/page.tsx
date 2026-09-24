import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import WorkOrderList from './WorkOrderList'
import { WORK_ORDER_SELECT, WORK_ORDER_PAGE_SIZE } from '@/app/api/work-orders/list'
import type { WorkOrder } from '@/types/work-orders'

export const metadata = { title: 'Work Orders — National Wrench Index Suite™' }

export default async function WorkOrdersPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  // The feature is hidden, not locked: a business without the flag is sent to the
  // dashboard rather than shown an upgrade screen, because there is nothing here to
  // upgrade to. A bookmark from a business whose flag was switched off lands here.
  if (profile.work_orders_enabled !== true) redirect('/dashboard')

  // Page one is rendered server-side; the count is its own exact/head query so the
  // header total is the real total no matter how few rows are loaded.
  const [{ data: rows }, { count }] = await Promise.all([
    supabase
      .from('work_orders')
      .select(WORK_ORDER_SELECT)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .order('id',         { ascending: false })
      .range(0, WORK_ORDER_PAGE_SIZE - 1),
    supabase
      .from('work_orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ])

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        workOrdersEnabled
        businessName={profile.business_name}
        businessType={(profile as Record<string, unknown>).business_type as string | undefined}
      />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              WORK ORDERS
            </h1>
            <p className="text-white/40 text-sm">
              Fleet and commercial jobs, from authorisation through to invoicing.
            </p>
          </div>
          <Link
            href="/work-orders/new"
            className="flex-shrink-0 px-4 py-2.5 rounded-lg bg-orange hover:bg-orange-hover text-white text-sm font-semibold transition-colors"
          >
            + New Work Order
          </Link>
        </div>

        <WorkOrderList
          initialRows={(rows ?? []) as unknown as WorkOrder[]}
          total={count ?? 0}
        />
      </main>
    </div>
  )
}
