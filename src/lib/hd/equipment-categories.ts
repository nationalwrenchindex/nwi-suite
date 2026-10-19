// The shop's equipment categories: seeded on first access, read for pickers and reports.
//
// Seeding is hd_ensure_equipment_categories() (migration 161): the nine defaults, and a
// one-time mapping of each existing unit's unit_type onto them. It runs as the caller
// under RLS, touches only the signed-in shop's rows, and does nothing once the shop has
// any category - so a renamed or deleted default is never brought back. Call it before
// reading categories on any HD screen that needs them; it is cheap after the first time.
//
// One helper so the units list, the By Equipment view and the audit exports all seed
// the same way and read the same list.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface EquipmentCategory {
  id: string
  user_id: string
  name: string
  sort_order: number
  is_active: boolean
}

/** Seed the defaults if this shop has none. Never throws - a page still renders without. */
export async function ensureEquipmentCategories(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc('hd_ensure_equipment_categories')
  if (error) console.error('[hd equipment categories] seed failed:', error.message)
}

/** The shop's categories, ordered for display. includeInactive for settings screens. */
export async function listEquipmentCategories(
  supabase: SupabaseClient,
  userId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<EquipmentCategory[]> {
  let q = supabase
    .from('hd_equipment_categories')
    .select('id, user_id, name, sort_order, is_active')
    .eq('user_id', userId)
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q.order('sort_order').order('name')
  if (error) {
    console.error('[hd equipment categories] read failed:', error.message)
    return []
  }
  return (data ?? []) as EquipmentCategory[]
}

/** Seed if needed, then read. The usual call. */
export async function getEquipmentCategories(
  supabase: SupabaseClient,
  userId: string,
  opts?: { includeInactive?: boolean },
): Promise<EquipmentCategory[]> {
  await ensureEquipmentCategories(supabase)
  return listEquipmentCategories(supabase, userId, opts)
}
