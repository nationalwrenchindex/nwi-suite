import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getFleetProMembership } from '@/lib/fleet-pro/access'
import FleetProNav from '@/components/fleet-pro/FleetProNav'

export const metadata = { title: 'Fleet Pro — National Wrench Index' }

// Three-way, mirroring src/app/hd/layout.tsx:
//   - accept-invite renders bare (the visitor has no session yet)
//   - signed in without an active membership -> /fleet-pro/no-access
//   - signed in with a membership -> full shell
export default async function FleetProLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get('x-pathname') ?? ''

  if (pathname.startsWith('/fleet-pro/accept-invite')) {
    return <div className="min-h-dvh" style={{ background: '#0a0f14' }}>{children}</div>
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro')

  const membership = await getFleetProMembership(user.id)

  if (!membership) {
    if (pathname.startsWith('/fleet-pro/no-access')) {
      return <div className="min-h-dvh" style={{ background: '#0a0f14' }}>{children}</div>
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
