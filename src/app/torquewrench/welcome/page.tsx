import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'

export const metadata = { title: 'Welcome to TorqueWrench' }

export default async function TorqueWrenchWelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={profile.foreman_addon_active ?? false}
        torquewrenchActive={profile.torquewrench_addon_active ?? false}
      />
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="max-w-md w-full text-center space-y-6">

          <div className="w-20 h-20 rounded-2xl bg-orange/15 border border-orange/30 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-orange" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </div>

          <div>
            <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
              TorqueWrench is Active
            </h1>
            <p className="text-white/50 text-base leading-relaxed">
              Automatically collect Google reviews after every job — no chasing customers, no manual follow-up.
            </p>
          </div>

          <div className="space-y-2 text-left nwi-card">
            {[
              'Add your Google Place ID so we know where to send customers',
              'TorqueWrench texts a review link minutes after each job closes',
              'Low ratings trigger a service recovery alert so you can make it right first',
            ].map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-orange/15 border border-orange/30 flex items-center justify-center font-condensed font-bold text-orange text-xs flex-shrink-0">
                  {i + 1}
                </span>
                <p className="text-white/70 text-sm">{step}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/settings/torquewrench"
              className="flex items-center justify-center gap-2 px-8 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
            >
              Set Up TorqueWrench
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </Link>
            <Link
              href="/torquewrench"
              className="flex items-center justify-center gap-2 px-6 py-3 border border-dark-border hover:border-white/20 text-white/50 hover:text-white text-sm font-medium rounded-xl transition-colors min-h-[48px]"
            >
              View Dashboard
            </Link>
          </div>

        </div>
      </main>
    </div>
  )
}
