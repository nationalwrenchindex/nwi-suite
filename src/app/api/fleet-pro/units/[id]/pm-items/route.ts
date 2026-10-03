// GET   /api/fleet-pro/units/[id]/pm-items — the model-specific PM items for one unit
// PATCH /api/fleet-pro/units/[id]/pm-items — mark one complete
//
// SEPARATE FROM THE GENERAL PM SCHEDULE on purpose. hd_units.next_pm_due_hours is
// the shop's own service interval for the whole unit; these are individual parts
// with their own clocks, and a tech needs to see them as their own list rather
// than averaged into one "PM due" figure.
//
// NOTHING HERE KNOWS WHAT A FUEL FILTER IS. Every interval, model list and reason
// is a row in pm_items (migration 144).

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  PM_ITEM_SELECT, UNIT_PM_ITEM_STATUS_SELECT,
  itemAppliesTo, pmItemDue, completionRow,
  type PmItem, type UnitPmItemStatus,
} from '@/lib/fleet-pro/pm-items'

export const dynamic = 'force-dynamic'

/**
 * True when migration 144 has not been applied. The whole feature degrades to an
 * empty list rather than a 500 — a unit detail page must still render.
 */
function isMissingPmItemsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  const text = String(e.message ?? '').toLowerCase()
  return String(e.code ?? '') === 'PGRST205' ||
    text.includes('pm_items') && (text.includes('does not exist') || text.includes('could not find'))
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Ownership is the security boundary: scoping by user_id makes another
  // subscriber's unit indistinguishable from a missing one.
  const { data: unit } = await supabase
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, unit_type, total_hours')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!unit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [itemsRes, statusRes] = await Promise.all([
    // Global rows (user_id IS NULL) plus this shop's own. RLS enforces it too; the
    // filter is here so the intent is visible at the call site.
    supabase.from('pm_items').select(PM_ITEM_SELECT).or(`user_id.is.null,user_id.eq.${user.id}`),
    supabase.from('unit_pm_item_status').select(UNIT_PM_ITEM_STATUS_SELECT)
      .eq('unit_id', id).eq('user_id', user.id),
  ])

  if (itemsRes.error) {
    if (isMissingPmItemsTable(itemsRes.error)) {
      // Migration 144 not applied. An empty list, not an error.
      return NextResponse.json({ items: [], migration_pending: true })
    }
    console.error('[fleet-pro/pm-items] GET', itemsRes.error)
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 })
  }

  const items = (itemsRes.data ?? []) as unknown as PmItem[]
  const statuses = (statusRes.data ?? []) as unknown as UnitPmItemStatus[]
  const byItem = new Map(statuses.map(s => [s.pm_item_id, s]))

  // componentType is NOT passed: there is no components table, so every item whose
  // model list matches this unit is relevant and the TYPE is shown as a label on
  // the row instead. Filtering by it here would need a component selection that
  // does not exist yet.
  const applicable = items
    .filter(it => itemAppliesTo(it, unit))
    .map(it => {
      const status = byItem.get(it.id) ?? null
      return {
        item: it,
        status,
        due: pmItemDue(it, status, unit, today()),
      }
    })
    // Worst first: a tech opening a unit wants the overdue critical part at the top.
    .sort((a, b) => {
      const RANK = { overdue: 0, due_soon: 1, never_recorded: 2, ok: 3 } as const
      const d = RANK[a.due.state] - RANK[b.due.state]
      if (d !== 0) return d
      if (a.item.is_critical !== b.item.is_critical) return a.item.is_critical ? -1 : 1
      return a.item.name.localeCompare(b.item.name)
    })

  return NextResponse.json({
    unit: { id: unit.id, unit_number: unit.unit_number, total_hours: unit.total_hours },
    items: applicable,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { pm_item_id?: unknown; completed_on?: unknown; completed_hours?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const pmItemId = typeof body.pm_item_id === 'string' ? body.pm_item_id : null
  if (!pmItemId) return NextResponse.json({ error: 'pm_item_id is required' }, { status: 400 })

  const { data: unit } = await supabase
    .from('hd_units')
    .select('id, total_hours')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: itemRow, error: itemErr } = await supabase
    .from('pm_items')
    .select(PM_ITEM_SELECT)
    .eq('id', pmItemId)
    .maybeSingle()

  if (itemErr && isMissingPmItemsTable(itemErr)) {
    return NextResponse.json(
      { error: 'Model-specific PM items need migration 144 applied first.' },
      { status: 409 },
    )
  }
  if (!itemRow) return NextResponse.json({ error: 'PM item not found' }, { status: 404 })
  const item = itemRow as unknown as PmItem

  const completedOn = typeof body.completed_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.completed_on)
    ? body.completed_on
    : today()

  // THE HOURS AT THAT MOMENT. Falls back to the unit's current meter, which is the
  // right default — a tech marking a filter done today did it at today's hours. An
  // explicit 0 is honoured; only undefined/null/'' falls back.
  const rawHours = body.completed_hours
  const completedHours =
    rawHours === null || rawHours === undefined || rawHours === ''
      ? (unit.total_hours === null || unit.total_hours === undefined ? null : Number(unit.total_hours))
      : Number(rawHours)
  if (completedHours !== null && !Number.isFinite(completedHours)) {
    return NextResponse.json({ error: 'completed_hours must be a number' }, { status: 400 })
  }

  const row = {
    user_id:      user.id,
    unit_id:      id,
    component_id: null,
    pm_item_id:   pmItemId,
    ...completionRow(item, completedOn, completedHours),
    updated_at:   new Date().toISOString(),
  }

  // onConflict names the same columns as the UNIQUE constraint in 144, so marking
  // an item complete twice updates the row rather than failing.
  const { data, error } = await supabase
    .from('unit_pm_item_status')
    .upsert(row, { onConflict: 'unit_id,pm_item_id,component_id' })
    .select(UNIT_PM_ITEM_STATUS_SELECT)
    .single()

  if (error) {
    console.error('[fleet-pro/pm-items] PATCH', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    status: data,
    due: pmItemDue(item, data as unknown as UnitPmItemStatus, unit, today()),
  })
}
