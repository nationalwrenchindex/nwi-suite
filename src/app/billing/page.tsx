import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import BillingClient from '@/components/billing/BillingClient'
import { getSubscription } from '@/lib/subscription'
import { PLANS } from '@/lib/stripe'

export const metadata = { title: 'Billing — NWI Suite' }

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const subscription = await getSubscription(user.id)

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} />
      <Suspense fallback={null}>
        <BillingClient subscription={subscription} plans={PLANS} />
      </Suspense>
    </div>
  )
}
