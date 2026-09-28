import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import AppNav from '@/components/layout/AppNav'
import DefectFollowUpList, { type DefectRow } from '@/components/inspections/DefectFollowUpList'

export const metadata = { title: 'Inspection Follow-Ups — National Wrench Index Suite™' }
export const dynamic = 'force-dynamic'

// ─── LD multi-point defects that did not take a vehicle out of service ─────────
//
// The LD twin of /hd/inspections/follow-ups, same component and same wording so the
// two read as one idea. The QUERY is different because the storage is: LD is the only
// family that keeps item results as rows, so this reads inspection_items directly
// instead of unpacking a JSONB payload.
//
// BOTH LD GRADES LAND HERE, and they mean different things:
//
//   fail             failed, and the tech answered No to out of service
//   needs_attention  LD's pre-existing middle grade — a deficiency, and it can NEVER
//                    drive out of service. Every stored value keeps the meaning it
//                    already had; the buttons are untouched.
//
// A fail whose out_of_service is TRUE is excluded: that is handled now, not chased.
// A fail whose out_of_service is NULL predates migration 141 and shows as "not
// assessed" rather than having an answer invented for it.

type ItemRow = {
  id: string
  point_name: string | null
  category: string | null
  status: string | null
  notes: string | null
  out_of_service?: boolean | null
  oos_note?: string | null
  inspection_id: string
}

const CATEGORY_LABEL: Record<string, string> = {
  fluids_engine:    'Fluids & Engine',
  tires_wheels:     'Tires & Wheels',
  brakes_underside: 'Brakes & Underside',
  lights_safety:    'Lights & Safety',
}

/** True when migration 141 has not been applied to this environment yet. */
function isMissingOosColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const m = String((error as { message?: unknown }).message ?? '').toLowerCase()
  return m.includes('out_of_service') &&
    (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'))
}

export default async function LdInspectionFollowUpsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, business_type, work_orders_enabled')
    .eq('id', user.id)
    .single()

  if (!profile?.business_name) redirect('/onboarding')

  // Scoped through the inspection, because inspection_items has no user_id of its own
  // — its RLS policy reaches through inspections.mechanic_id, and so does this.
  const { data: inspections } = await supabase
    .from('inspections')
    .select('id, created_at, completed_at, job_id')
    .eq('mechanic_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  const inspectionIds = (inspections ?? []).map(i => String(i.id))
  const dateById = new Map(
    (inspections ?? []).map(i => [
      String(i.id),
      String(i.completed_at ?? i.created_at ?? '').slice(0, 10) || null,
    ]),
  )

  let items: ItemRow[] = []
  if (inspectionIds.length > 0) {
    // The determination columns arrive with migration 141, which is applied by hand.
    // Selected optimistically and retried without them, so this page works in the
    // window between the deploy and the SQL — every defect then reads "not assessed",
    // which is exactly what it is.
    const full = await supabase
      .from('inspection_items')
      .select('id, point_name, category, status, notes, out_of_service, oos_note, inspection_id')
      .in('inspection_id', inspectionIds)
      .in('status', ['fail', 'needs_attention'])

    if (full.error && isMissingOosColumn(full.error)) {
      console.error('[ld inspection follow-ups] out_of_service missing — run migration 141')
      const legacy = await supabase
        .from('inspection_items')
        .select('id, point_name, category, status, notes, inspection_id')
        .in('inspection_id', inspectionIds)
        .in('status', ['fail', 'needs_attention'])
      items = (legacy.data ?? []) as unknown as ItemRow[]
    } else if (full.error) {
      console.error('[ld inspection follow-ups] load failed:', full.error.message)
    } else {
      items = (full.data ?? []) as unknown as ItemRow[]
    }
  }

  const rows: DefectRow[] = items
    // Out of service is handled now, not chased. Everything else belongs on the list.
    .filter(i => i.out_of_service !== true)
    .map(i => ({
      key:            i.id,
      inspectionId:   i.inspection_id,
      reference:      `MPI-${i.inspection_id.slice(0, 8).toUpperCase()}`,
      formLabel:      i.status === 'needs_attention' ? 'Multi-Point — attention' : 'Multi-Point — fail',
      inspectionDate: dateById.get(i.inspection_id) ?? null,
      unitLabel:      null,
      sectionLabel:   CATEGORY_LABEL[String(i.category ?? '')] ?? 'Inspection',
      label:          i.point_name ?? 'Checkpoint',
      notes:          String(i.notes ?? '').trim(),
      oosNote:        String(i.oos_note ?? '').trim(),
      // needs_attention is never asked the question, so it is not "unassessed" in the
      // sense of a missing answer — it simply cannot be out of service by definition.
      unassessed:     i.status === 'fail' && i.out_of_service == null,
      href:           `/intel?inspection=${i.inspection_id}`,
    }))

  return (
    <div className="min-h-screen bg-dark">
      <AppNav
        businessName={profile.business_name}
        businessType={profile.business_type ?? undefined}
        workOrdersEnabled={profile.work_orders_enabled ?? false}
      />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
              INSPECTION FOLLOW-UPS
            </h1>
            <p className="text-white/40 text-sm mt-1">
              Defects that did not take a vehicle out of service. Still needs doing, just
              not today.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="flex-shrink-0 px-4 py-2.5 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-white/30 text-sm font-semibold transition-colors"
          >
            Dashboard
          </Link>
        </div>

        <DefectFollowUpList rows={rows} />
      </main>
    </div>
  )
}
