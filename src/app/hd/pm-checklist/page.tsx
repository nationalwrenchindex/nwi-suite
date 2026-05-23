import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PMChecklistClient from '@/components/hd/PMChecklistClient'

export const metadata = { title: 'PM Checklist — NWI HD Suite' }

export default async function PMChecklistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const [{ data: workOrders }, { data: units }] = await Promise.all([
    supabase
      .from('hd_work_orders')
      .select('id, work_order_number, unit_id, fleet_account_id, current_setpoint, tech_name')
      .eq('user_id', user.id)
      .in('status', ['open', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(50),

    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, unit_type, total_hours')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('unit_number'),
  ])

  return (
    <main className="flex-1 py-6">
      <div className="px-4 sm:px-6 mb-6">
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Preventive Maintenance
        </p>
        <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PM CHECKLIST</h1>
        <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Transport refrigeration comprehensive PM — safety placard required before checklist unlocks.
        </p>
      </div>

      <PMChecklistClient
        workOrders={workOrders ?? []}
        units={units ?? []}
        userId={user.id}
      />
    </main>
  )
}
