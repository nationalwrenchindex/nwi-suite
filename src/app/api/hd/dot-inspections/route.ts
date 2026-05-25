import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { CATEGORY_ITEMS, itemLabel } from '@/lib/hd/dot-categories'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const hasAccess = await checkHDStarterAccess(user.id)
    if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

    let body: {
      unit_id?: string
      fleet_account_id?: string
      inspection_date: string
      inspector_name?: string
      inspector_cert_number?: string
      odometer_hours?: string
      location?: string
      inspection_data: Record<string, { items: Record<string, { result: string; notes: string }> }>
      signature_data?: string
    }

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    if (!body.inspection_date || !body.inspection_data) {
      return NextResponse.json({ error: 'inspection_date and inspection_data required' }, { status: 400 })
    }

    // Derive overall result from item-level results
    const overallResult = Object.values(body.inspection_data).some(cat =>
      Object.values(cat.items ?? {}).some(item => item.result === 'fail')
    ) ? 'fail' : 'pass'

    // Build violations list at item level
    const violations: {
      category: string
      item: string
      label: string
      notes: string
      safetyCritical: boolean
    }[] = []

    for (const [catId, catData] of Object.entries(body.inspection_data)) {
      for (const [itemId, itemData] of Object.entries(catData.items ?? {})) {
        if (itemData.result === 'fail') {
          const itemDef = CATEGORY_ITEMS[catId]?.find(i => i.id === itemId)
          violations.push({
            category: catId,
            item: itemId,
            label: itemLabel(catId, itemId),
            notes: itemData.notes ?? '',
            safetyCritical: itemDef?.safetyCritical ?? false,
          })
        }
      }
    }

    const dateStr     = body.inspection_date.replace(/-/g, '')
    const suffix      = Math.random().toString(36).substring(2, 8).toUpperCase()
    const inspectionId = `DOT-${dateStr}-${suffix}`

    const { data, error } = await supabase
      .from('hd_dot_inspections')
      .insert({
        user_id:               user.id,
        unit_id:               body.unit_id ?? null,
        fleet_account_id:      body.fleet_account_id ?? null,
        inspection_date:       body.inspection_date,
        inspector_name:        body.inspector_name ?? null,
        inspector_cert_number: body.inspector_cert_number ?? null,
        odometer_hours:        body.odometer_hours ?? null,
        location:              body.location ?? null,
        inspection_data:       body.inspection_data,
        violations:            violations.length > 0 ? violations : null,
        overall_result:        overallResult,
        signature_data:        body.signature_data ?? null,
        locked:                true,
        locked_at:             new Date().toISOString(),
        inspection_id:         inspectionId,
      })
      .select('id, inspection_id')
      .single()

    if (error) {
      console.error('[dot-inspections] Insert error', error)
      return NextResponse.json({ error: 'Failed to save inspection' }, { status: 500 })
    }

    return NextResponse.json({ id: data.id, inspection_id: data.inspection_id })
  } catch (err) {
    console.error('[dot-inspections] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
