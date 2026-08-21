import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { canManageMembers } from '@/types/fleet-pro'
import TeamClient from '@/components/fleet-pro/TeamClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Team — NWI Fleet Pro' }

// The layout has already established that a live membership exists; this page only
// has to answer the second question — is this person the manager. Supervisors and
// viewers are bounced rather than shown a disabled roster, because the roster is
// where the fleet's staff emails live.
export default async function FleetProTeamPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/team')

  const membership = await getFleetProMembership(user.id)
  if (!membership) redirect('/fleet-pro/no-access')
  if (!canManageMembers(membership.role)) redirect('/fleet-pro')

  return <TeamClient fleetName={membership.fleet_name} />
}
