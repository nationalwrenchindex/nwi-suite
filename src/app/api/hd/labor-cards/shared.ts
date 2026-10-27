import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess, reeferStandaloneCan } from '@/lib/hd-access'
import { isReeferCategoryName } from '@/lib/reefer-standalone'

// Shared by /api/hd/labor-cards and /api/hd/labor-cards/[id]. A route file may only
// export its handlers, so these live here.

export async function authedHD() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  const hdAccess = await checkHDAccess(user.id)
  if (!(hdAccess || (await reeferStandaloneCan(user.id, 'reefer_labor_cards')))) {
    return { error: NextResponse.json({ error: 'HD subscription required' }, { status: 403 }) } as const
  }
  // reeferOnly: a Reefer Standalone account (the HD gate refused it). Its cards are
  // reefer cards - listed, written and edited as equipment_type 'reefer' only. An HD
  // account is never reeferOnly, so nothing below changes for HD.
  return { supabase, user, reeferOnly: !hdAccess } as const
}

/** For a reefer-only account: the card must be a reefer card in a reefer category (or none). */
export async function reeferCardProblem(
  supabase: SupabaseClient, userId: string,
  row: { equipment_type: string | null; equipment_category_id: string | null },
): Promise<string | null> {
  if (row.equipment_type !== 'reefer') return 'Reefer labor cards only on this plan.'
  if (!row.equipment_category_id) return null
  const { data } = await supabase
    .from('hd_equipment_categories').select('name').eq('id', row.equipment_category_id).eq('user_id', userId).maybeSingle()
  return isReeferCategoryName(data?.name) ? null : 'Reefer categories only on this plan.'
}

/** A category id must be one of THIS shop's categories. RLS checks it too. */
export async function ownsCategory(supabase: SupabaseClient, userId: string, id: string | null): Promise<boolean> {
  if (!id) return true
  const { data } = await supabase
    .from('hd_equipment_categories').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  return !!data
}
