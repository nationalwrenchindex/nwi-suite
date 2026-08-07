import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PMChecklistClient from '@/components/hd/PMChecklistClient'

export const metadata = { title: 'PM Checklist — NWI HD Suite' }

export default async function PMChecklistPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  const [{ data: units }, { data: invoices }] = await Promise.all([
    // Show the tech's units; treat active=true OR active IS NULL as active so units
    // predating the `active` column (or with a null status) still populate the dropdown.
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, serial_number, unit_type, total_hours')
      .eq('user_id', user.id)
      .or('active.is.null,active.eq.true')
      .order('unit_number', { ascending: true }),

    // Open invoices only — exclude paid/void/partial (closed) receivables.
    supabase
      .from('hd_invoices')
      .select('id, invoice_number, customer_name, total, status')
      .eq('user_id', user.id)
      .in('status', ['unpaid', 'sent', 'overdue'])
      .order('created_at', { ascending: false })
      .limit(200),
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
        units={units ?? []}
        invoices={invoices ?? []}
        userId={user.id}
      />
    </main>
  )
}
