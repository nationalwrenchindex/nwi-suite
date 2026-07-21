import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasTorqueWrenchAccess } from '@/lib/subscription'
import AppNav from '@/components/layout/AppNav'
import TorqueWrenchSettingsClient from '@/components/torquewrench/TorqueWrenchSettingsClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'TorqueWrench Settings' }

export default async function TorqueWrenchSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const torquewrenchActive = await hasTorqueWrenchAccess(user.id)

  let initialSettings = null
  if (torquewrenchActive) {
    const { data } = await supabase
      .from('torquewrench_settings')
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
        foremanActive={profile.foreman_addon_active ?? false}
        torquewrenchActive={torquewrenchActive}
      />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-white/40 text-xs uppercase tracking-widest">Settings</p>
            <span className="text-white/20 text-xs">/</span>
            <p className="text-orange text-xs uppercase tracking-widest font-medium">TorqueWrench</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
            </div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">TORQUEWRENCH</h1>
          </div>
          <p className="text-white/40 text-sm mt-1">Automatic Google review collection</p>
        </div>

        <TorqueWrenchSettingsClient
          torquewrenchActive={torquewrenchActive}
          businessName={profile.business_name}
          initialSettings={initialSettings}
        />
      </main>
    </div>
  )
}
