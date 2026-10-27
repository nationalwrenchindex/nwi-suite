import { NextResponse, type NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { isReeferStandaloneUser } from '@/lib/hd-access'
import { getEquipmentCategories, listEquipmentCategories } from '@/lib/hd/equipment-categories'
import { cleanCategoryName, findNameClash, clashMessage, nextSortOrder, planReorder } from './rules'

export const dynamic = 'force-dynamic'

// /api/hd/equipment-categories - the shop's own equipment category list.
//
//   GET                                     every category, inactive included
//   POST  { name }                          add one, at the end of the list
//   PATCH { id, name?, is_active? }         rename and/or deactivate / reactivate one
//   PATCH { order: [id, ...] }              reorder - every category, exactly once
//
// Every write answers with the full list, so the screen re-renders from what was saved.
//
// Scoped by user_id (one account = one shop) on every read and write, on top of RLS.
// A category is never deleted here: units point at it and reports group by it, and
// deactivating hides it from pickers while units already in it keep it.
//
// Gated on authentication only, the same as /api/hd/fleet-units: the units screen has
// no tier check, so requiring one here would show a shop a category column it cannot use.

async function authed() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, user }
}

async function listAll(supabase: SupabaseClient, userId: string) {
  return listEquipmentCategories(supabase, userId, { includeInactive: true })
}

// The unique (user_id, name) constraint can still fire if two tabs add the same name at
// once - the case-insensitive pre-check cannot see a row that does not exist yet.
function conflictOr500(err: { code?: string; message: string }, name: string) {
  if (err.code === '23505') {
    return NextResponse.json({ error: `A category named "${name}" already exists.` }, { status: 409 })
  }
  console.error('[hd/equipment-categories]', err)
  return NextResponse.json({ error: err.message }, { status: 500 })
}

export async function GET() {
  const { supabase, user } = await authed()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Seeds the defaults the first time, so a shop that opens this before the units list
  // still starts from the nine defaults instead of an empty list.
  const categories = await getEquipmentCategories(supabase, user.id, { includeInactive: true })
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const { supabase, user } = await authed()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Not part of Reefer Standalone. Only a reefer_standalone account is refused here;
  // every other account gets exactly what it got before.
  if (await isReeferStandaloneUser(user.id)) return NextResponse.json({ error: 'Not available on Reefer Standalone' }, { status: 403 })

  let body: { name?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const cleaned = cleanCategoryName(body?.name)
  if ('error' in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 })

  // Seed first: adding "Crane" to a shop that was never seeded would otherwise make it
  // the shop's only category, and the seed would then never run.
  const existing = await getEquipmentCategories(supabase, user.id, { includeInactive: true })
  const clash = findNameClash(existing, cleaned.name)
  if (clash) return NextResponse.json({ error: clashMessage(cleaned.name, clash) }, { status: 409 })

  const { error } = await supabase
    .from('hd_equipment_categories')
    .insert({ user_id: user.id, name: cleaned.name, sort_order: nextSortOrder(existing), is_active: true })
  if (error) return conflictOr500(error, cleaned.name)

  return NextResponse.json({ categories: await listAll(supabase, user.id) }, { status: 201 })
}

export async function PATCH(req: NextRequest) {
  const { supabase, user } = await authed()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Not part of Reefer Standalone. Only a reefer_standalone account is refused here;
  // every other account gets exactly what it got before.
  if (await isReeferStandaloneUser(user.id)) return NextResponse.json({ error: 'Not available on Reefer Standalone' }, { status: 403 })

  let body: { id?: unknown; name?: unknown; is_active?: unknown; order?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const existing = await listAll(supabase, user.id)

  // ── Reorder ────────────────────────────────────────────────────────────────
  if (body.order !== undefined) {
    const plan = planReorder(existing, body.order)
    if ('error' in plan) return NextResponse.json({ error: plan.error }, { status: 400 })
    for (const u of plan.updates) {
      const { error } = await supabase
        .from('hd_equipment_categories')
        .update({ sort_order: u.sort_order })
        .eq('id', u.id)
        .eq('user_id', user.id)
      if (error) {
        console.error('[hd/equipment-categories reorder]', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
    return NextResponse.json({ categories: await listAll(supabase, user.id) })
  }

  // ── Rename / activate one ──────────────────────────────────────────────────
  // The id must be one of this shop's own - checked against the list read above.
  const target = typeof body.id === 'string' ? existing.find(c => c.id === body.id) : undefined
  if (!target) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

  const patch: { name?: string; is_active?: boolean } = {}
  if (body.name !== undefined) {
    const cleaned = cleanCategoryName(body.name)
    if ('error' in cleaned) return NextResponse.json({ error: cleaned.error }, { status: 400 })
    const clash = findNameClash(existing, cleaned.name, target.id)
    if (clash) return NextResponse.json({ error: clashMessage(cleaned.name, clash) }, { status: 409 })
    if (cleaned.name !== target.name) patch.name = cleaned.name
  }
  if (body.is_active !== undefined) {
    if (typeof body.is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active must be true or false' }, { status: 400 })
    }
    if (body.is_active !== target.is_active) patch.is_active = body.is_active
  }
  if (body.name === undefined && body.is_active === undefined) {
    return NextResponse.json({ error: 'Nothing to change - send name, is_active, or order.' }, { status: 400 })
  }

  if (Object.keys(patch).length > 0) {
    // A rename also renames unit_type on this category's units (migration 161's
    // hd_equipment_categories_rename_sync trigger), so the two never disagree.
    const { error } = await supabase
      .from('hd_equipment_categories')
      .update(patch)
      .eq('id', target.id)
      .eq('user_id', user.id)
    if (error) return conflictOr500(error, patch.name ?? target.name)
  }

  return NextResponse.json({ categories: await listAll(supabase, user.id) })
}
