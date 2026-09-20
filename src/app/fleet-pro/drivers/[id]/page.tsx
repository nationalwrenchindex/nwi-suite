import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { getPartner } from '@/lib/fleet-pro/partner-access'
import DriverDetailClient from '@/components/fleet-pro/DriverDetailClient'

export const metadata = { title: 'Driver — NWI Fleet Pro' }

// Background, nav and footer come from src/app/fleet-pro/layout.tsx.
//
// Same shape as the unit detail page: the membership gate here is a fast redirect for
// a logged-out or lapsed visitor, and the authority on whether THIS DRIVER belongs to
// the caller's fleet is GET /api/fleet-pro/drivers/[id]/detail, which re-checks on the
// service client. Partners are admitted for the same reason they are on units —
// running the compliance service is what they sell, and migration 131's partner
// policy already lets them read the roster.
export default async function FleetProDriverPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/fleet-pro/drivers/${id}`)

  const gate = await requireFleetProMember(user.id)
  if (!gate.ok) {
    const partner = await getPartner(user.id)
    if (!partner) redirect('/fleet-pro/no-access')
  }

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <DriverDetailClient driverId={id} />
      </div>
    </main>
  )
}
