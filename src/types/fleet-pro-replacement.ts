// ─── Fleet Pro — replacement recommendation shapes + the rule itself ──────────
// CLIENT-SAFE. Types and pure functions only; the queries live in
// src/lib/fleet-pro/replacement.ts (server-only), exactly as fleet-pro-cost.ts
// relates to fleet-pro/cost.ts.
//
// The classification lives HERE rather than in the server module so the list page,
// the dashboard card and the PDF all decide "is this unit a candidate, and how
// badly" by calling one function. A second copy of the rule in the renderer is how
// a card ends up saying 'urgent' next to a table row that says 'review'.

import type { FleetProRole } from './fleet-pro'
import { money } from '@/lib/format'

/** Which of the two rules fired. A unit can trip one, the other, or both. */
export type ReplacementTrigger = 'cost_ratio' | 'breakdowns'

/**
 * How loudly to shout. Deliberately only two levels, and derived from the COUNT of
 * triggers rather than from how far past a threshold the unit is: the thresholds are
 * per-fleet and configurable, so "200% of the limit" means different things in
 * different fleets, while "both independent tests agree" means the same everywhere.
 */
export type ReplacementLevel = 'urgent' | 'review'

/** The per-fleet thresholds from hd_fleet_accounts (migration 132). */
export interface ReplacementThresholds {
  /** Repair spend as a percent of estimated value, e.g. 50 = half the truck. */
  cost_ratio_pct: number
  /** Breakdowns in the window that on their own justify a review. */
  breakdown_min:  number
}

/**
 * Mirror of the DB defaults in migration 132. Used ONLY as the fallback when a fleet
 * row somehow comes back without them (a partial select, or a driver that hands back
 * NULL for a column added after the row). Every live path reads the fleet's own
 * configured values — nothing in this feature treats 50/3 as policy.
 */
export const REPLACEMENT_DEFAULTS: ReplacementThresholds = {
  cost_ratio_pct: 50,
  breakdown_min:  3,
}

/**
 * Whether the manager has told us what the asset is worth.
 *
 * This is a first-class state, not a null to paper over. A unit with no estimated
 * value cannot have a cost ratio: treating the value as 0 makes every unit
 * infinitely over threshold and the report becomes noise, while dropping the unit
 * hides a truck that may well be failing the breakdown test. So the ratio is null,
 * the breakdown rule still runs on its own, and the UI asks the manager for a number.
 */
export type ValueStatus = 'set' | 'not_set'

// ─── The rule ─────────────────────────────────────────────────────────────────

/** The three facts the rule needs. Everything else on a candidate is display. */
export interface ReplacementMetrics {
  /** Total repair spend across the rolling window, from the cost engine. */
  cost_12mo:       number
  /** Manager's estimate of current market value. null when never set. */
  estimated_value: number | null
  /** Unplanned shop visits in the window. See isPlannedVisit in replacement.ts. */
  breakdown_count: number
}

export interface ReplacementVerdict {
  is_candidate:   boolean
  triggers:       ReplacementTrigger[]
  level:          ReplacementLevel
  /** null when estimated_value is unset or zero — never a fabricated number. */
  cost_ratio_pct: number | null
  value_status:   ValueStatus
}

/**
 * Repair spend as a percent of what the asset is worth.
 *
 * Returns null — not Infinity, not 0 — when there is no usable denominator, for the
 * same reason perUnitOfUse does: "unknown" and "zero" are different answers and only
 * one of them should be allowed to fire an alarm. A zero or negative estimated value
 * is treated as unset; a truck the manager valued at $0 is already written off, and
 * a ratio against it carries no information.
 */
export function costRatioPct(cost12mo: number, estimatedValue: number | null): number | null {
  if (estimatedValue === null || !Number.isFinite(estimatedValue) || estimatedValue <= 0) return null
  if (!Number.isFinite(cost12mo) || cost12mo < 0) return null
  return (cost12mo / estimatedValue) * 100
}

/**
 * Apply the fleet's thresholds to one unit.
 *
 * The two rules are independent ORs by design. A cheap trailer that eats its own
 * value in one expensive repair is a budget problem; a truck that has been towed in
 * three times is a dispatch problem. Requiring both would hide each of them.
 */
export function classifyReplacement(
  metrics:    ReplacementMetrics,
  thresholds: ReplacementThresholds,
): ReplacementVerdict {
  const ratio = costRatioPct(metrics.cost_12mo, metrics.estimated_value)
  const triggers: ReplacementTrigger[] = []

  if (ratio !== null && ratio >= thresholds.cost_ratio_pct) triggers.push('cost_ratio')
  if (metrics.breakdown_count >= thresholds.breakdown_min)  triggers.push('breakdowns')

  return {
    is_candidate:   triggers.length > 0,
    triggers,
    level:          triggers.length > 1 ? 'urgent' : 'review',
    cost_ratio_pct: ratio,
    value_status:   ratio === null ? 'not_set' : 'set',
  }
}

