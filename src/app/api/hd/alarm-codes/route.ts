import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDReeferAccess } from '@/lib/hd-access'

export async function GET(req: NextRequest) {
  const supabase  = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const hasAccess = await checkHDReeferAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'Reefer Module access required' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const manufacturer = searchParams.get('manufacturer')?.trim() ?? ''
  const unit_family  = searchParams.get('unit_family')?.trim()  ?? ''
  const alarm_code   = searchParams.get('alarm_code')?.trim()   ?? ''
  const display_text = searchParams.get('display_text')?.trim() ?? ''

  if (!manufacturer && !alarm_code && !display_text) {
    return NextResponse.json({ error: 'Provide at least manufacturer and alarm_code, or display_text' }, { status: 400 })
  }

  // Priority 1: exact match on manufacturer + unit_family + alarm_code
  if (manufacturer && unit_family && alarm_code) {
    const { data, error } = await supabase
      .from('hd_alarm_codes')
      .select('*')
      .eq('manufacturer', manufacturer)
      .eq('unit_family', unit_family)
      .eq('alarm_code', alarm_code)
      .limit(5)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ results: data ?? [], match_type: 'exact', multi_family_warning: null })
  }

  // Priority 2: manufacturer + display_text (ilike)
  if (manufacturer && display_text) {
    let q = supabase.from('hd_alarm_codes').select('*').eq('manufacturer', manufacturer)
    if (unit_family) q = q.eq('unit_family', unit_family)
    const { data, error } = await q.ilike('display_text', `%${display_text}%`).limit(10)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ results: data ?? [], match_type: 'display_text', multi_family_warning: null })
  }

  // Priority 3: alarm_code only — cross-family, warn about ambiguity
  if (alarm_code) {
    let q = supabase.from('hd_alarm_codes').select('*').eq('alarm_code', alarm_code)
    if (manufacturer) q = q.eq('manufacturer', manufacturer)
    const { data, error } = await q.limit(20)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const families = [...new Set((data ?? []).map(r => r.unit_family))]
    const warning = families.length > 1
      ? 'This alarm code has different meanings on different unit models. Select your unit model for accurate diagnosis.'
      : null

    return NextResponse.json({ results: data ?? [], match_type: 'code_only', multi_family_warning: warning })
  }

  return NextResponse.json({ error: 'Invalid search parameters' }, { status: 400 })
}
