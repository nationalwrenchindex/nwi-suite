import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import DefectFollowUpList, { type DefectRow } from '@/components/inspections/DefectFollowUpList'
import { splitFailures } from '@/lib/inspections/out-of-service'
import { INSPECTION_CATEGORIES, CATEGORY_ITEMS } from '@/lib/hd/dot-categories'
import { AERIAL_FORMS, AERIAL_TYPE_LABEL } from '@/lib/hd/aerial/forms'
import { EQUIPMENT_FORMS, EQUIPMENT_TYPE_LABEL } from '@/lib/hd/equipment/forms'
import type { AerialInspectionType } from '@/types/aerial'
import type { EquipmentType } from '@/types/equipment'

export const metadata = { title: 'Inspection Follow-Ups — NWI HD Suite' }
export const dynamic = 'force-dynamic'

// ─── Defects that did not take a unit out of service ──────────────────────────
// Reads the item states out of each family's JSONB payload and runs the same
// splitFailures the printed document uses, so the list and the paperwork can never
// disagree about which bucket a defect is in.
//
// Deliberately NOT sharing /work-orders/follow-ups: that query is segment-shaped and
// hard-codes ld_work_order_id. See the header of DefectFollowUpList.

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** One family's rows, collapsed into defect rows. */
function collect(
  rows: Row[],
  opts: {
    sectionsFor: (row: Row) => Array<{ id: string; label: string; items: Array<{ id: string; label: string; autoOos?: boolean }> }>
    payloadKey:  'inspection_data' | 'checklist_data'
    formLabel:   (row: Row) => string
    href:        (row: Row) => string
    refPrefix:   string
  },
): DefectRow[] {
  const out: DefectRow[] = []
  for (const row of rows) {
    const sections = opts.sectionsFor(row)
    if (sections.length === 0) continue
    const payload = (row[opts.payloadKey] ?? {}) as { sections?: Record<string, { items?: Record<string, unknown> }> }
    // DOT stores categories at the top level; aerial and equipment nest under
    // `sections`. Both shapes are handled rather than assumed.
    const bag = (payload.sections ?? payload) as Record<string, { items?: Record<string, unknown> }>

    const failures = splitFailures(
      sections,
      // Keyed by the SECTION'S OWN ID, never by payload key order. A stored payload
      // is an object and its key order is not a contract; indexing into it would
      // silently read the wrong section on any record that serialised differently.
      (si, item) => (bag[sections[si].id]?.items?.[item.id] ?? undefined) as never,
    )

    const id  = String(row.id)
    const ref = str(row.inspection_id) ?? `${opts.refPrefix}-${id.slice(0, 8).toUpperCase()}`
    const unit = [str(row.unit_identifier), str(row.unit_make), str(row.unit_model)]
      .filter(Boolean).join(' ') || null

    for (const [bucket, unassessed] of [[failures.repairs, false], [failures.unassessed, true]] as const) {
      for (const f of bucket) {
        out.push({
          key:            `${id}:${f.itemId}`,
          inspectionId:   id,
          reference:      ref,
          formLabel:      opts.formLabel(row),
          inspectionDate: str(row.inspection_date),
          unitLabel:      unit,
          sectionLabel:   f.sectionLabel,
          label:          f.label,
          notes:          f.notes,
          oosNote:        f.oosNote,
          unassessed,
          href:           opts.href(row),
        })
      }
    }
  }
  return out
}

export default async function InspectionFollowUpsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')
  if (!await checkHDAccess(user.id)) redirect('/hd/dashboard')

  // Only failing inspections can carry a defect, so the read is filtered rather than
  // pulling every record and discarding most of them.
  const [dotRes, aerialRes, equipRes] = await Promise.all([
    supabase.from('hd_dot_inspections')
      .select('id, inspection_id, inspection_date, inspection_data, unit_identifier, unit_make, unit_model')
      .eq('user_id', user.id).eq('overall_result', 'fail')
      .order('inspection_date', { ascending: false }).limit(200),
    supabase.from('hd_aerial_inspections')
      .select('id, inspection_id, inspection_type, inspection_date, inspection_data, unit_identifier, unit_make, unit_model')
      .eq('user_id', user.id).eq('overall_result', 'fail')
      .order('inspection_date', { ascending: false }).limit(200),
    supabase.from('hd_equipment_inspections')
      .select('id, inspection_id, equipment_type, inspection_date, inspection_data, unit_identifier, unit_make, unit_model')
      .eq('user_id', user.id).eq('overall_result', 'fail')
      .order('inspection_date', { ascending: false }).limit(200),
  ])

  // A family that fails to load is logged and skipped. A page that shows three of four
  // lists beats a page that shows an error.
  for (const [name, res] of [['dot', dotRes], ['aerial', aerialRes], ['equipment', equipRes]] as const) {
    if (res.error) console.error(`[inspection follow-ups] ${name} load failed:`, res.error.message)
  }

  const rows: DefectRow[] = [
    ...collect((dotRes.data ?? []) as Row[], {
      sectionsFor: () => INSPECTION_CATEGORIES.map(c => ({ id: c.id, label: c.label, items: CATEGORY_ITEMS[c.id] ?? [] })),
      payloadKey:  'inspection_data',
      formLabel:   () => 'DOT Annual',
      href:        r => `/hd/dot-inspections/${String(r.id)}`,
      refPrefix:   'DOT',
    }),
    ...collect((aerialRes.data ?? []) as Row[], {
      sectionsFor: r => {
        const t = (str(r.inspection_type) ?? 'pre_use') as AerialInspectionType
        return (AERIAL_FORMS[t] ?? AERIAL_FORMS.pre_use).sections
      },
      payloadKey:  'inspection_data',
      formLabel:   r => `Aerial ${AERIAL_TYPE_LABEL[(str(r.inspection_type) ?? 'pre_use') as AerialInspectionType] ?? ''}`.trim(),
      href:        r => `/hd/aerial-inspections/${String(r.id)}`,
      refPrefix:   'AER',
    }),
    ...collect((equipRes.data ?? []) as Row[], {
      sectionsFor: r => {
        const t = str(r.equipment_type) as EquipmentType | null
        return t && EQUIPMENT_FORMS[t] ? EQUIPMENT_FORMS[t].sections : []
      },
      payloadKey:  'inspection_data',
      formLabel:   r => EQUIPMENT_TYPE_LABEL[(str(r.equipment_type) ?? '') as EquipmentType] ?? 'Equipment',
      href:        r => `/hd/equipment-inspections/${String(r.id)}`,
      refPrefix:   'EQP',
    }),
  ]

  return (
    <main className="flex-1 p-6">
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'rgba(var(--hd-ink-rgb), 0.4)' }}>
            HD Suite
          </p>
          <h1 className="font-condensed font-bold text-3xl text-white tracking-wide">
            INSPECTION FOLLOW-UPS
          </h1>
          <p className="text-white/40 text-sm mt-1">
            Defects that did not take a unit out of service. Still needs doing, just not today.
          </p>
        </div>
        <Link
          href="/hd/dashboard"
          className="flex-shrink-0 px-4 py-2.5 rounded-lg border border-white/15 text-white/60 hover:text-white hover:border-white/30 text-sm font-semibold transition-colors"
        >
          Dashboard
        </Link>
      </div>

      <div className="max-w-3xl">
        <DefectFollowUpList rows={rows} />
      </div>
    </main>
  )
}
