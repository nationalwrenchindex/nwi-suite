/**
 * The rules for editing a shop's equipment categories. Pure - no database - so
 * scripts/verify-equipment-categories.ts can hold them.
 *
 * Lives outside route.ts because Next rejects any export from a route file that
 * is not a handler or a route-segment config.
 *
 * The table's own unique constraint is (user_id, name), which is case-SENSITIVE:
 * "Truck" and "truck" would both be accepted. Both would then mirror into unit_type
 * as "truck" (migration 161 lowercases it), so two categories would be one value
 * everywhere unit_type is still read. The clash check here is case-insensitive for
 * that reason, and the route runs it before the insert rather than relying on 23505.
 */

export const CATEGORY_NAME_MAX = 60

export interface CategoryLike {
  id:         string
  name:       string
  sort_order: number
  is_active:  boolean
}

/** Trim and collapse inner whitespace. Returns the name, or a readable reason it is refused. */
export function cleanCategoryName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Category name is required.' }
  const name = raw.replace(/\s+/g, ' ').trim()
  if (!name) return { error: 'Category name cannot be blank.' }
  if (name.length > CATEGORY_NAME_MAX) {
    return { error: `Category name is too long - keep it to ${CATEGORY_NAME_MAX} characters.` }
  }
  return { name }
}

/** The existing category this name would collide with (case-insensitive), ignoring `exceptId`. */
export function findNameClash<T extends CategoryLike>(categories: T[], name: string, exceptId?: string | null): T | null {
  const want = name.toLowerCase()
  return categories.find(c => c.id !== exceptId && c.name.trim().toLowerCase() === want) ?? null
}

/** The 409 text for a clash - says whether the existing one is merely deactivated. */
export function clashMessage(name: string, existing: CategoryLike): string {
  return existing.is_active
    ? `A category named "${existing.name}" already exists.`
    : `A category named "${existing.name}" already exists but is deactivated - reactivate it instead of adding "${name}".`
}

/** sort_order for a new category: after everything the shop has, in steps of 10 like the seed. */
export function nextSortOrder(categories: CategoryLike[]): number {
  const max = categories.reduce((m, c) => Math.max(m, Number(c.sort_order) || 0), 0)
  return max + 10
}

/**
 * Validate a full reorder and return the sort_order each id should get.
 *
 * The order must name every one of the shop's categories exactly once, inactive ones
 * included - a partial list would leave the unnamed ones at stale positions that can
 * interleave with the new ones. An id that is not the shop's is refused outright.
 * Only the rows whose position actually changes are returned.
 */
export function planReorder(
  categories: CategoryLike[],
  order: unknown,
): { updates: { id: string; sort_order: number }[] } | { error: string } {
  if (!Array.isArray(order) || order.some(id => typeof id !== 'string')) {
    return { error: 'order must be a list of category ids.' }
  }
  const ids = order as string[]
  if (new Set(ids).size !== ids.length) return { error: 'order lists a category more than once.' }
  const known = new Map(categories.map(c => [c.id, c]))
  if (ids.some(id => !known.has(id))) return { error: 'order includes a category that is not on your account.' }
  if (ids.length !== categories.length) return { error: 'order must include every one of your categories.' }

  const updates: { id: string; sort_order: number }[] = []
  ids.forEach((id, i) => {
    const sort_order = (i + 1) * 10
    if (known.get(id)!.sort_order !== sort_order) updates.push({ id, sort_order })
  })
  return { updates }
}
