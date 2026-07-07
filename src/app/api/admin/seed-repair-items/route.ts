import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { MASTER_REPAIR_ITEMS } from '@/lib/hd/repair-items-seed'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

// Founder-gated, idempotent seed of the master repair-items catalog. Each item
// is upserted on (description, applies_to) so re-running only refreshes values —
// never duplicates. Master rows are is_master: true, user_id: null.
export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const svc = createServiceClient()

  const { data: existing, error: readErr } = await svc
    .from('hd_repair_items')
    .select('id, description, applies_to')
    .eq('is_master', true)
  if (readErr) {
    console.error('[seed-repair-items] read failed', readErr)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  const existingMap = new Map((existing ?? []).map(r => [`${r.description}|${r.applies_to}`, r.id as string]))

  let inserted = 0
  let updated  = 0
  const now = new Date().toISOString()

  for (const item of MASTER_REPAIR_ITEMS) {
    const row = {
      description:            item.description,
      category:              item.category,
      applies_to:            item.applies_to,
      mobile_hours:          item.mobile_hours,
      shop_hours:            item.shop_hours,
      requires_refrigeration: item.requires_refrigeration,
      refrigeration_service: item.refrigeration_service ?? null,
      refrigeration_hours:   item.refrigeration_hours ?? null,
      notes:                 item.notes ?? null,
      is_master:             true,
      user_id:               null,
      active:                true,
      updated_at:            now,
    }
    const id = existingMap.get(`${item.description}|${item.applies_to}`)
    if (id) {
      const { error } = await svc.from('hd_repair_items').update(row).eq('id', id)
      if (error) { console.error('[seed-repair-items] update failed', error); return NextResponse.json({ error: 'Database error' }, { status: 500 }) }
      updated++
    } else {
      const { error } = await svc.from('hd_repair_items').insert(row)
      if (error) { console.error('[seed-repair-items] insert failed', error); return NextResponse.json({ error: 'Database error' }, { status: 500 }) }
      inserted++
    }
  }

  return NextResponse.json({ ok: true, inserted, updated, total: MASTER_REPAIR_ITEMS.length })
}
