import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import PartsFinder from '@/components/parts/PartsFinder'

export const metadata = { title: 'Parts Catalog - National Wrench Index Suite' }

// SCREEN 1: the parts list. Searchable by number, description or unit; filtered by
// type; showing on hand, bin, cost and a verified badge on every row.
//
// Lives at /parts/catalog, NOT /parts. /parts is the LD "Live Parts Pricing - coming
// soon" placeholder, which advertises live vendor pricing and nearby store
// availability - the parts-delivery flow, a different feature from this catalog. This
// page was briefly written over that placeholder; it is here instead so the promise on
// /parts is not quietly replaced by something that does not keep it.
export default async function PartsPage() {
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
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">PARTS</h1>
            <p className="text-white/40 text-sm">
              Search by number, description or unit. Every row says whether its fitment has been verified.
            </p>
          </div>
          <Link href="/parts/find" className="btn-ghost px-4 py-2">Find parts by unit</Link>
        </div>

        <PartsFinder mode="catalog" markupPercent={markup} />
      </main>
    </div>
  )
}
