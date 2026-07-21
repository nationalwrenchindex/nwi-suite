import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import { PLANS } from '@/lib/stripe-plans'
import { getSubscription } from '@/lib/subscription'

export const metadata = { title: 'Upgrade' }

const FEATURE_TO_TIER: Record<string, string> = {
  intel:        'pro',
  financials:   'full_suite',
  quickwrench:  'quickwrench',
  torquewrench: 'full_suite_plus',
  foreman:      '',
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const sub           = await getSubscription(user.id)
  const currentTier   = sub?.tier ?? null
  const from          = sp.from ?? ''
  const highlightTier = FEATURE_TO_TIER[from] ?? ''

  // If they clicked the Foreman lock, send them directly to Foreman settings
  if (from === 'foreman') redirect('/settings/foreman')

  const displayPlans = PLANS

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={profile.foreman_addon_active ?? false}
        torquewrenchActive={profile.torquewrench_addon_active ?? false}
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-10">

        <div className="text-center mb-10">
          <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
            UNLOCK MORE OF NWI SUITE
          </h1>
          {from && (
            <p className="text-white/40 text-sm">
              Choose a plan that includes{' '}
              <span className="text-orange font-medium capitalize">{from.replace('_', ' ')}</span>
            </p>
          )}
          {currentTier && (
            <p className="text-white/30 text-xs mt-2">
              Current plan: <span className="text-white/60 capitalize">{currentTier.replace('_', ' ')}</span>
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {displayPlans.map(plan => {
            const isCurrent   = plan.tier === currentTier
            const isHighlight = plan.tier === highlightTier
            return (
              <div
                key={plan.tier}
                className={`nwi-card flex flex-col transition-colors ${
                  isHighlight
                    ? 'border-orange/50 bg-orange/5'
                    : isCurrent
                    ? 'border-green-500/30 bg-green-500/5'
                    : 'border-dark-border'
                }`}
              >
                {plan.badge && (
                  <span className={`self-start text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded mb-3 ${
                    isHighlight ? 'bg-orange/20 text-orange' : 'bg-white/10 text-white/50'
                  }`}>
                    {plan.badge}
                  </span>
                )}

                <p className="font-condensed font-bold text-2xl text-white tracking-wide">{plan.name}</p>
                <p className="font-condensed font-bold text-3xl text-orange mt-1">
                  ${(plan.price / 100).toFixed(0)}<span className="text-white/30 text-base font-normal">/mo</span>
                </p>

                <ul className="space-y-2 mt-4 flex-1">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2 text-sm text-white/60">
                      <svg className="w-3.5 h-3.5 text-orange flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-5 pt-4 border-t border-dark-border">
                  {isCurrent ? (
                    <span className="block text-center text-green-400 text-sm font-medium py-2">
                      ✓ Current plan
                    </span>
                  ) : (
                    <Link
                      href="/billing"
                      className={`block text-center px-4 py-2.5 rounded-xl text-sm font-condensed font-bold transition-colors active:scale-95 ${
                        isHighlight
                          ? 'bg-orange hover:bg-orange-hover text-white'
                          : 'border border-dark-border hover:border-white/20 text-white/60 hover:text-white'
                      }`}
                    >
                      {isHighlight ? 'Upgrade Now' : 'Select Plan'}
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        <div className="mt-8 text-center">
          <p className="text-white/30 text-sm">
            Want the Foreman AI Receptionist add-on?{' '}
            <Link href="/settings/foreman" className="text-orange hover:underline">
              Add Foreman ($59/mo) →
            </Link>
          </p>
        </div>

      </main>
    </div>
  )
}
