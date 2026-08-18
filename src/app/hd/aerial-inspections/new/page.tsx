import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import AerialChecklist from '@/components/hd/aerial/AerialChecklist'
import { AERIAL_FORMS } from '@/lib/hd/aerial/forms'
import type { AerialInspectionType } from '@/types/aerial'

export const metadata = { title: 'New Aerial Inspection — NWI HD Suite' }

const TYPES: AerialInspectionType[] = ['pre_use', 'frequent', 'annual']

export default async function NewAerialInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; unit?: string; work_order?: string }>
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/hd/login')

  // Same gate as DOT inspections — these are the same product tier.
  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) redirect('/hd/upgrade')

  const params = await searchParams
  const type = TYPES.includes(params.type as AerialInspectionType)
    ? (params.type as AerialInspectionType)
    : null
  if (params.type && !type) return notFound()

  const [{ data: units }, { data: profile }] = await Promise.all([
    supabase
      .from('hd_units')
      .select('id, unit_number, manufacturer, model, serial_number')
      .eq('user_id', user.id)
      .order('unit_number', { ascending: true }),
    supabase.from('profiles').select('full_name, hd_tech_name').eq('id', user.id).single(),
  ])

  const p = profile as { full_name?: string; hd_tech_name?: string } | null
  const inspectorName = p?.hd_tech_name || p?.full_name || ''

  // No type chosen yet — the three cadences are different documents with
  // different legal requirements, so the tech picks deliberately rather than
  // landing in one by default.
  if (!type) {
    return (
      <div className="max-w-2xl mx-auto space-y-3">
        <h1 className="font-condensed font-bold text-2xl text-white tracking-wide mb-1">
          NEW AERIAL INSPECTION
        </h1>
        <p className="text-white/40 text-sm mb-4">Select the inspection cadence.</p>
        {TYPES.map(t => {
          const def = AERIAL_FORMS[t]
          return (
            <Link
              key={t}
              href={`/hd/aerial-inspections/new?type=${t}${params.unit ? `&unit=${params.unit}` : ''}${params.work_order ? `&work_order=${params.work_order}` : ''}`}
              className="block rounded-xl p-4 transition-colors hover:border-orange/40"
              style={{ background: '#111920', border: '1px solid #1e3040' }}
            >
              <p className="text-white font-semibold">{def.title}</p>
              <p className="text-white/40 text-xs mt-0.5">{def.citation}</p>
              <p className="text-white/30 text-xs mt-1.5">{def.cadence}</p>
              <p className="text-orange text-xs mt-2">
                {def.sections.length} sections · {def.sections.reduce((n, s) => n + s.items.length, 0)} checkpoints →
              </p>
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <AerialChecklist
        def={AERIAL_FORMS[type]}
        units={units ?? []}
        defaultInspector={inspectorName}
        workOrderId={typeof params.work_order === 'string' ? params.work_order : null}
        initialUnitId={typeof params.unit === 'string' ? params.unit : null}
      />
    </div>
  )
}
