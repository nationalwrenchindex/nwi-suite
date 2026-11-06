import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loadDocumentDefaults } from '@/lib/document-defaults.server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import AppNav from '@/components/layout/AppNav'
import QuickWrenchClient from '@/components/quickwrench/QuickWrenchClient'

export const metadata = { title: 'National Wrench Index QuickWrench™ — National Wrench Index Suite™' }

export default async function QuickWrenchPage({
  searchParams,
}: {
  searchParams: Promise<{ loadQuoteId?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  const p = profile as {
    business_name?: string
    business_type?: string
  }

  if (p.business_type === 'detailer') redirect('/dashboard')

  const hasQW = await hasQuickWrenchAccess(user.id)
  if (!hasQW) redirect('/dashboard?upsell=1')

  // The shop's document defaults, the one read every LD surface makes (lib/document-defaults).
  // An unset rate is 0 - this used to fall back to 125 / 20 / 8.5.
  const docDefaults = await loadDocumentDefaults(supabase, user.id)

  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav workOrdersEnabled={profile.work_orders_enabled ?? false} businessName={profile.business_name} businessType={p.business_type} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-lg bg-orange/15 border border-orange/30 flex items-center justify-center">
              <svg className="w-4 h-4 text-orange" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              National Wrench Index QuickWrench&#8482;
            </h1>
          </div>
          <p className="text-white/40 text-sm">
            VIN to customer quote in under 2 minutes. Parts · Specs · Quote.
          </p>
        </div>
        <QuickWrenchClient
          workOrdersEnabled={profile.work_orders_enabled ?? false}
          loadQuoteId={sp.loadQuoteId}
          defaultLaborRate={docDefaults.laborRate}
          defaultMarkupPct={docDefaults.markupPct}
          defaultTaxPct={docDefaults.taxPct}
        />
      </main>
    </div>
  )
}
