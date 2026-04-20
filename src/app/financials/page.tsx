import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import FinancialsClient from '@/components/financials/FinancialsClient'
import { getModuleAccess } from '@/lib/subscription'

export const metadata = { title: 'Financials — National Wrench Index Suite\u2122' }

export default async function FinancialsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const modules = await getModuleAccess(user.id)
  if (!modules.includes('financials')) redirect('/billing?required=financials')

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav businessName={profile.business_name} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            FINANCIALS
          </h1>
          <p className="text-white/40 text-sm">
            Invoices, expenses &amp; monthly profit overview.
          </p>
        </div>
        <FinancialsClient />
      </main>
    </div>
  )
}
