import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import IntelClient from '@/components/intel/IntelClient'
import { getModuleAccess } from '@/lib/subscription'

export const metadata = { title: 'Intel Hub — National Wrench Index Suite\u2122' }

export default async function IntelPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type, slug')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const modules = await getModuleAccess(user.id)
  if (!modules.includes('intel')) redirect('/billing?required=intel')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} businessType={(profile as Record<string, unknown>).business_type as string | undefined} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            INTEL HUB
          </h1>
          <p className="text-white/40 text-sm">
            Customer profiles, vehicle history, VIN decoder &amp; service alerts.
          </p>
        </div>
        <IntelClient slug={(profile as Record<string, unknown>).slug as string | undefined} />
      </main>
    </div>
  )
}
