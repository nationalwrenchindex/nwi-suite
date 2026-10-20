import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import BillingClient from '@/components/billing/BillingClient'
import { getSubscription } from '@/lib/subscription'
import { PLANS } from '@/lib/stripe-plans'
import { stripe } from '@/lib/stripe'
import type { TrialBilling } from '@/components/billing/TrialBanner'

export const metadata = { title: 'Billing — National Wrench Index Suite\u2122' }

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type, foreman_addon_active, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const subscription = await getSubscription(user.id)
  const trialBilling = subscription?.status === 'trialing' && subscription.stripe_subscription_id
    ? await readTrialBilling(subscription.stripe_subscription_id)
    : null

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav workOrdersEnabled={profile.work_orders_enabled ?? false} businessName={profile.business_name} businessType={(profile as Record<string, unknown>).business_type as string | undefined} />
      <Suspense fallback={null}>
        <BillingClient
          subscription={subscription}
          plans={PLANS}
          foremanAddonActive={(profile as Record<string, unknown>).foreman_addon_active as boolean ?? false}
          businessType={(profile as Record<string, unknown>).business_type as string | undefined}
          trialBilling={trialBilling}
        />
      </Suspense>
    </div>
  )
}

// What Stripe will actually charge when the trial ends - its upcoming invoice, so a
// coupon or tax is included - and the trial end per Stripe. Either may come back null;
// the banner then says so rather than guessing a figure.
async function readTrialBilling(subscriptionId: string): Promise<TrialBilling> {
  const out: TrialBilling = { amountCents: null, currency: null, trialEnd: null }
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId)
    out.trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
  } catch (err) {
    console.error('[billing] trial subscription read failed:', err)
  }
  try {
    const inv = await stripe.invoices.retrieveUpcoming({ subscription: subscriptionId })
    out.amountCents = inv.amount_due
    out.currency    = inv.currency
  } catch (err) {
    console.error('[billing] upcoming invoice read failed:', err)
  }
  return out
}
