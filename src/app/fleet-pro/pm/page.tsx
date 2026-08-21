import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import PmScheduleClient from '@/components/fleet-pro/PmScheduleClient'

export const metadata = { title: 'PM Schedule — Fleet Pro' }
export const dynamic  = 'force-dynamic'

// The layout already gates the section; this resolves the membership again only
// to hand the client its role, which decides read-only vs. editable.
export default async function FleetProPmPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/pm')

  const membership = await getFleetProMembership(user.id)
  if (!membership) redirect('/fleet-pro/no-access')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <PmScheduleClient role={membership.role} />
    </main>
  )
}
