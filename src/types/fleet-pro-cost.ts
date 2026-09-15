// ─── Fleet Pro — per-asset cost shapes ────────────────────────────────────────
// CLIENT-SAFE. Types + pure helpers only; the queries live in
// src/lib/fleet-pro/cost.ts (server-only).

/** One month of a rolling twelve, oldest first. `month` is 'YYYY-MM'. */
export interface MonthlyCost {
  month: string
  cost:  number
}

/**
 * Everything the cost engine knows about one unit over the rolling window.
 *
 * ── HOW THE BUCKETS RELATE ───────────────────────────────────────────────────
 * parts_cost + labor_cost + other_cost === total_cost, exactly. `other_cost` is
 * the remainder — tax, diagnostic and road-call fees — and exists so the three
 * named buckets never silently fail to reconcile against the invoice totals.
 *
 * `vendor_cost` is NOT a fourth addend. It is a cut of the same money by SOURCE:
 * the share of total_cost that came from an outside vendor's invoice rather than
 * from the fleet's own shop. Adding it to the other three double-counts.
 */
export interface UnitCostBreakdown {
  unit_id:       string

  parts_cost:    number
  labor_cost:    number
  other_cost:    number
  total_cost:    number

  /** Subset of total_cost billed by a third party. Overlaps the buckets above. */
  vendor_cost:   number

  /** Distance/hours accumulated across the window, from the meter series. */
  miles_driven:  number | null
  hours_run:     number | null

  /** null when the denominator is unknown or zero — never a fabricated 0. */
  cost_per_mile: number | null
  cost_per_hour: number | null

  /** Distinct billable repair events: invoices + outside service entries. */
  repair_events: number

  months:        MonthlyCost[]
}

/** The rolling window is twelve months back from today. */
export const COST_WINDOW_MONTHS = 12

export function emptyBreakdown(unitId: string): UnitCostBreakdown {
  return {
    unit_id: unitId,
    parts_cost: 0, labor_cost: 0, other_cost: 0, total_cost: 0, vendor_cost: 0,
    miles_driven: null, hours_run: null,
    cost_per_mile: null, cost_per_hour: null,
    repair_events: 0,
    months: [],
  }
}

/**
 * Money per unit of use. Returns null rather than Infinity or 0 when the
 * denominator is missing or zero — a unit that has not moved has no cost per
 * mile, and rendering that as "$0.00/mi" reads as cheap when it means unknown.
 */
export function perUnitOfUse(cost: number, denominator: number | null): number | null {
  if (denominator === null || !Number.isFinite(denominator) || denominator <= 0) return null
  if (!Number.isFinite(cost)) return null
  return cost / denominator
}

export function formatPerMile(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}/mi`
}

export function formatPerHour(v: number | null): string {
  return v === null ? '—' : `$${v.toFixed(2)}/hr`
}
