import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const manufacturer = searchParams.get('manufacturer')
  const category     = searchParams.get('category')
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
    .limit(200)

  if (manufacturer)  query = query.eq('manufacturer', manufacturer)
  if (category)      query = query.eq('category', category)
  if (unit_model)    query = query.contains('unit_models', [unit_model])
  if (part_number)   query = query.eq('part_number', part_number)
  if (search) {
    query = query.or(
      `part_number.ilike.%${search}%,description.ilike.%${search}%,notes.ilike.%${search}%`
    )
  }

  const { data, error } = await query

  if (error) {
    console.error('[api/hd/parts] query error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ parts: data ?? [] })
}
