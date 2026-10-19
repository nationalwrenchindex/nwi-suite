// GET   /api/hd/reports/labels - the shop's audit-export wording, resolved over the defaults.
// PATCH /api/hd/reports/labels - replace the shop's overrides.
//
// Body: { "text": { "<key>": "<label>" }, "categories": { "<category id>": "<name>" } }
// Known keys only, length-capped, category ids must be the shop's own (or the two
// synthetic rows). An empty string means "use the default". The PATCH REPLACES the
// stored overrides - the settings form always sends the whole set.
//
// Stored in profiles.hd_report_labels (migration 162). Until 162 is applied the GET
// reports available: false with the defaults, and the PATCH answers 409 saying so,
// rather than failing silently. Preview and production share one database.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { listEquipmentCategories } from '@/lib/hd/equipment-categories'
import { loadShopContext } from '@/lib/hd/audit-load'
import { validateAuditLabels, resolveAuditLabels, isMissingLabelsColumn } from '@/lib/hd/audit-labels'

export const dynamic = 'force-dynamic'

const MIGRATION_MESSAGE = 'Report labels cannot be saved until migration 162 (profiles.hd_report_labels) is applied. The exports use the default labels until then.'

async function gate() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const
  if (!(await checkHDStarterAccess(user.id))) return { error: NextResponse.json({ error: 'HD Starter or above required' }, { status: 403 }) } as const
  return { supabase, user } as const
}

export async function GET() {
  const g = await gate()
  if ('error' in g) return g.error
  try {
    const ctx = await loadShopContext(g.supabase, g.user.id)
    return NextResponse.json({ available: ctx.labelsAvailable, labels: ctx.labels })
  } catch (err) {
    console.error('[hd report labels] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not read report labels' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await gate()
  if ('error' in g) return g.error

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 }) }

  const cats = await listEquipmentCategories(g.supabase, g.user.id, { includeInactive: true })
  const result = validateAuditLabels(body, new Set(cats.map(c => c.id)))
  if (!result.ok) return NextResponse.json({ error: 'Invalid labels', details: result.errors }, { status: 400 })

  const stored = Object.keys(result.value).length ? result.value : null
  const { error } = await g.supabase
    .from('profiles')
    .update({ hd_report_labels: stored })
    .eq('id', g.user.id)
  if (error) {
    if (isMissingLabelsColumn(error)) return NextResponse.json({ error: MIGRATION_MESSAGE, available: false }, { status: 409 })
    console.error('[hd report labels] save failed:', error.message)
    return NextResponse.json({ error: 'Could not save report labels' }, { status: 500 })
  }
  return NextResponse.json({ available: true, labels: resolveAuditLabels(stored) })
}
