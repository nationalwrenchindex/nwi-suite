import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import ComplianceClient from '@/components/fleet-pro/ComplianceClient'

export const metadata = { title: 'DOT & Compliance — Fleet Pro' }
export const dynamic  = 'force-dynamic'

// The layout already gates the section; this resolves the membership again only to
// hand the client its role, which decides read-only vs. editable. Exactly what
// /fleet-pro/pm does — the role is a hint for the UI, and every route re-checks it.
export default async function FleetProCompliancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/compliance')

  const membership = await getFleetProMembership(user.id)
  if (!membership) redirect('/fleet-pro/no-access')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <ComplianceClient role={membership.role} />
    </main>
  )
}
