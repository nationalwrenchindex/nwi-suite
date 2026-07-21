import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import ForemanSettingsClient from '@/components/foreman/ForemanSettingsClient'
import { isForemanAvailable } from '@/lib/foreman/cap'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Foreman Settings' }

export default async function ForemanSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ canceled?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('email, business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const foremanActive = profile?.foreman_addon_active ?? false

  const [initialSettings, capAvailable] = await Promise.all([
    foremanActive
      ? supabase
          .from('foreman_settings')
          .select('*')
          .eq('user_id', user.id)
          .single()
          .then(({ data }) => data
            ? {
                ...data,
                working_hours_start: data.working_hours_start ? String(data.working_hours_start).slice(0, 5) : '08:00',
                working_hours_end:   data.working_hours_end   ? String(data.working_hours_end).slice(0, 5)   : '18:00',
              }
            : null,
          )
      : Promise.resolve(null),
    !foremanActive ? isForemanAvailable() : Promise.resolve(true),
  ])

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={foremanActive}
        torquewrenchActive={profile.torquewrench_addon_active ?? false}
      />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-white/40 text-xs uppercase tracking-widest">Settings</p>
            <span className="text-white/20 text-xs">/</span>
            <p className="text-orange text-xs uppercase tracking-widest font-medium">Foreman</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.44 2 2 0 0 1 3.6 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            </div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FOREMAN</h1>
          </div>
          <p className="text-white/40 text-sm mt-1">AI virtual receptionist add-on · $59/mo</p>
        </div>

        <ForemanSettingsClient
          foremanActive={foremanActive}
          businessName={profile.business_name}
          businessType={profile.business_type ?? undefined}
          initialSettings={initialSettings}
          canceledFlow={sp.canceled === 'true'}
          capAvailable={capAvailable}
          userEmail={profile.email ?? ''}
        />
      </main>
    </div>
  )
}
