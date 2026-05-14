import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import ForemanSettingsClient from '@/components/foreman/ForemanSettingsClient'

export const metadata = { title: 'Foreman Settings — National Wrench Index Suite™' }

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
    .select('business_name, business_type, foreman_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const foremanActive = profile?.foreman_addon_active ?? false

  let initialSettings = null
  if (foremanActive) {
    const { data } = await supabase
      .from('foreman_settings')
      .select('*')
      .eq('user_id', user.id)
      .single()
    initialSettings = data ?? null
  }

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={foremanActive}
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
          <p className="text-white/40 text-sm mt-1">AI virtual receptionist add-on</p>
        </div>

        <ForemanSettingsClient
          foremanActive={foremanActive}
          businessName={profile.business_name}
          businessType={profile.business_type ?? undefined}
          initialSettings={initialSettings}
          canceledFlow={sp.canceled === 'true'}
        />
      </main>
    </div>
  )
}
