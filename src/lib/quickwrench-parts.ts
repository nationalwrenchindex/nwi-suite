// LD QuickWrench parts, as the Tech Guide lists them and the Quote screen opens with them.
// Moved out of components/quickwrench/QuickWrenchClient on Nov 7, 2026, so the walk
// (scripts/walk-qw-parts-on-guide.ts) runs the same code the screen does.

import type { PartWithSuppliers, Supplier, TechGuidePart } from '@/types/quickwrench'

// A generated part name can carry a generated part number ("... - OEM Part# 12345")
// or a price ("($45.99)"). Neither has a source behind it, so neither is shown: the
// parts list is names and quantities only. No QuickWrench parts source supplies a
// real part number today, so no number is shown at all rather than a made-up one.
export function partNameOnly(full: string): string {
  return full
    .replace(/\s*(?:[—-]\s*)?[(\[]?\s*(?:(?:OEM\s*)?Part\s*(?:#|No\.?|Number)|OEM\s*(?:#|No\.|Number|:)|P\/N)\s*:?\s*[A-Za-z0-9][A-Za-z0-9-]{2,}\s*[)\]]?/gi, '')
    .replace(/\s*[(\[]?\s*(?:approx\.?|est\.?|~)?\s*\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:each|ea|\/\s*\w+))?\s*[)\]]?/gi, '')
    .replace(/\$/g, '')
    .replace(/\s+[—-]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || 'Part'
}

// `scope` is the job key. Without it two jobs both produce `part-0-…`, and
// since partCosts and partPriceOverrides are keyed by part id, editing a price
// on one job silently rewrote the same-index part on the other.
//
// NO GENERATED PRICE (Nov 7). The tech guide's AI answer carries a "demo" unit_cost
// per part - round numbers with no source. That figure used to seed the Parts
// screen's price box; it is dropped here, so nothing generated is ever shown or
// sent. The Quote screen prices a part only from the Cost the tech types.
export function enrichParts(raw: Array<TechGuidePart | string>, scope = ''): PartWithSuppliers[] {
  return raw.map((part, i) => {
    const name = partNameOnly(typeof part === 'string' ? part : part.name)
    const qty  = typeof part === 'string' ? 1    : (part.qty       ?? 1)
    return {
      name,
      part_number_hint:  '',
      qty,
      price_estimate:    0,
      id:                `part-${scope}-${i}-${name.slice(0, 8).replace(/\s/g, '')}`,
      included:          true,
      // There used to be four invented "retailer" prices here (the estimate x 1.06 /
      // 1.02 / 1.10 / 0.76, labelled AutoZone, O'Reilly, NAPA, RockAuto) with O'Reilly
      // preselected. NWI has no retailer partnerships, and no store name may sit beside
      // a price.
      selected_supplier: 'custom' as Supplier,
      custom_price:      0,
    }
  })
}
