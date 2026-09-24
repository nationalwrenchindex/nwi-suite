import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import WorkOrderForm from '@/components/work-orders/WorkOrderForm'

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
    .select('business_name, business_type, work_orders_enabled, default_labor_rate, default_parts_markup_percent, default_tax_percent')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (profile.work_orders_enabled !== true) redirect('/dashboard')

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
            labor_rate:     Number(profile.default_labor_rate ?? 125),
            markup_percent: Number(profile.default_parts_markup_percent ?? 20),
            tax_percent:    Number(profile.default_tax_percent ?? 8.5),
          }}
        />
      </main>
    </div>
  )
}