/**
 * Sort key, descending. Both tests are normalised against the fleet's OWN thresholds
 * before being compared, so a fleet that draws the line at 35% and one that draws it
 * at 80% each get a list ordered by "how far past our line is this", rather than by a
 * raw percentage that means something different in each.
 */
export function replacementScore(
  verdict:    ReplacementVerdict,
  metrics:    ReplacementMetrics,
  thresholds: ReplacementThresholds,
): number {
  const ratioPart = verdict.cost_ratio_pct === null
    ? 0
    : verdict.cost_ratio_pct / Math.max(1, thresholds.cost_ratio_pct)
  const breakPart = metrics.breakdown_count / Math.max(1, thresholds.breakdown_min)
  // Both triggers firing outranks either one alone, however extreme the single one
  // is: two independent signals agreeing is stronger evidence than one signal being
  // loud, and the manager's meeting time goes to the trucks nobody can argue about.
  return verdict.triggers.length * 1000 + Math.max(ratioPart, breakPart)
}

// ─── Wire shapes ──────────────────────────────────────────────────────────────

/** One flagged unit, with everything the card and the PDF row need. */
export interface ReplacementCandidate {
  unit_id:         string
  unit_number:     string
  manufacturer:    string | null
  model:           string | null
  year:            number | null
  unit_type:       string | null
  serial_number:   string | null
  status:          string | null

  /** Rolling-window repair spend, from src/lib/fleet-pro/cost.ts. */
  cost_12mo:        number
  estimated_value:  number | null
  value_updated_at: string | null
  value_status:     ValueStatus
  cost_ratio_pct:   number | null

  /** The rule's breakdown count — unplanned visits, NOT every billable event. */
  breakdown_count: number
  /**
   * The cost engine's billable-event count (invoices + outside vendor entries),
   * carried alongside so the two numbers can be reconciled by whoever questions the
   * report in the meeting. It is never the rule input; see the block comment above
   * isPlannedVisit in src/lib/fleet-pro/replacement.ts for why.
   */
  repair_events:   number

  /** Downtime, derived from hd_work_orders. null when nothing was measurable. */
  avg_days_down:            number | null
  days_down_total:          number
  /** How many breakdowns actually contributed a duration to the average. */
  measured_downtime_events: number
  /** Work orders still open — their downtime is still accruing. */
  open_work_orders:         number

  triggers: ReplacementTrigger[]
  level:    ReplacementLevel
  score:    number
}

/** A unit the cost rule could not be run against, so the manager can fix it. */
export interface MissingValueUnit {
  unit_id:     string
  unit_number: string
  cost_12mo:   number
}

export interface ReplacementReport {
  fleet_account_id: string
  fleet_name:       string
  role:             FleetProRole
  generated_at:     string      // ISO timestamp, printed on the PDF
  window_months:    number
  window_start:     string      // YYYY-MM-DD
  thresholds:       ReplacementThresholds

  /** Active units evaluated, candidates found, and units missing a value. */
  unit_count:          number
  candidate_count:     number
  urgent_count:        number
  missing_value_count: number

  /** Combined twelve-month spend of the flagged units — the budget headline. */
  candidate_spend:  number

  candidates:    ReplacementCandidate[]
  missing_value: MissingValueUnit[]
}

// ─── Display helpers (pure, shared by the page, the card and the PDF) ─────────

export const TRIGGER_LABEL: Record<ReplacementTrigger, string> = {
  cost_ratio: 'Repair cost vs value',
  breakdowns: 'Breakdown frequency',
}

export function formatRatio(pct: number | null): string {
  return pct === null ? 'Value not set' : `${pct.toFixed(0)}% of value`
}

export function formatDaysDown(days: number | null): string {
  if (days === null) return '—'
  return `${days.toFixed(1)} ${days === 1 ? 'day' : 'days'}`
}

export function formatMoney(n: number | null): string {
  if (n === null) return '—'
  return money(n)
}

/** One line saying why the unit is on the list. Used on the card and in the PDF. */
export function replacementReason(c: ReplacementCandidate, t: ReplacementThresholds): string {
  const parts: string[] = []
  if (c.triggers.includes('cost_ratio') && c.cost_ratio_pct !== null) {
    parts.push(`repairs are ${c.cost_ratio_pct.toFixed(0)}% of value (limit ${t.cost_ratio_pct}%)`)
  }
  if (c.triggers.includes('breakdowns')) {
    parts.push(`${c.breakdown_count} breakdowns in 12 months (limit ${t.breakdown_min})`)
  }
  return parts.join(' and ') || 'Under review'
}

/** Short unit descriptor: "2019 Thermo King T-880". Empty parts drop out. */
export function unitLabel(c: Pick<ReplacementCandidate, 'year' | 'manufacturer' | 'model'>): string {
  return [c.year ? String(c.year) : null, c.manufacturer, c.model]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(' ')
}
