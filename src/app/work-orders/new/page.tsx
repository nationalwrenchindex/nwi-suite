import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import WorkOrderForm from '@/components/work-orders/WorkOrderForm'
import { loadDocumentDefaults } from '@/lib/document-defaults.server'

export const metadata = { title: 'New Work Order — National Wrench Index Suite™' }

export default async function NewWorkOrderPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // The pricing defaults come from the same profile read as the gate, so a blank
  // work order opens with the shop's own labour rate, markup and tax rather than
  // making the tech retype them for every job.
  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (profile.work_orders_enabled !== true) redirect('/dashboard')
  const docDefaults = await loadDocumentDefaults(supabase, user.id)

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
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide mt-2">
            NEW WORK ORDER
          </h1>
        </div>

        <WorkOrderForm
          defaults={{
            // lib/document-defaults: the one read every LD surface makes. An unset
            // rate is 0, never an invented 125 / 20 / 8.5.
            labor_rate:     docDefaults.laborRate,
            markup_percent: docDefaults.markupPct,
            tax_percent:    docDefaults.taxPct,
          }}
        />
      </main>
    </div>
  )
}
