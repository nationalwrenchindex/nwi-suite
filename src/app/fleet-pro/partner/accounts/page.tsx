import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensurePartner } from '@/lib/fleet-pro/partner-access'
import AccountsClient from '@/components/fleet-pro/partner/AccountsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Fleet Accounts — NWI Fleet Pro Partner' }

// The partner layout supplies the ground (#0a0f14) and the nav, so this page sets
// neither. The gate is still re-checked here rather than trusted from the layout —
// a layout is not a security boundary, and React may begin rendering this page
// before the layout's own await has settled.
//
// ensurePartner rather than requirePartner for exactly that reason: it is the same
// get-or-create the layout runs, so a mechanic's first visit cannot lose the race
// and bounce itself out of a console the layout was in the middle of provisioning.
// The API routes this page calls all gate with requirePartner.
export default async function PartnerAccountsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/partner/accounts')

  const partner = await ensurePartner(user.id)
  if (!partner) redirect('/dashboard')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <AccountsClient partnerName={partner.partner_name} />
    </main>
  )
}
