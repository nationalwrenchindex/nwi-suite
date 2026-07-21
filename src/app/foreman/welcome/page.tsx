import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import ForemanWelcomeClient from '@/components/foreman/ForemanWelcomeClient'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Welcome to Foreman' }

export default async function ForemanWelcomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, foreman_addon_active, torquewrench_addon_active')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')
  if (!profile.foreman_addon_active) redirect('/settings/foreman')

  const { data: foremanSettings } = await supabase
    .from('foreman_settings')
    .select('phone_number')
    .eq('user_id', user.id)
    .single()

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        foremanActive={profile.foreman_addon_active ?? false}
        torquewrenchActive={profile.torquewrench_addon_active ?? false}
      />
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-12">
        <ForemanWelcomeClient
          initialPhoneNumber={foremanSettings?.phone_number ?? null}
        />
      </main>
    </div>
  )
}
