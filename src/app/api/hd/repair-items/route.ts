import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import {
  MAX_SEARCH, likeEscape, libraryCategoryFilter, librarySearchFilter, postgrestQuoted,
} from '@/lib/hd/labor-library'

export const dynamic = 'force-dynamic'

// The library as the pickers read it. labor_code (167) shows beside the name;
// oem_labor_code is the shop's private reference and is never selected here.
const COLS = 'id, labor_code, description, category, applies_to, mobile_hours, mobile_hours_high, shop_hours, ' +
  'shop_hours_high, detail, equipment_type, requires_refrigeration, refrigeration_service, refrigeration_hours, ' +
  'notes, is_master, use_count, last_used_at, source'

const MAX_LIMIT = 100

type Row = Record<string, unknown>

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const [hdAccess, qwAccess] = await Promise.all([checkHDAccess(user.id), hasQuickWrenchAccess(user.id)])
  if (!hdAccess && !qwAccess) {
    return { error: NextResponse.json({ error: 'HD or QuickWrench subscription required' }, { status: 403 }) } as const
  }
  return { supabase, user } as const
}

// GET - the NWI catalog + the tech's own rows (RLS: own, or user_id NULL and is_master).
//
//   ?q=          description or labor code contains this, as typed (wildcards escaped)
//   ?category=   exactly this category
//   ?categories= a,b,c - one of these, or no category at all (a tech's own saves
//                 usually have none and must not vanish)
//   ?limit=      1..100. The answer then says how many matched in all (total) and
//                 whether it was trimmed (truncated), so the picker can say so.
//                 Without a limit every matching row is returned, paged past the
//                 1,000-row cap.
//
// With q, `exact` is the shop's own card named exactly that (ignoring case), if any,
// for the picker's "You already have a card named this" hint. Display only.
//
// Order: own rows first, most used at the top; then the catalog; then by name.
export async function GET(req: NextRequest) {
  const a = await authed()
  if ('error' in a) return a.error
  const { supabase, user } = a
  const sp = req.nextUrl.searchParams

  const q          = (sp.get('q') ?? '').trim().slice(0, MAX_SEARCH)
  const category   = sp.get('category')?.trim() || null
  const categories = libraryCategoryFilter((sp.get('categories') ?? '').split(','))
  const limitRaw   = Number(sp.get('limit'))
  const limit      = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : null

  const build = (count?: 'exact') => {
    let query = supabase.from('hd_repair_items').select(COLS, count ? { count } : undefined).eq('active', true)
    if (category)   query = query.eq('category', category)
    if (categories) query = query.or(categories)
    if (q)          query = query.or(librarySearchFilter(q))
    return query
      .order('is_master', { ascending: true })
      .order('use_count', { ascending: false, nullsFirst: false })
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .order('description', { ascending: true })
      .order('id', { ascending: true })
  }

  let items: Row[]
  let total: number
  if (limit) {
    const { data, error, count } = await build('exact').range(0, limit - 1)
    if (error) {
      console.error('[hd/repair-items] read failed', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    items = (data ?? []) as unknown as Row[]
    total = count ?? items.length
  } else {
    try {
      items = await fetchAllRows<Row>((from, to) =>
        build().range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: null }>)
    } catch (e) {
      console.error('[hd/repair-items] read failed', e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    total = items.length
  }

  let exact: Row | null = null
  if (q) {
    const { data } = await supabase
      .from('hd_repair_items')
      .select('id, labor_code, description')
      .eq('user_id', user.id)
      .eq('active', true)
      .or(`description.ilike.${postgrestQuoted(likeEscape(q))}`)
      .order('created_at', { ascending: true })
      .limit(1)
    exact = (data?.[0] as Row | undefined) ?? null
  }

  return NextResponse.json({ items, total, truncated: total > items.length, exact })
}

// POST - add a row to the tech's own library. ALWAYS an insert.
//
// This used to look the description up and, when the tech already had one by that
// name, fold the save into it: bump the count and take the new hours. That overwrote a
// hand-written card from the labor cards screen whenever a quote line of the same name
// was saved, and two different jobs can share a name. Now nothing here reads or
// changes an existing row. A pick that is added to a quote is counted by id at
// /api/hd/repair-items/[id]/used instead, and the forms never re-save a picked card.
//
// labor_code is assigned by the database (167); anything sent for it is ignored.
export async function POST(req: NextRequest) {
  const a = await authed()
  if ('error' in a) return a.error
  const { supabase, user } = a

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

  // Billable hours must be a real number of hours. A 0 or missing figure is what made
  // "test labor" pre-fill 0 hrs x $135.00 = $0.00 on every pick.
  const mobileHours = asNum(body.mobile_hours)
  if (mobileHours == null || mobileHours <= 0) {
    return NextResponse.json({ error: 'billable hours (mobile_hours) must be more than 0' }, { status: 400 })
  }
  // Shop (book) time as sent. A blank or missing figure is NULL, never 0 - the quote
  // modal used to send 0 for a book field nobody filled in.
  const shopHours = asNum(body.shop_hours)

  const now = new Date().toISOString()
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
      last_used_at:          now,
      source,
    })
    .select(COLS)
    .single()

  if (error) {
    console.error('[hd/repair-items] insert failed', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  return NextResponse.json({ item: data }, { status: 201 })
}
