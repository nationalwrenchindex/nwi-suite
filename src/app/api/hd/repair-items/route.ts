import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { hasQuickWrenchAccess } from '@/lib/subscription'

export const dynamic = 'force-dynamic'

// GET — master repair items + the tech's own custom items (RLS scopes reads to
// is_master = true OR user_id = auth.uid()). Optional ?category= filter.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [hdAccess, qwAccess] = await Promise.all([checkHDAccess(user.id), hasQuickWrenchAccess(user.id)])
  if (!hdAccess && !qwAccess) return NextResponse.json({ error: 'HD or QuickWrench subscription required' }, { status: 403 })

  const category = req.nextUrl.searchParams.get('category')?.trim() || null

  let query = supabase
    .from('hd_repair_items')
    .select('id, description, category, applies_to, mobile_hours, shop_hours, requires_refrigeration, refrigeration_service, refrigeration_hours, notes, is_master, use_count, last_used_at, source')
    .eq('active', true)
  if (category) query = query.eq('category', category)

  // User's own items first, most-used at the top (their personal library);
  // master items follow, ordered by description.
  const { data, error } = await query
    .order('is_master', { ascending: true })
    .order('use_count', { ascending: false, nullsFirst: false })
    .order('last_used_at', { ascending: false, nullsFirst: false })
    .order('description', { ascending: true })
    .limit(300)

  if (error) {
    console.error('[hd/repair-items] read failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}

// POST — create a custom repair item owned by the authenticated user.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [hdAccess, qwAccess] = await Promise.all([checkHDAccess(user.id), hasQuickWrenchAccess(user.id)])
  if (!hdAccess && !qwAccess) return NextResponse.json({ error: 'HD or QuickWrench subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 })

  const asNum = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v)
    return null
  }
  const appliesRaw = typeof body.applies_to === 'string' ? body.applies_to : 'both'
  const applies_to = ['truck', 'trailer', 'both'].includes(appliesRaw) ? appliesRaw : 'both'
  const svcRaw = typeof body.refrigeration_service === 'string' ? body.refrigeration_service : null
  const refrigeration_service = svcRaw && ['A', 'B', 'C', 'D'].includes(svcRaw) ? svcRaw : null
  const sourceRaw = typeof body.source === 'string' ? body.source : 'manual'
  const source = ['manual', 'quickwrench', 'seed'].includes(sourceRaw) ? sourceRaw : 'manual'

  const cols = 'id, description, category, applies_to, mobile_hours, shop_hours, requires_refrigeration, refrigeration_service, refrigeration_hours, notes, is_master, use_count, last_used_at, source'

  // Billable hours must be a real number of hours. A 0 or missing figure is what made
  // "test labor" pre-fill 0 hrs x $135.00 = $0.00 on every pick.
  const mobileHours = asNum(body.mobile_hours)
  const shopHours   = asNum(body.shop_hours)
  const hoursOk     = mobileHours != null && mobileHours > 0

  // If this tech already saved an item with the same description (case-insensitive),
  // bump its use_count / last_used_at instead of creating a duplicate - and take the
  // hours just used. This only bumped the count before, so a bad first save stuck for
  // good: re-adding "test labor" with the right hours left the 0 in place.
  const { data: existing } = await supabase
    .from('hd_repair_items')
    .select('id, use_count')
    .eq('user_id', user.id)
    .ilike('description', description)
    .limit(1)
    .maybeSingle()

  if (existing) {
    const { data: bumped, error: bumpErr } = await supabase
      .from('hd_repair_items')
      .update({
        use_count: (existing.use_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
        // Hours only when they are real, so a save with none cannot wipe good ones.
        ...(hoursOk ? { mobile_hours: mobileHours } : {}),
        ...(hoursOk && shopHours != null && shopHours > 0 ? { shop_hours: shopHours } : {}),
      })
      .eq('id', existing.id)
      .select(cols)
      .single()
    if (bumpErr) {
      console.error('[hd/repair-items] use_count bump failed', bumpErr)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    return NextResponse.json({ item: bumped }, { status: 200 })
  }

  if (!hoursOk) {
    return NextResponse.json({ error: 'billable hours (mobile_hours) must be more than 0' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('hd_repair_items')
    .insert({
      user_id:                user.id,
      description,
      category:              typeof body.category === 'string' ? body.category : null,
      applies_to,
      mobile_hours:          mobileHours,
      shop_hours:            shopHours,
      requires_refrigeration: body.requires_refrigeration === true,
      refrigeration_service,
      refrigeration_hours:   asNum(body.refrigeration_hours),
      notes:                 typeof body.notes === 'string' ? body.notes : null,
      is_master:             false,
      active:                true,
      use_count:             1,
      last_used_at:          new Date().toISOString(),
      source,
    })
    .select(cols)
    .single()

  if (error) {
    console.error('[hd/repair-items] insert failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ item: data }, { status: 201 })
}
