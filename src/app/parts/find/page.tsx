import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import PartsFinder from '@/components/parts/PartsFinder'

export const metadata = { title: 'Find parts by unit - National Wrench Index Suite' }

// SCREEN 3: pick make, model, optional serial, then part type. Returns a LIST with the
// detail that distinguishes each row - never one confident answer.
export default async function FindPartsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled, default_parts_markup_percent')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  // default_parts_markup_percent, NOT parts_markup_percent: the latter does not exist
  // on profiles, and selecting it returns an error rather than a row - which made this
  // page redirect every visitor to /onboarding.
  const markupRaw = (profile as Record<string, unknown>).default_parts_markup_percent
  const markup = typeof markupRaw === 'number' ? markupRaw : 20
  return (
    <div className="min-h-dvh bg-dark flex flex-col">
      <AppNav
        workOrdersEnabled={profile.work_orders_enabled ?? false}
        businessName={profile.business_name}
        businessType={(profile as Record<string, unknown>).business_type as string | undefined}
      />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">FIND PARTS BY UNIT</h1>
            <p className="text-white/40 text-sm">
              A Carrier unit never returns a Thermo King part, and a part that fits
              everything is not an answer to what fits this one.
            </p>
          </div>
          <Link href="/parts/catalog" className="btn-ghost px-4 py-2">All parts</Link>
        </div>

        <PartsFinder mode="unit" markupPercent={markup} />
      </main>
    </div>
  )
}
