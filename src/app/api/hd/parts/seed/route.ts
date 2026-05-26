import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import { SEED_PARTS, SEED_CROSS_REFS } from '@/lib/hd/parts-seed'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const service = createServiceClient()

  // Upsert parts (on conflict do nothing so re-runs are idempotent)
  const { error: partsError } = await service
    .from('hd_parts')
    .upsert(SEED_PARTS, { onConflict: 'part_number', ignoreDuplicates: true })

  if (partsError) {
    console.error('[parts/seed] parts upsert error:', partsError)
    return NextResponse.json({ error: partsError.message }, { status: 500 })
  }

  // Upsert cross refs
  const { error: xrefError } = await service
    .from('hd_parts_cross_ref')
    .upsert(SEED_CROSS_REFS, { onConflict: 'part_number,cross_part', ignoreDuplicates: true })

  if (xrefError) {
    console.error('[parts/seed] cross_ref upsert error:', xrefError)
    return NextResponse.json({ error: xrefError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, parts: SEED_PARTS.length, cross_refs: SEED_CROSS_REFS.length })
}
