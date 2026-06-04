import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const manufacturer = searchParams.get('manufacturer')?.trim() ?? ''
  const category     = searchParams.get('category')?.trim() ?? ''
  const unit_model   = searchParams.get('unit_model')
  const part_number  = searchParams.get('part_number')
  const search       = searchParams.get('search')
  const cross_ref    = searchParams.get('cross_ref') === 'true'

  let query = supabase
    .from('hd_parts')
    .select(cross_ref
      ? '*, hd_parts_cross_ref(*)'
      : '*'
    )
    .order('manufacturer')
    .order('category')
    .order('part_number')
    .limit(500)

  if (manufacturer)  query = query.ilike('manufacturer', manufacturer)
  if (category)      query = query.ilike('category', category)
  if (unit_model)    query = query.contains('unit_models', [unit_model])
  if (part_number)   query = query.eq('part_number', part_number)

  const { data, error } = await query

  if (error) {
    console.error('[api/hd/parts] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  type CrossRefMatch = { cross_part: string; cross_mfr: string }
  type PartRow = { id: string; part_number: string; description: string; notes: string | null; _cross_ref_match?: CrossRefMatch[]; [k: string]: unknown }
  let parts = (data ?? []) as unknown as PartRow[]

  if (search) {
    const normalize = (s: string) => s.replace(/[-\s]/g, '').toLowerCase()
    const normSearch = normalize(search)
    const lower      = search.toLowerCase()

    // 1. Filter main results — normalized part_number + plain description/notes
    parts = parts.filter(p =>
      normalize(p.part_number).includes(normSearch) ||
      p.description.toLowerCase().includes(lower) ||
      (p.notes ?? '').toLowerCase().includes(lower)
    )

    // 2. Cross-ref search — find OEM parts where any cross_part matches the normalized term
    const { data: allXrefs } = await supabase
      .from('hd_parts_cross_ref')
      .select('part_number, cross_mfr, cross_part')

    const matchedXrefs = (allXrefs ?? []).filter(xr =>
      normalize(xr.cross_part as string).includes(normSearch)
    )

    if (matchedXrefs.length > 0) {
      const xrefPartNumbers = [...new Set(matchedXrefs.map(x => x.part_number as string))]

      let xrefQuery = supabase
        .from('hd_parts')
        .select(cross_ref ? '*, hd_parts_cross_ref(*)' : '*')
        .in('part_number', xrefPartNumbers)

      // Apply the same manufacturer/category filters to the OEM parts
      if (manufacturer) xrefQuery = xrefQuery.ilike('manufacturer', manufacturer)
      if (category)     xrefQuery = xrefQuery.ilike('category', category)

      const { data: xrefParts } = await xrefQuery

      const tagged = ((xrefParts ?? []) as unknown as PartRow[]).map(p => ({
        ...p,
        _cross_ref_match: matchedXrefs
          .filter(xr => xr.part_number === p.part_number)
          .map(xr => ({ cross_part: xr.cross_part as string, cross_mfr: xr.cross_mfr as string })),
      }))

      // Cross-ref matches go first; deduplicate against text-search results by id
      const xrefIds = new Set(tagged.map(p => p.id))
      parts = [...tagged, ...parts.filter(p => !xrefIds.has(p.id))]
    }
  }

  return NextResponse.json({ parts })
}
