// ─── Keeping a segment-priced work order's extras on its parent ───────────────
// SERVER ONLY.
//
// WHY THIS EXISTS. A segment-priced work order's money lives in work_order_segments,
// and that table has NO travel, mileage or shop-supplies columns. That is deliberate
// and stays that way: travel is one trip per visit, not per complaint, and shop
// supplies is a percentage of the parts across ALL billable segments. Both are
// properties of the job, so both belong on the parent row.
//
// The consequence before this module existed: a segment-priced work order could not
// record any of the three, so the converter copied nulls and the invoice showed
// nothing. WorkOrderForm does compute them, but on a segment-priced job the parent's
// own money is not what gets billed, so nothing kept the parent's extras in step with
// the segments.
//
// This recomputes them whenever a segment changes. It is the parts base that moves -
// add a part to a segment and the supplies fee follows, with no save-and-reload.

import type { SupabaseClient } from '@supabase/supabase-js'
import { PARENTS, type SegmentProduct } from './parent'
import {
  computeExtras, extrasColumns, extrasSettingsFrom, EXTRAS_SETTINGS_SELECT,
  partsBaseFromLines, round2,
} from '@/lib/billable-extras'
import { isBillable, type SegmentStatus } from '@/types/segments'

/**
 * The parts total across every BILLABLE segment, as it appears to the customer.
 *
 * Billable only, and that is the whole point: a declined clutch's parts must not
 * inflate the shop-supplies fee on a bill the customer is paying for other work. Uses
 * the same partsBaseFromLines the invoice uses, so the quote, the work order and the
 * invoice cannot disagree about what counts as parts.
 */
export function billableSegmentPartsBase(
  rows: Array<{ status?: unknown; line_items?: unknown }> | null | undefined,
): number {
  if (!Array.isArray(rows)) return 0
  let parts = 0
  for (const r of rows) {
    const status = String(r?.status ?? '') as SegmentStatus
    if (!isBillable(status)) continue
    parts += partsBaseFromLines(r?.line_items)
  }
  return round2(parts)
}

export interface SyncResult {
  /** True when the parent row was updated. */
  written:   boolean
  partsBase: number
  columns:   Record<string, number | null>
  /** Set when the write was skipped or failed, for the caller to log. */
  reason?:   string
}

/**
 * Recompute and store the parent's three extras from its current segments.
 *
 * NEVER THROWS, and never fails the caller's request. A segment edit succeeding while
 * the derived fee is momentarily stale is a far better outcome than refusing a tech's
 * edit because a percentage could not be recalculated. The converter recomputes from
 * the same inputs at billing time, so the figure that reaches a customer is correct
 * even if one of these syncs was lost.
 *
 * Returns what it did so the caller can log a skip rather than swallowing it.
 */
export async function syncParentExtras(
  supabase: SupabaseClient,
  product:  SegmentProduct,
  parentId: string,
  userId:   string,
): Promise<SyncResult> {
  const spec = PARENTS[product]
  const empty = { written: false, partsBase: 0, columns: {} as Record<string, number | null> }

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select(EXTRAS_SETTINGS_SELECT)
      .eq('id', userId)
      .single()

    const settings = extrasSettingsFrom(profile as Record<string, unknown> | null)

    // Nothing billed at all means nothing to compute. Still writes, so switching the
    // setting off clears a stale fee rather than leaving it on the row.
    const { data: segRows } = await supabase
      .from('work_order_segments')
      .select('status, line_items')
      .eq(spec.fkColumn, parentId)
      .eq('user_id', userId)

    const partsBase = billableSegmentPartsBase(segRows)

    // Travel and mileage come from what the tech entered on the parent; only the
    // supplies base is derived from the segments.
    const { data: parent } = await supabase
      .from(spec.table)
      .select('travel_hours, mileage_miles, labor_rate, shop_supplies_percent_applied, shop_supplies_cap_applied')
      .eq('id', parentId)
      .eq('user_id', userId)
      .single()

    const p = (parent ?? {}) as Record<string, unknown>
    const extras = computeExtras(
      partsBase,
      {
        travelHours:  Number(p.travel_hours  ?? 0),
        mileageMiles: Number(p.mileage_miles ?? 0),
        // A percentage already recorded on this work order wins over the current
        // Settings value, so editing a segment cannot re-price a job at a new rate.
        shopSuppliesPercentOverride: p.shop_supplies_percent_applied == null
          ? null : Number(p.shop_supplies_percent_applied),
        shopSuppliesCapOverride: p.shop_supplies_cap_applied == null
          ? null : Number(p.shop_supplies_cap_applied),
      },
      settings,
      Number(p.labor_rate ?? 0),
    )

    const columns = extrasColumns(extras)
    const { error } = await supabase
      .from(spec.table)
      .update(columns)
      .eq('id', parentId)
      .eq('user_id', userId)

    if (error) {
      // Almost always migration 142 not being applied on a fresh environment.
      return { ...empty, partsBase, columns, reason: error.message }
    }
    return { written: true, partsBase, columns }
  } catch (e) {
    return { ...empty, reason: e instanceof Error ? e.message : 'unknown' }
  }
}

/** Fire-and-log. Callers use this so a sync failure cannot fail their request. */
export async function syncParentExtrasQuietly(
  supabase: SupabaseClient,
  product:  SegmentProduct,
  parentId: string,
  userId:   string,
): Promise<void> {
  const r = await syncParentExtras(supabase, product, parentId, userId)
  if (!r.written && r.reason) {
    console.warn(`[parent-extras] ${product} ${parentId} not synced: ${r.reason}`)
  }
}
