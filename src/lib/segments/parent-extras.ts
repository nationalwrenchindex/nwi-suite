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
  extrasTaxBuckets, partsBaseFromLines, round2,
} from '@/lib/billable-extras'
import {
  computeTax, taxSettingsFrom, TAX_SETTINGS_SELECT, effectiveRatePercent,
} from '@/lib/tax'
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

/**
 * The post-markup parts total of a LINE-ITEM priced parent.
 *
 * Prefers the stored line_items, which already carry the marked-up sell price. Falls
 * back to parts_subtotal x (1 + markup) for a record whose line_items were never
 * populated - an older work order, or one priced through the money columns alone.
 * Returns 0 rather than guessing when neither is available: a fee invented from no
 * parts is worse than no fee.
 */
async function lineItemPartsBase(
  supabase: SupabaseClient,
  spec:     { table: string; lineItems: { kind: 'column'; name: string } | { kind: 'table'; name: string; fk: string } },
  parentId: string,
  userId:   string,
): Promise<number> {
  if (spec.lineItems.kind === 'column') {
    const { data } = await supabase
      .from(spec.table)
      .select(`${spec.lineItems.name}, parts_subtotal, parts_markup_percent`)
      .eq('id', parentId)
      .eq('user_id', userId)
      .single()
    const row = (data ?? {}) as Record<string, unknown>
    const fromLines = partsBaseFromLines(row[spec.lineItems.name])
    if (fromLines > 0) return fromLines
    const base   = Number(row.parts_subtotal ?? 0)
    const markup = Number(row.parts_markup_percent ?? 0)
    return base > 0 ? round2(base * (1 + markup / 100)) : 0
  }

  // HD keeps line items in their own table.
  const { data } = await supabase
    .from(spec.lineItems.name)
    .select('type, total')
    .eq(spec.lineItems.fk, parentId)
  return partsBaseFromLines(data)
}

/**
 * The labour subtotal of a LINE-ITEM priced parent.
 *
 * Mirrors lineItemPartsBase: prefers the stored line items, falls back to the
 * labor_subtotal column, and never guesses from an hourly rate - a work order whose
 * hours were never entered has no labour, not an assumed one.
 */
async function lineItemLaborBase(
  supabase: SupabaseClient,
  spec:     { table: string; lineItems: { kind: 'column'; name: string } | { kind: 'table'; name: string; fk: string } },
  parentId: string,
  userId:   string,
): Promise<number> {
  const sumLabor = (rows: unknown): number => {
    if (!Array.isArray(rows)) return 0
    let n = 0
    for (const raw of rows) {
      if (!raw || typeof raw !== 'object') continue
      const l = raw as Record<string, unknown>
      const isLabor = l.type === 'labor' ||
        (l.type === undefined && typeof l.description === 'string' && /^labor/i.test(l.description.trim()))
      if (isLabor) n += Number(l.total ?? 0)
    }
    return round2(n)
  }

  if (spec.lineItems.kind === 'column') {
    const { data } = await supabase
      .from(spec.table)
      .select(`${spec.lineItems.name}, labor_subtotal`)
      .eq('id', parentId)
      .eq('user_id', userId)
      .single()
    const row = (data ?? {}) as Record<string, unknown>
    const fromLines = sumLabor(row[spec.lineItems.name])
    return fromLines > 0 ? fromLines : round2(Number(row.labor_subtotal ?? 0))
  }

  const { data } = await supabase
    .from(spec.lineItems.name)
    .select('type, total')
    .eq(spec.lineItems.fk, parentId)
  return sumLabor(data)
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

    // BOTH PRICING MODES. A work order is segment-priced OR line-item priced, never
    // both, and the supplies base has to come from whichever one holds the money.
    //
    // THE BUG THIS CLOSES: only the segment path had a server-side computer. On a
    // line-item work order the fee was computed solely in WorkOrderForm, which races
    // the profile fetch behind useExtrasSettings - and lost. WO-2026-0018 carries
    // 3.90 of parts and stored a 0.00 fee with a NULL percentage, while the
    // segment-priced WO-2026-0015 stored 0.77 at 20% from this very function.
    //
    // Line totals are already POST-MARKUP - WO-2026-0018's parts line is 3.90 against
    // a 3.00 base at 30% - which is the figure the customer reads and the base the
    // trade charges supplies on.
    const segmented = Array.isArray(segRows) && segRows.length > 0
    const partsBase = segmented
      ? billableSegmentPartsBase(segRows)
      : await lineItemPartsBase(supabase, spec, parentId, userId)

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

    // ── THE WHOLE MONEY, not just the extras columns ───────────────────────
    //
    // WHAT WENT WRONG WHEN THIS ONLY WROTE THE EXTRAS. WO-2026-0021 stored
    // shop_supplies_fee 39.00 from here while tax_amount 51.16 and grand_total 711.16
    // came from the form, which had computed them WITHOUT the fee. The row then stated
    // a charge it did not bill, and the converter's own guard - correctly - refused to
    // create an invoice from it. Production was blocked by a row this function made
    // inconsistent.
    //
    // So for a LINE-ITEM parent, whose own money columns ARE the billed figures, this
    // now recomputes subtotal, tax, the breakdown and the total together with the
    // extras folded in. One computation, server-side, on every write.
    //
    // A SEGMENT-PRICED parent is deliberately left alone: its money lives in its
    // segments, its own subtotal and grand_total are unused, and the converter adds
    // the parent's extras to the segment money at billing time. Writing a total onto
    // it here would invent a figure nothing reads.
    const columns: Record<string, number | null> = { ...extrasColumns(extras) }

    if (!segmented) {
      const { data: taxProfile } = await supabase
        .from('profiles')
        .select(TAX_SETTINGS_SELECT)
        .eq('id', userId)
        .single()
      const taxSettings = taxSettingsFrom(taxProfile)

      const laborBase = await lineItemLaborBase(supabase, spec, parentId, userId)
      const buckets   = extrasTaxBuckets(extras)
      // Travel joins labour, supplies joins parts, mileage is taxed nowhere but still
      // belongs in the subtotal - which is what buckets.untaxed carries.
      const taxable = computeTax(
        { parts: round2(partsBase + buckets.parts), labor: round2(laborBase + buckets.labor) },
        taxSettings,
      )
      const subtotal = round2(partsBase + laborBase + extras.travel.amount + extras.mileage.amount + extras.shopSupplies.amount)

      // NOTE: work_orders has NO subtotal column - only parts_subtotal, labor_subtotal
      // and grand_total. Writing one would fail this entire UPDATE and the sync would
      // silently store nothing at all. The converter recomputes the subtotal from the
      // line items, so nothing needs it stored.
      columns.tax_amount    = taxable.taxAmount
      columns.grand_total   = round2(subtotal + taxable.taxAmount)
      columns.tax_percent   = effectiveRatePercent(taxable)
      // Cast: the breakdown is jsonb, not a number, and this map is otherwise numeric.
      ;(columns as Record<string, unknown>).tax_breakdown = taxable.breakdown
    }

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
