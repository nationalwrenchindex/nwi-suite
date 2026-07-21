import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import ImportClient from '@/components/settings/ImportClient'

export const metadata = { title: 'Import Data' }

export default async function ImportPage() {
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
      <AppNav
        businessName={profile.business_name ?? ''}
        businessType={profile.business_type ?? undefined}
      />
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Settings</p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">IMPORT DATA</h1>
          <p className="text-white/40 text-sm mt-2">
            Migrate your customers, vehicles, and job history from QuickBooks, Wave, FreshBooks, Square, or any CSV export.
          </p>
        </div>
        <ImportClient />
      </main>
    </div>
  )
}
