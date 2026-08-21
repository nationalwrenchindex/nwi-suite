import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { canViewCosts } from '@/types/fleet-pro'
import ReportsClient from '@/components/fleet-pro/ReportsClient'

export const metadata = { title: 'Reports — NWI Fleet Pro' }

// The layout already resolved membership and redirected anyone without one, but this
// page is nothing but cost data, so the role is re-checked here: a read-only viewer
// is bounced back to the fleet list before the shell renders, rather than being shown
// a page that would only fail with a 403 once its fetch landed.
export default async function FleetProReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/reports')

  const membership = await getFleetProMembership(user.id)
  if (!membership) redirect('/fleet-pro/no-access')
  if (!canViewCosts(membership.role)) redirect('/fleet-pro')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <ReportsClient />
    </main>
  )
}
