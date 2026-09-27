// ─── Resolving a segment's parent, and the one rule that guards it ────────────
// SERVER ONLY.
//
// Segments live in one table with two parent columns (migration 137). This is where
// "which product" is decided, so no route and no shared component has to branch on it.

import type { SupabaseClient } from '@supabase/supabase-js'

export type SegmentProduct = 'ld' | 'hd'

interface ParentSpec {
  table:     'work_orders' | 'hd_work_orders'
  fkColumn:  'ld_work_order_id' | 'hd_work_order_id'
  /** The parent's own line-item store, checked by the parent-priced guard. LD keeps
   *  its items in a JSONB column; HD keeps them in hd_work_order_line_items, so the
   *  guard has to ask a different question per product. */
  lineItems: { kind: 'column'; name: string } | { kind: 'table'; name: string; fk: string }
  /** Column recording that the record has been billed. */
  invoicedColumn: string
}

export const PARENTS: Record<SegmentProduct, ParentSpec> = {
  ld: {
    table:          'work_orders',
    fkColumn:       'ld_work_order_id',
    lineItems:      { kind: 'column', name: 'line_items' },
    invoicedColumn: 'converted_invoice_id',
  },
  hd: {
    table:          'hd_work_orders',
    fkColumn:       'hd_work_order_id',
    lineItems:      { kind: 'table', name: 'hd_work_order_line_items', fk: 'work_order_id' },
    // HD marks a billed job by status rather than by a link column; the guard below
    // reads it as a status so this stays a single field name.
    invoicedColumn: 'status',
  },
}

export interface GuardResult {
  ok:      boolean
  /** Populated when ok === false. Written for a tech to read, not a developer. */
  reason?: string
}

/**
 * PARENT-PRICED OR SEGMENT-PRICED, NEVER BOTH.
 *
 * A segment may not be added to a work order that already carries parent line items,
 * or that has been invoiced. Legacy work orders stay legacy and keep working exactly
 * as they do now; new work orders use segments.
 *
 * This is a guard rather than a rule techs have to remember, and it is checked in the
 * API rather than by a database constraint for two reasons: the rule spans two tables,
 * and a refusal needs to explain itself in a sentence the tech can act on instead of
 * surfacing as a constraint violation.
 *
 * Moving a legacy work order onto segments is a deliberate "convert to segments"
 * action, to be built separately. It must never happen as a side effect of adding a
 * segment.
 */
export async function guardCanAddSegment(
  supabase: SupabaseClient,
  product:  SegmentProduct,
  parentId: string,
  userId:   string,
): Promise<GuardResult> {
  const spec = PARENTS[product]

  // Already has segments? Then it is segment-priced and adding another is fine —
  // return early so the parent-line check below cannot reject it.
  const { count: segmentCount } = await supabase
    .from('work_order_segments')
    .select('id', { count: 'exact', head: true })
    .eq(spec.fkColumn, parentId)
    .eq('user_id', userId)

  if ((segmentCount ?? 0) > 0) return { ok: true }

  // Billed?
  // Literal selects per product rather than a computed string: Supabase types the
  // select at compile time from the literal, and a template one degrades to a
  // ParserError. The columns differ per product anyway.
  const { data: parent } = product === 'ld'
    ? await supabase
        .from('work_orders')
        .select('id, converted_invoice_id, line_items')
        .eq('id', parentId).eq('user_id', userId).single()
    : await supabase
        .from('hd_work_orders')
        .select('id, status')
        .eq('id', parentId).eq('user_id', userId).single()

  if (!parent) return { ok: false, reason: 'Work order not found.' }

  const row = parent as unknown as Record<string, unknown>

  const invoiced = product === 'ld'
    ? row.converted_invoice_id != null
    : row.status === 'invoiced'

  if (invoiced) {
    return {
      ok: false,
      reason: 'This work order has been invoiced, so segments cannot be added to it. '
            + 'Open a new work order for the additional work.',
    }
  }

  // Parent line items?
  let hasParentLines = false
  if (spec.lineItems.kind === 'column') {
    const items = row[spec.lineItems.name]
    hasParentLines = Array.isArray(items) && items.length > 0
  } else {
    const { count } = await supabase
      .from(spec.lineItems.name)
      .select('id', { count: 'exact', head: true })
      .eq(spec.lineItems.fk, parentId)
    hasParentLines = (count ?? 0) > 0
  }

  if (hasParentLines) {
    return {
      ok: false,
      reason: 'This work order is already priced with its own line items. A work order '
            + 'is either priced directly or split into segments, never both — clear its '
            + 'line items first, or start a new work order for the additional work.',
    }
  }

  return { ok: true }
}

/** Ownership check for a parent, used by every segment route before it writes. */
export async function parentExists(
  supabase: SupabaseClient,
  product:  SegmentProduct,
  parentId: string,
  userId:   string,
): Promise<boolean> {
  const { data } = await supabase
    .from(PARENTS[product].table)
    .select('id')
    .eq('id', parentId)
    .eq('user_id', userId)
    .single()
  return !!data
}
