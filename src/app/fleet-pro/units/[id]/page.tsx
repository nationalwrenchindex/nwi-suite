import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import UnitDetailClient from '@/components/fleet-pro/UnitDetailClient'

export const metadata = { title: 'Unit — NWI Fleet Pro' }

// Background, nav and footer come from src/app/fleet-pro/layout.tsx.
//
// The membership gate here is a fast redirect for a logged-out or lapsed visitor;
// the authority on whether this particular unit belongs to the caller's fleet is
// GET /api/fleet-pro/units/[id], which re-checks on the service client.
export default async function FleetProUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/fleet-pro/units/${id}`)

  const gate = await requireFleetProMember(user.id)
  if (!gate.ok) redirect('/fleet-pro/no-access')

  return (
    <main className="flex-1 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <UnitDetailClient unitId={id} />
      </div>
    </main>
  )
}
