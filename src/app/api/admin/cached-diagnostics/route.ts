import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'

// Founder-only admin endpoint for reviewing/correcting the HD diagnostic cache.
// Actions: update (correct result_html), delete (drop a bad entry), promote
// (insert a reviewed entry into the verified hd_alarm_codes table, then remove
// the cached row). All writes use the service-role client.
const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

const SEVERITIES = ['immediate', 'check', 'maintenance', 'info']

const asStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const action = body.action
  const id     = asStr(body.id)
  const svc    = createServiceClient()

  // ── UPDATE: write corrected result_html back, stamp last_accessed ──────────
  if (action === 'update') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const result_html = typeof body.result_html === 'string' ? body.result_html : ''
    if (!result_html.trim()) {
      return NextResponse.json({ error: 'result_html required' }, { status: 400 })
    }
    // A founder edit counts as a review: clear the needs_review flag and stamp
    // who reviewed it and when, so hazardous entries leave the review queue.
    const now = new Date().toISOString()
    const { error } = await svc
      .from('hd_cached_diagnostics')
      .update({
        result_html,
        last_accessed: now,
        needs_review:  false,
        reviewed_at:   now,
        reviewed_by:   user.id,
      })
      .eq('id', id)
    if (error) {
      console.error('[admin/cached-diagnostics] update', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    revalidatePath('/admin')
    return NextResponse.json({ ok: true })
  }

  // ── DELETE: drop a bad entry so the next lookup regenerates fresh ──────────
  if (action === 'delete') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const { error } = await svc.from('hd_cached_diagnostics').delete().eq('id', id)
    if (error) {
      console.error('[admin/cached-diagnostics] delete', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    revalidatePath('/admin')
    return NextResponse.json({ ok: true })
  }

  // ── PROMOTE: insert reviewed fields into verified hd_alarm_codes ───────────
  // Never silently copies AI text — the founder reviews/edits the fields client
  // side first; this only validates and persists what was submitted.
  if (action === 'promote') {
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    const f = (typeof body.fields === 'object' && body.fields !== null ? body.fields : {}) as Record<string, unknown>

    const manufacturer = asStr(f.manufacturer)
    const unit_family  = asStr(f.unit_family)
    const meaning      = asStr(f.meaning)

    // hd_alarm_codes is reefer-only: manufacturer CHECK is ('TK','Carrier'),
    // unit_family and meaning are NOT NULL.
    if (manufacturer !== 'TK' && manufacturer !== 'Carrier') {
      return NextResponse.json({ error: 'manufacturer must be TK or Carrier' }, { status: 400 })
    }
    if (!unit_family) return NextResponse.json({ error: 'unit_family required' }, { status: 400 })
    if (!meaning)     return NextResponse.json({ error: 'meaning required' }, { status: 400 })

    const sevRaw   = asStr(f.severity) ?? 'check'
    const severity = SEVERITIES.includes(sevRaw) ? sevRaw : 'check'

    const insertRow = {
      manufacturer,
      unit_family,
      alarm_code:       asStr(f.alarm_code),
      display_text:     asStr(f.display_text),
      meaning,
      severity,
      common_causes:    asStr(f.common_causes),
      diagnostic_steps: asStr(f.diagnostic_steps),
      field_notes:      asStr(f.field_notes),
      common_fix:       asStr(f.common_fix),
      parts_needed:     asStr(f.parts_needed),
      safety_warning:   asStr(f.safety_warning),
      book_time:        asNum(f.book_time),
      mobile_time:      asNum(f.mobile_time),
      verified:         true,
    }

    const { data: inserted, error: insErr } = await svc
      .from('hd_alarm_codes')
      .insert(insertRow)
      .select('id')
      .single()
    if (insErr) {
      console.error('[admin/cached-diagnostics] promote insert', insErr)
      return NextResponse.json({ error: 'Verified insert failed' }, { status: 500 })
    }

    // After a successful promote, remove the cached row so it's no longer served
    // as AI-assisted (the verified entry is now authoritative).
    const { error: delErr } = await svc.from('hd_cached_diagnostics').delete().eq('id', id)
    if (delErr) console.error('[admin/cached-diagnostics] promote cleanup', delErr)

    revalidatePath('/admin')
    return NextResponse.json({ ok: true, verified_id: inserted.id })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
