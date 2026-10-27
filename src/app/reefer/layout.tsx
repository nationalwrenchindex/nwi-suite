import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { hdAccessAllowed } from '@/lib/hd-access'
import { isReeferStandaloneRow } from '@/lib/reefer-standalone'
import HDNav from '@/components/hd/HDNav'
import LegalAcceptanceGate from '@/components/legal/LegalAcceptanceGate'
import HDTrademarkFooter from '@/components/hd/HDTrademarkFooter'
import { provisionHdFromCheckoutSession } from '@/lib/hd-provision'

export const metadata = { title: 'NWI Reefer' }

// The /reefer product (src/lib/reefer-standalone.ts). Every page under here re-exports
// the matching /hd page; this layout is what makes it Reefer:
// - Signed out, or on /reefer/login and /reefer/signup: bare background, no nav.
// - A live reefer_standalone subscription: HDNav in its reefer variant (only the screens
//   Reefer carries), the same trademark footer.
// - An HD subscriber: sent back to /hd with ?leave_reefer=1, which clears the surface
//   cookie so their /hd links stop coming here.
// - Anyone else (no subscription yet, lapsed, LD-only): /reefer/signup.
// The middleware has already refused any /reefer path that is not a reefer screen.
export default async function ReeferLayout({ children }: { children: React.ReactNode }) {
  const bare = (
    <div className="min-h-dvh" style={{ background: 'var(--hd-bg)' }}>
      {children}
    </div>
  )

  const h = await headers()
  const pathname = h.get('x-pathname') ?? ''
  if (pathname.startsWith('/reefer/login') || pathname.startsWith('/reefer/signup')) return bare

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return bare

  // Back from Stripe: provision from the session BEFORE gating, or a buyer who beat the
  // webhook would be bounced to signup from the dashboard they just paid for. The same
  // helper /hd/dashboard uses; it checks the session belongs to this user.
  const checkoutSession = h.get('x-reefer-checkout-session')
  if (checkoutSession) {
    const provisioned = await provisionHdFromCheckoutSession(user.id, checkoutSession)
    if (!provisioned.ok) console.error('[reefer/layout] checkout provisioning skipped:', provisioned.reason)
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('tier, status, is_comped, vertical')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!isReeferStandaloneRow(sub)) {
    if (sub && hdAccessAllowed(sub)) redirect('/hd/dashboard?leave_reefer=1')
    redirect('/reefer/signup')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name')
    .eq('id', user.id)
    .single()

  return (
    <div className="min-h-dvh flex flex-col md:flex-row" style={{ background: 'var(--hd-bg)' }}>
      <LegalAcceptanceGate />
      <HDNav businessName={profile?.business_name ?? undefined} variant="reefer" />
      <div className="flex-1 min-w-0 flex flex-col">
        {children}
        <HDTrademarkFooter />
      </div>
    </div>
  )
}
