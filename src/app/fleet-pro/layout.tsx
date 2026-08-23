import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import { getPartner } from '@/lib/fleet-pro/partner-access'
import FleetProNav from '@/components/fleet-pro/FleetProNav'

export const metadata = { title: 'Fleet Pro — National Wrench Index' }

// Membership and partnership are disjoint: a partner resells fleets, he is not a
// member of them. So this layout has to admit both, and admit them differently.
//   - accept-invite renders bare (the visitor has no session yet)
//   - /fleet-pro/partner/* is the partner's own surface with its own nested shell
//   - a member gets the branded member shell
//   - a partner viewing a customer's unit page gets a plain shell, NOT the member
//     nav — that nav is scoped to one fleet and he is looking across many
//   - anyone else -> /fleet-pro/no-access
export default async function FleetProLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? ''

  if (pathname.startsWith('/fleet-pro/accept-invite')) {
    return <div className="min-h-dvh" style={{ background: '#0a0f14' }}>{children}</div>
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro')

  // The partner section supplies its own background and nav. Passing children
  // straight through avoids a doubled shell and lets that layout own its gating.
  if (pathname.startsWith('/fleet-pro/partner')) return <>{children}</>

  const membership = await getFleetProMembership(user.id)

  if (!membership) {
    if (pathname.startsWith('/fleet-pro/no-access')) {
      return <div className="min-h-dvh" style={{ background: '#0a0f14' }}>{children}</div>
    }

    // Without this a partner opening one of his own customers' unit pages is bounced
    // to no-access, because he has no membership anywhere.
    const partner = await getPartner(user.id)
    if (partner) {
      return (
        <div className="min-h-dvh flex flex-col" style={{ background: '#0a0f14' }}>
          <div className="flex-1 min-w-0 flex flex-col">{children}</div>
        </div>
      )
    }

    redirect('/fleet-pro/no-access')
  }

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#0a0f14' }}>
      <FleetProNav fleetName={membership.fleet_name} role={membership.role} />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      <footer
        className="px-4 sm:px-6 py-4 text-center"
        style={{ background: '#111920', borderTop: '1px solid #1e3040' }}
      >
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          NWI Fleet Pro — service records provided by your maintenance contractor.
        </p>
      </footer>
    </div>
  )
}
