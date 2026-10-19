// The colour and label of a unit's category chip (PM Schedules' Type column).
//
// Reads the unit's category - category_id is the source since migration 161 - not
// unit_type. A category named Truck keeps the truck blue the chip always had; anything
// else, a shop's own Boom, Genset or Crane included, is neutral rather than pretending to
// be a trailer; no category says Uncategorized. Pure, so
// scripts/verify-equipment-categories.ts can hold it.

export const TRUCK_BLUE   = '#3B82F6'
export const NEUTRAL_CHIP = '#94A3B8'

export function unitCategoryChip(categoryName: string | null | undefined): { label: string; color: string } {
  const name = (categoryName ?? '').trim()
  if (!name) return { label: 'Uncategorized', color: NEUTRAL_CHIP }
  return { label: name, color: name.toLowerCase() === 'truck' ? TRUCK_BLUE : NEUTRAL_CHIP }
}
