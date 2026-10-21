// Reads "what kind of equipment" from an imported file, and never guesses it.
//
// PURE. Used by the CSV unit importer and the Fullbay importer. A type in the file is
// matched to one of the shop's ACTIVE categories by name - trimmed, case-insensitive,
// nothing looser. A match sets category_id (migration 161's trigger then copies the name
// into unit_type). No type, or a type that names no category, leaves the unit BLANK:
// category_id null AND unit_type null, written explicitly so the old column default
// ('trailer') cannot fill it in. Blank lands in Uncategorized, where it is visible and
// can be sorted; Trailer would be a guess presented as a fact.
//
// An unmatched type is reported back by name and count, so the shop can see "Reefer: 12
// units" and either add that category or re-sort them.

export interface CategoryOption { id: string; name: string; is_active?: boolean | null }

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The category a file's type names, or null. Only active categories match. */
export function matchCategoryByType(raw: string | null | undefined, categories: CategoryOption[]): string | null {
  if (raw == null) return null
  const t = norm(String(raw))
  if (!t) return null
  const hit = categories.find(c => c.is_active !== false && norm(c.name) === t)
  return hit?.id ?? null
}

/**
 * The type columns a NEW unit row is written with. unit_type is always written null:
 * with a category, migration 161's BEFORE INSERT trigger replaces it with the category's
 * name; without one it stays null instead of taking the column default. Every row
 * carries the same keys, so a batch insert treats them alike.
 */
export function typeColumns(raw: string | null | undefined, categories: CategoryOption[]): { category_id: string | null; unit_type: null } {
  return { category_id: matchCategoryByType(raw, categories), unit_type: null }
}

export interface TypeSummary {
  /** Units whose type matched a category. */
  categorized: number
  /** Units left blank (Uncategorized). */
  uncategorized: number
  /** Of those, how many had no type in the file at all. */
  noTypeInFile: number
  /** Types the file named that match no active category, with how many units each. */
  unmatchedTypes: { type: string; count: number }[]
}

export function summarizeTypes(raws: Array<string | null | undefined>, categories: CategoryOption[]): TypeSummary {
  const out: TypeSummary = { categorized: 0, uncategorized: 0, noTypeInFile: 0, unmatchedTypes: [] }
  const unmatched = new Map<string, { type: string; count: number }>()
  for (const raw of raws) {
    if (matchCategoryByType(raw, categories)) { out.categorized++; continue }
    out.uncategorized++
    const shown = raw == null ? '' : String(raw).trim().replace(/\s+/g, ' ')
    if (!shown) { out.noTypeInFile++; continue }
    const key = shown.toLowerCase()
    const entry = unmatched.get(key) ?? { type: shown, count: 0 }
    entry.count++
    unmatched.set(key, entry)
  }
  out.unmatchedTypes = [...unmatched.values()].sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
  return out
}
