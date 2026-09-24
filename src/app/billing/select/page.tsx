import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import ModuleSelectClient from '@/components/billing/ModuleSelectClient'

export const metadata = { title: 'Choose Your Modules — National Wrench Index Suite™' }

export default async function BillingSelectPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string; promo?: string }>
}) {
  const sp    = searchParams ? await searchParams : {}
  const plan  = sp?.plan
  const promo = sp?.promo ?? null

  if (plan !== 'starter' && plan !== 'pro') redirect('/billing')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav workOrdersEnabled={profile.work_orders_enabled ?? false}
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
      />
      <ModuleSelectClient plan={plan} promotionCodeId={promo} />
    </div>
  )
}
