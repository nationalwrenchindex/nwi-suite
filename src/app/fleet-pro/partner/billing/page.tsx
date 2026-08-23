import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPartner } from '@/lib/fleet-pro/partner-access'
import PartnerBillingClient from '@/components/fleet-pro/partner/PartnerBillingClient'

export const metadata = { title: 'Billing — NWI Fleet Pro Partner' }

// getPartner rather than ensurePartner: this page shows what a reseller owes, so a
// visitor who is not one yet should never have a partner row minted as a side effect
// of opening it. The dashboard is where that happens.
//
// No background is set here — the partner layout owns the #0a0f14 ground and the nav.
export default async function PartnerBillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/partner/billing')

  const partner = await getPartner(user.id)
  if (!partner) redirect('/fleet-pro/no-access')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <PartnerBillingClient />
    </main>
  )
}
