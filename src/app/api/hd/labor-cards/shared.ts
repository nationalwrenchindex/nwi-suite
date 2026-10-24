import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

// Shared by /api/hd/labor-cards and /api/hd/labor-cards/[id]. A route file may only
// export its handlers, so these live here.

export async function authedHD() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  if (!(await checkHDAccess(user.id))) {
    return { error: NextResponse.json({ error: 'HD subscription required' }, { status: 403 }) } as const
  }
  return { supabase, user } as const
}

/** A category id must be one of THIS shop's categories. RLS checks it too. */
export async function ownsCategory(supabase: SupabaseClient, userId: string, id: string | null): Promise<boolean> {
  if (!id) return true
  const { data } = await supabase
    .from('hd_equipment_categories').select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  return !!data
}
