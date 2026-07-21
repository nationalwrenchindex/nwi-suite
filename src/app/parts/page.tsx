import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'

export const metadata = { title: 'Parts Lookup' }

export default async function PartsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} businessType={profile.business_type ?? undefined} />
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8">

        {/* Page header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center text-lg leading-none">
              🔧
            </div>
            <p className="text-white/40 text-xs uppercase tracking-widest">Parts Lookup</p>
          </div>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            LIVE PARTS PRICING
          </h1>
        </div>

        {/* Coming Soon card */}
        <div className="nwi-card">

          {/* Badge */}
          <div className="mb-5">
            <span
              className="text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide"
              style={{
                background: 'rgba(255,102,0,0.15)',
                color: '#16a34a',
                border: '1px solid rgba(255,102,0,0.3)',
              }}
            >
              Coming Soon
            </span>
          </div>

          {/* Heading */}
          <h2 className="font-condensed font-bold text-2xl text-white tracking-wide mb-3">
            Live Parts Pricing — Coming Soon
          </h2>

          {/* Body */}
          <p className="text-white/60 text-sm leading-relaxed mb-6">
            Real-time parts pricing and availability from major suppliers — integrated directly into your repair workflow.
            Search by VIN, get verified part numbers, and order from the supplier nearest to your location.
          </p>

          {/* Features list */}
          <div className="mb-6">
            <p className="text-white/30 text-[11px] uppercase tracking-widest mb-3">Features coming soon</p>
            <ul className="space-y-2.5">
              {[
                '17 million verified part numbers powered by Epicor PartExpert',
                'Live pricing from AutoZone, O\'Reilly, NAPA, and more',
                'Nearest store availability by your current location',
                'One tap to add parts directly to your quote',
                'O\'Reilly Auto Parts integration arriving Q3 2026',
              ].map(feature => (
                <li key={feature} className="flex items-start gap-2.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5"
                    style={{ background: '#16a34a' }}
                  />
                  <span className="text-white/55 text-sm leading-snug">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Divider */}
          <div className="border-t border-dark-border pt-5">
            <p className="text-white/30 text-xs leading-relaxed">
              In the meantime — search parts at{' '}
              <span className="text-white/55">oreillyauto.com</span>,{' '}
              <span className="text-white/55">autozone.com</span>, or{' '}
              <span className="text-white/55">napaonline.com</span>{' '}
              using your decoded VIN for fitment accuracy.
            </p>
          </div>

        </div>
      </main>
    </div>
  )
}
