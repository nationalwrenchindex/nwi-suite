import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'

export const metadata = { title: 'Welcome to Foreman — National Wrench Index Suite™' }

export default async function ForemanWelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={profile.foreman_addon_active ?? false}
      />
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="max-w-md w-full text-center space-y-6">

          <div className="w-20 h-20 rounded-2xl bg-orange/15 border border-orange/30 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-orange" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
          </div>

          <div>
            <h1 className="font-condensed font-bold text-4xl text-white tracking-wide mb-2">
              Foreman is Active
            </h1>
            <p className="text-white/50 text-base leading-relaxed">
              Your AI receptionist is ready. Set it up with your business details and working hours — it takes about 5 minutes.
            </p>
          </div>

          <div className="space-y-2 text-left nwi-card">
            {[
              'Add your business name and hours',
              'Your dedicated phone number gets provisioned',
              'Forward your calls — Foreman handles the rest',
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
              href="/settings/foreman"
              className="flex items-center justify-center gap-2 px-8 py-3 bg-orange hover:bg-orange-hover text-white font-condensed font-bold text-sm rounded-xl transition-colors active:scale-95 min-h-[48px]"
            >
              Set Up Foreman
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <line x1="5" y1="12" x2="19" y2="12"/>
                <polyline points="12 5 19 12 12 19"/>
              </svg>
            </Link>
            <Link
              href="/foreman"
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
