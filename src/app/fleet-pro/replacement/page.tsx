import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { canViewCosts } from '@/types/fleet-pro'
import ReplacementClient from '@/components/fleet-pro/ReplacementClient'

export const metadata = { title: 'Replacement Review — NWI Fleet Pro' }

// The layout already resolved membership and redirected anyone without one, but this
// page is nothing but cost data — repair spend against asset value — so the role is
// re-checked here exactly as /fleet-pro/reports does it. A read-only viewer is bounced
// back to the fleet list before the shell renders, rather than being shown a page that
// would only fail with the API's 403 once its fetch landed.
export default async function FleetProReplacementPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/replacement')

  const membership = await getFleetProMembership(user.id)
  if (!membership) redirect('/fleet-pro/no-access')
  if (!canViewCosts(membership.role)) redirect('/fleet-pro')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <ReplacementClient />
    </main>
  )
}
