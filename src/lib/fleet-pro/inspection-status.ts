// ─── What a failed inspection means for the unit ──────────────────────────────
//
// A FAIL and an OUT OF SERVICE are two separate decisions, and the trade already
// treats them that way. 49 CFR 396.11 asks the mechanic to certify whether a defect
// "would affect the safety of operation"; CVSA out-of-service criteria are a separate
// standard from "something is wrong."
//
// Every fleet surface used to derive one boolean from `overall_result === 'fail'`, so
// a missing DOT decal flagged a unit exactly like a cracked boom weld. Shops noticed:
// if failing an item shuts down a working machine, the honest answer is to mark it
// Pass, and then the form is worth nothing.
//
// `removed_from_service` was ALREADY being captured on aerial and equipment
// inspections — the aerial and equipment forms refuse to submit a safety-critical
// failure until the tech confirms the unit is removed and tagged — and every dashboard
// ignored it. This module is the one place that reads it.

/** Three states, in descending severity. */
export type UnitInspectionState = 'out_of_service' | 'needs_repair' | 'clear'

export interface InspectionStatusInput {
  /** `overall_result`. Anything that is not an explicit 'pass' counts as a fail. */
  result: string | null | undefined
  /**
   * `removed_from_service`, where the form has that column (aerial, equipment).
   *
   * undefined or null means THE QUESTION WAS NEVER ASKED — either the form has no
   * such column (DOT, reefer PM, pre-trip) or the record predates it. That is not
   * the same as "no", and it is deliberately not treated as one: see
   * `oosAssessed` below.
   */
  removedFromService?: boolean | null
  /** Items carrying an explicit per-item out-of-service determination. */
  oosItemCount?: number | null
}

/** True for anything that is not an explicit pass — never silently green. */
export function isFailResult(result: string | null | undefined): boolean {
  return (result ?? '').toLowerCase() !== 'pass'
}

/** True when this record actually took an out-of-service position, either way. */
export function oosAssessed(i: InspectionStatusInput): boolean {
  return i.removedFromService != null || (i.oosItemCount ?? null) != null
}

/** True when this record puts the unit out of service. */
export function isOutOfService(i: InspectionStatusInput): boolean {
  return i.removedFromService === true || (i.oosItemCount ?? 0) > 0
}

/**
 * Roll a unit's inspection history into one state.
 *
 *   out_of_service  at least one inspection removed it from service, or carries an
 *                   item with an out-of-service determination
 *   needs_repair    fails exist, none of them out of service
 *   clear           no fails
 *
 * A unit with no inspections at all is `clear`: nothing has been found wrong. The
 * caller distinguishes "never inspected" with last_inspection_date, because that is a
 * scheduling question, not a defect question.
 */
export function unitInspectionState(inspections: InspectionStatusInput[]): UnitInspectionState {
  let anyFail = false
  for (const i of inspections) {
    if (isOutOfService(i)) return 'out_of_service'
    if (isFailResult(i.result)) anyFail = true
  }
  return anyFail ? 'needs_repair' : 'clear'
}

/**
 * The three states must read distinctly: a missing decal must not look like a cracked
 * weld. Defined once so no surface can invent its own wording or colour.
 */
export const INSPECTION_STATE_META: Record<UnitInspectionState, {
  label: string
  /** Shorter form, for a dense table cell. */
  short: string
  color: string
}> = {
  out_of_service: { label: 'Out of service', short: 'OOS',    color: '#EF4444' },
  needs_repair:   { label: 'Needs repair',   short: 'Repair', color: '#F59E0B' },
  clear:          { label: 'Pass',           short: 'Pass',   color: '#22C55E' },
}

/**
 * Whether a unit's state rests on records that never answered the out-of-service
 * question — every DOT, reefer PM and pre-trip record written before this shipped.
 *
 * Those genuinely do not say whether the defect was out-of-service, and this build
 * does not invent an answer for them: they read as `needs_repair`, which is the
 * honest floor, and a caller can use this to say "not assessed" rather than implying
 * a mechanic made a call they were never asked to make.
 */
export function hasUnassessedFail(inspections: InspectionStatusInput[]): boolean {
  return inspections.some(i => isFailResult(i.result) && !oosAssessed(i))
}
