import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePartner } from '@/lib/fleet-pro/partner-access'
import AccountDetailClient from '@/components/fleet-pro/partner/AccountDetailClient'

export const metadata = { title: 'Account — NWI Fleet Pro Partner' }

// Background and nav come from src/app/fleet-pro/partner/layout.tsx.
//
// The partner gate here is a fast redirect for a logged-out or non-reselling
// visitor. The authority on whether THIS account belongs to THIS partner is
// GET /api/fleet-pro/partner/accounts/[accountId]/detail, which re-checks with
// partnerOwnsAccount on the service client before it reads a single row.
export default async function PartnerAccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/fleet-pro/partner/${accountId}`)

  const gate = await requirePartner(user.id)
  if (!gate.ok) redirect('/fleet-pro/no-access')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <AccountDetailClient accountId={accountId} />
      </div>
    </main>
  )
}
