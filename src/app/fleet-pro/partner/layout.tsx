import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensurePartner } from '@/lib/fleet-pro/partner-access'
import { FleetProWordmark, NWI_ORANGE } from '@/components/fleet-pro/brand'
import { PartnerNav } from '@/components/fleet-pro/partner/PartnerDashboardClient'

export const metadata = { title: 'Partner — NWI Fleet Pro' }

// The partner shell. Deliberately its own header rather than FleetProNav: that nav
// is keyed to one fleet and one membership role, and a partner has neither — he
// runs many fleets and is a member of none of them.
//
// NOTE: this layout nests inside src/app/fleet-pro/layout.tsx, which redirects
// anyone without a fleet MEMBERSHIP to /fleet-pro/no-access. A child layout cannot
// undo a parent redirect, so the parent needs a bypass for /fleet-pro/partner/*.
export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?redirect=/fleet-pro/partner')

  // Get-or-create: any HD mechanic who opens this console is by definition about to
  // resell, so a first visit provisions the partner row instead of dead-ending.
  // Null means the insert genuinely failed — send them back to their own app.
  const partner = await ensurePartner(user.id)
  if (!partner) redirect('/dashboard')

  return (
    <div className="min-h-dvh flex flex-col" style={{ background: '#0a0f14' }}>
      <header className="sticky top-0 z-40" style={{ background: '#111920', borderBottom: '1px solid #1e3040' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-4 h-14">
            <div className="min-w-0">
              <FleetProWordmark className="block text-[10px] uppercase tracking-widest leading-none font-semibold" />
              <p className="font-condensed font-bold text-white text-lg leading-tight truncate">
                {partner.partner_name}
              </p>
            </div>

            <PartnerNav partnerName={partner.partner_name} />

            <span
              className="hidden sm:inline text-xs font-medium px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ background: `${NWI_ORANGE}20`, color: NWI_ORANGE }}
            >
              Partner
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 min-w-0 flex flex-col">{children}</div>

      <footer
        className="px-4 sm:px-6 py-4 text-center"
        style={{ background: '#111920', borderTop: '1px solid #1e3040' }}
      >
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          NWI Fleet Pro — partner console. Cost basis and margin shown here never appear in a customer portal.
        </p>
      </footer>
    </div>
  )
}
