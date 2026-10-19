/**
 * Request parsing for POST /api/hd/fleet-units/category - set (or clear) the category
 * on one or many units. Pure, so scripts/verify-equipment-categories.ts can hold it.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kurt has tens of units and sorts them in one sitting; this is a guard against a
// runaway request, not a working limit.
export const MAX_UNITS_PER_REQUEST = 500

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}

export function parseSetCategoryBody(body: unknown):
  { unitIds: string[]; categoryId: string | null } | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid body' }
  const b = body as { unit_ids?: unknown; category_id?: unknown }

  if (!Array.isArray(b.unit_ids) || b.unit_ids.length === 0) return { error: 'unit_ids must list at least one unit.' }
  if (!b.unit_ids.every(isUuid)) return { error: 'unit_ids must be unit ids.' }
  const unitIds = [...new Set(b.unit_ids as string[])]
  if (unitIds.length > MAX_UNITS_PER_REQUEST) {
    return { error: `Too many units at once - at most ${MAX_UNITS_PER_REQUEST}.` }
  }

  // null (or absent) clears it: the unit reports under Uncategorized.
  if (b.category_id == null || b.category_id === '') return { unitIds, categoryId: null }
  if (!isUuid(b.category_id)) return { error: 'category_id must be a category id, or null for Uncategorized.' }
  return { unitIds, categoryId: b.category_id }
}
