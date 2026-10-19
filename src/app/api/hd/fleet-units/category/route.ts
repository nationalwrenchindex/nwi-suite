import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseSetCategoryBody } from '../unit-category'

export const dynamic = 'force-dynamic'

// POST /api/hd/fleet-units/category  { unit_ids: [id, ...], category_id: id | null }
//
// Sets the category on one unit (the inline dropdown) or many (Set category for
// selected). null clears it, and the unit reports under Uncategorized.
//
// OWNERSHIP IS CHECKED BEFORE ANYTHING IS WRITTEN, for every id that arrived in the
// request. A foreign key does not apply RLS, so the category is read back under this
// shop's user_id; and every unit id must come back from a user_id-scoped read, or the
// whole request is refused - a partial update would leave the screen showing a
// selection that only half saved.
//
// unit_type is NOT written here. Migration 161's hd_units_category_sync trigger copies
// the category name into it whenever category_id is set; clearing to null leaves the
// unit_type it had, which the PM screens and Fleet Pro still read.

const CHUNK = 100   // keeps each .in() filter's URL short

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  const parsed = parseSetCategoryBody(raw)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { unitIds, categoryId } = parsed

  if (categoryId) {
    const { data: cat, error: catErr } = await supabase
      .from('hd_equipment_categories')
      .select('id, is_active')
      .eq('id', categoryId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (catErr) {
      console.error('[hd/fleet-units/category] category read', catErr)
      return NextResponse.json({ error: catErr.message }, { status: 500 })
    }
    if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    if (cat.is_active === false) {
      return NextResponse.json(
        { error: 'That category is deactivated - reactivate it in Manage categories first.' },
        { status: 409 },
      )
    }
  }

  const owned = new Set<string>()
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hd_units')
      .select('id')
      .eq('user_id', user.id)
      .in('id', unitIds.slice(i, i + CHUNK))
    if (error) {
      console.error('[hd/fleet-units/category] unit read', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    for (const r of data ?? []) owned.add(r.id as string)
  }
  const missing = unitIds.filter(id => !owned.has(id))
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `${missing.length} of the selected unit${missing.length !== 1 ? 's were' : ' was'} not found. Nothing was changed.` },
      { status: 404 },
    )
  }

  const updated: { id: string; category_id: string | null; unit_type: string | null }[] = []
  for (let i = 0; i < unitIds.length; i += CHUNK) {
    const { data, error } = await supabase
      .from('hd_units')
      .update({ category_id: categoryId })
      .eq('user_id', user.id)
      .in('id', unitIds.slice(i, i + CHUNK))
      .select('id, category_id, unit_type')
    if (error) {
      console.error('[hd/fleet-units/category] update', error)
      // Earlier chunks may already have saved; say so rather than imply nothing did.
      return NextResponse.json(
        { error: `Saved ${updated.length} of ${unitIds.length} units, then failed: ${error.message}`, units: updated },
        { status: 500 },
      )
    }
    updated.push(...((data ?? []) as typeof updated))
  }

  return NextResponse.json({ updated: updated.length, units: updated })
}
