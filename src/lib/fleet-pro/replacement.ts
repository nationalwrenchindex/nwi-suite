// ─── Fleet Pro — the replacement recommendation engine ────────────────────────
// SERVER-ONLY (takes a service-role client). Answers one question for a fleet:
// which units have crossed the line from "worth fixing" to "worth replacing".
//
// ── WHAT THIS FILE DOES AND DOES NOT DO ──────────────────────────────────────
// It does NOT compute money. Repair spend comes from loadFleetCosts() in
// src/lib/fleet-pro/cost.ts, which is the one place per-asset cost is summed. This
// file adds the two things that engine has no opinion about — what the asset is
// worth, and how long it sat broken — and then applies the fleet's own thresholds.
//
// The thresholds themselves are read per fleet from hd_fleet_accounts (migration
// 132). "Half the truck's value, three breakdowns" are DB defaults, not policy
// baked into code: a municipal fleet running assets to destruction and a carrier
// protecting resale draw the line in different places.
//
// The pure scoring lives in src/types/fleet-pro-replacement.ts so the page, the
// dashboard card and the PDF all classify a unit by calling the same function.
//
// ── WHAT COUNTS AS A "BREAKDOWN" ─────────────────────────────────────────────
// See the block comment above isPlannedVisit() below. Short version: an unplanned
// shop visit, NOT the cost engine's repair_events.
//
// ── WHAT COUNTS AS "DOWN" ────────────────────────────────────────────────────
// See downtimeDays() below. Short version: created_at → completed_at, and an open
// work order is still down as of now.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadFleetCosts, windowStart } from '@/lib/fleet-pro/cost'
import { COST_WINDOW_MONTHS } from '@/types/fleet-pro-cost'
import {
  REPLACEMENT_DEFAULTS,
  classifyReplacement,
  replacementScore,
  type MissingValueUnit,
  type ReplacementCandidate,
  type ReplacementReport,
  type ReplacementThresholds,
} from '@/types/fleet-pro-replacement'
import type { FleetProMembership } from '@/types/fleet-pro'

// Same ceiling the dashboard and the cost engine use — a large municipal fleet's
// twelve months of work orders must not be silently truncated by PostgREST.
const ROW_CEILING = 20_000

const MS_PER_DAY = 86_400_000

// ─── Row shapes as PostgREST returns them ─────────────────────────────────────

interface UnitRow {
  id:               string
  unit_number:      string | null
  manufacturer:     string | null
  model:            string | null
  year:             number | null
  unit_type:        string | null
  serial_number:    string | null
  status:           string | null
  estimated_value:  number | string | null
  value_updated_at: string | null
}

interface WorkOrderRow {
  id:           string
  unit_id:      string | null
  status:       string | null
  service_type: string | null
  created_at:   string | null
  completed_at: string | null
}

interface PmLinkRow  { work_order_id: string | null }
interface EntryRow   { unit_id: string | null }
interface FleetRow {
  replacement_cost_ratio:    number | string | null
  replacement_breakdown_min: number | string | null
}

/**
 * Local-calendar YYYY-MM-DD. Matches the private helper in cost.ts rather than
 * using toISOString(): windowStart() returns LOCAL midnight, and toISOString would
 * shift that back a day for any server running at a positive UTC offset, so the two
 * halves of this feature would disagree about where the window starts.
 */
function isoDate(d: Date): string {
  const m   = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** PostgREST returns NUMERIC as a string. Absent stays absent — see below. */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

/**
 * Work orders whose service_type names planned work.
 *
 * Free text — there is no enum on hd_work_orders.service_type (migration 047) — so
 * this is a best-effort read of what the shop typed. It is the SECOND of two PM
 * signals; the first, an hd_pm_checklists row pointing at the work order, is
 * authoritative and does not depend on spelling.
 *
 * Deliberately narrow. Matching a bare "maintenance" would swallow "emergency
 * maintenance", and a breakdown misfiled as planned work is the failure mode that
 * makes this report under-report, which is worse than the reverse: a manager who
 * sees a truck he disagrees with argues with the list, a manager who never sees the
 * truck at all never knows to.
 */
const PLANNED_SERVICE_TYPE =
  /\bpm\b|preventat?ive|scheduled\s+(service|maintenance)|\bannual\b|dot\s+inspection/i

/**
 * ── WHY NOT THE COST ENGINE'S repair_events ─────────────────────────────────
 * UnitCostBreakdown.repair_events counts every billable event: invoices plus
 * outside vendor entries. That is the right number for "how many times did we pay
 * for this unit", and the wrong number for "how many times did this unit break":
 *
 *   1. A PM is an invoice. Counting it would flag a well-maintained truck for being
 *      maintained on schedule, which inverts the signal the report exists to give.
 *   2. An invoice is a billing artifact, not a failure. One shop visit can be split
 *      across a progress bill and a final, and a comeback billed at no charge or a
 *      repair covered under warranty produces no invoice at all.
 *
 * So a breakdown here is a SHOP VISIT that was not planned work:
 *
 *   in-house  a non-PM hd_work_orders row created inside the window. One row per
 *             visit, which is the unit of "the truck went down" the dispatcher
 *             recognises, and the same row the downtime measurement comes from.
 *   outside   a fleet_pro_service_entries row. A third-party invoice a tech
 *             photographed at the unit; nobody pays an outside shop for a truck
 *             that was running. These have no work order, so there is no overlap
 *             with the count above.
 *
 * The cost engine's repair_events is still carried on every candidate for
 * reconciliation — see ReplacementCandidate.repair_events.
 *
 * KNOWN LIMIT, stated rather than hidden: a fleet whose shop bills straight from
 * invoices without ever opening a work order will show few in-house breakdowns, and
 * only the cost rule will fire for it. That is a data-entry gap, not a rule that can
 * be fixed here; the report shows both counts side by side so it is visible.
 */
function isPlannedVisit(wo: WorkOrderRow, pmWorkOrderIds: Set<string>): boolean {
  if (pmWorkOrderIds.has(wo.id)) return true
  return !!wo.service_type && PLANNED_SERVICE_TYPE.test(wo.service_type)
}

// ─── Downtime ─────────────────────────────────────────────────────────────────

/** Statuses that mean the work is finished, whether or not completed_at was set. */
const CLOSED_STATUSES = new Set(['completed', 'invoiced', 'closed', 'cancelled', 'canceled'])

interface Downtime {
  breakdowns:       number
  days_total:       number
  measured_events:  number
  open_events:      number
}

/**
 * How long one breakdown had the unit out of service, in days.
 *
 * ── OPEN WORK ORDERS COUNT AS STILL DOWN ────────────────────────────────────
 * A work order with no completed_at and a live status is measured from created_at
 * to NOW. Excluding it would mean the truck that has been sitting in the shop for
 * six weeks scores better than the one that was fixed in two days, which is exactly
 * backwards for a report about whether to keep the truck.
 *
 * Two guards on that:
 *   - The elapsed time is clamped to the length of the rolling window. A work order
 *     somebody opened and forgot must not be able to contribute a multi-year average
 *     and dominate the whole report.
 *   - Open events are counted separately (Downtime.open_events) and surfaced, so the
 *     manager can see that part of the number is still accruing rather than final.
 *
 * ── CLOSED BUT UNDATED IS EXCLUDED FROM THE AVERAGE, NOT FROM THE COUNT ─────
 * A work order marked completed/invoiced with no completed_at has no measurable
 * duration. Guessing one would be fabricating the headline metric. It still counts
 * as a breakdown — it plainly happened — but it contributes nothing to the average,
 * and measured_downtime_events on the candidate says how many did.
 *
 * Returns null when the duration is not measurable.
 */
function downtimeDays(wo: WorkOrderRow, now: Date, windowDays: number): number | null {
  if (!wo.created_at) return null
  const started = Date.parse(wo.created_at)
  if (!Number.isFinite(started)) return null

  if (wo.completed_at) {
    const ended = Date.parse(wo.completed_at)
    if (!Number.isFinite(ended)) return null
    // A completed_at before created_at is a back-dated correction, not negative
    // downtime. Floor at zero rather than letting it subtract from the total.
    return Math.max(0, (ended - started) / MS_PER_DAY)
  }

  const status = (wo.status ?? '').toLowerCase()
  if (CLOSED_STATUSES.has(status)) return null   // finished, but undated — see above

  const open = (now.getTime() - started) / MS_PER_DAY
  return Math.min(Math.max(0, open), windowDays)
}

/** True when the work order is still holding the unit out of service right now. */
function isStillOpen(wo: WorkOrderRow): boolean {
  if (wo.completed_at) return false
  return !CLOSED_STATUSES.has((wo.status ?? '').toLowerCase())
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

/**
 * The fleet's own thresholds. Falls back to the migration-132 defaults only when a
 * column comes back null — never as a hardcoded policy, and never silently for a
 * fleet that has configured something else.
 */
export async function loadReplacementThresholds(
  svc:     SupabaseClient,
  fleetId: string,
): Promise<ReplacementThresholds> {
  const { data } = await svc
    .from('hd_fleet_accounts')
    .select('replacement_cost_ratio, replacement_breakdown_min')
    .eq('id', fleetId)
    .maybeSingle()

  const row = (data ?? null) as FleetRow | null
  const ratio = numOrNull(row?.replacement_cost_ratio)
  const mins  = numOrNull(row?.replacement_breakdown_min)

  return {
    cost_ratio_pct: ratio !== null && ratio > 0 ? ratio : REPLACEMENT_DEFAULTS.cost_ratio_pct,
    breakdown_min:  mins  !== null && mins  >= 1 ? Math.round(mins) : REPLACEMENT_DEFAULTS.breakdown_min,
  }
}

// ─── Downtime + breakdown load ────────────────────────────────────────────────

/**
 * Breakdown counts and downtime for every given unit, over the rolling window.
 *
 * The window is applied to created_at — the day the unit went down. A repair that
 * started before the window belongs to the previous period's count even if it
 * finished inside this one; attributing it here would let one long repair be counted
 * in two consecutive budget years.
 */
async function loadDowntime(
  svc:     SupabaseClient,
  fleetId: string,
  unitIds: string[],
  now:     Date,
): Promise<Map<string, Downtime>> {
  const out = new Map<string, Downtime>()
  for (const id of unitIds) {
    out.set(id, { breakdowns: 0, days_total: 0, measured_events: 0, open_events: 0 })
  }
  if (unitIds.length === 0) return out

  const start = windowStart(now)
  const startIso = isoDate(start)
  const windowDays = Math.max(1, (now.getTime() - start.getTime()) / MS_PER_DAY)

  const [woRes, entryRes] = await Promise.all([
    svc.from('hd_work_orders')
      .select('id, unit_id, status, service_type, created_at, completed_at')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .gte('created_at', startIso)
      .limit(ROW_CEILING),

    // Counted here rather than taken from the cost engine because that engine
    // reports events and money together in one number (repair_events), and this
    // rule needs the outside-vendor half of it on its own. No money is summed here.
    svc.from('fleet_pro_service_entries')
      .select('unit_id')
      .eq('fleet_account_id', fleetId)
      .in('unit_id', unitIds)
      .gte('service_date', startIso)
      .limit(ROW_CEILING),
  ])

  const failed = [woRes, entryRes].find(r => r.error)
  if (failed?.error) throw new Error(`replacement downtime load: ${failed.error.message}`)

  const workOrders = (woRes.data ?? []) as WorkOrderRow[]

  // hd_pm_checklists carries no fleet_account_id of its own — the fleet is reached
  // through the unit, exactly as migration 105's RLS policy does it. unitIds is
  // already fleet-scoped, so scoping on unit_id here is the same tenant boundary.
  const pmWorkOrderIds = new Set<string>()
  if (workOrders.length > 0) {
    const { data: pmData, error: pmError } = await svc
      .from('hd_pm_checklists')
      .select('work_order_id')
      .in('unit_id', unitIds)
      .not('work_order_id', 'is', null)
      .limit(ROW_CEILING)

    if (pmError) throw new Error(`replacement downtime load: ${pmError.message}`)
    for (const row of (pmData ?? []) as PmLinkRow[]) {
      if (row.work_order_id) pmWorkOrderIds.add(row.work_order_id)
    }
  }

  for (const wo of workOrders) {
    if (!wo.unit_id) continue
    const rec = out.get(wo.unit_id)
    if (!rec) continue
    if (isPlannedVisit(wo, pmWorkOrderIds)) continue

    rec.breakdowns += 1
    if (isStillOpen(wo)) rec.open_events += 1

    const days = downtimeDays(wo, now, windowDays)
    if (days !== null) {
      rec.days_total      += days
      rec.measured_events += 1
    }
  }

  for (const e of (entryRes.data ?? []) as EntryRow[]) {
    if (!e.unit_id) continue
    const rec = out.get(e.unit_id)
    if (!rec) continue
    // An outside invoice is a breakdown with no downtime we can measure — nobody
    // recorded when the third-party shop took the truck in or gave it back.
    rec.breakdowns += 1
  }

  return out
}

// ─── The report ───────────────────────────────────────────────────────────────

/**
 * Build the replacement report for one fleet.
 *
 * Every query below is scoped to `membership.fleet_account_id` — the RESOLVED id
 * from requireFleetProMember — and never to anything supplied by the request.
 *
 * CALLER MUST HAVE ALREADY ROLE-GATED. This function returns money unconditionally;
 * the route decides who may call it (see /api/fleet-pro/replacement).
 */
export async function buildReplacementReport(
  svc:        SupabaseClient,
  membership: FleetProMembership,
  now:        Date = new Date(),
): Promise<ReplacementReport> {
  const fleetId = membership.fleet_account_id

  const { data: unitData, error: unitError } = await svc
    .from('hd_units')
    .select('id, unit_number, manufacturer, model, year, unit_type, serial_number, status, estimated_value, value_updated_at')
    .eq('fleet_account_id', fleetId)
    .eq('active', true)
    .order('unit_number', { ascending: true })
    .limit(ROW_CEILING)

  if (unitError) throw new Error(`replacement units load: ${unitError.message}`)

  const units   = (unitData ?? []) as UnitRow[]
  const unitIds = units.map(u => u.id)

  const thresholds = await loadReplacementThresholds(svc, fleetId)

  const start = windowStart(now)
  const base: ReplacementReport = {
    fleet_account_id: fleetId,
    fleet_name:       membership.fleet_name,
    role:             membership.role,
    generated_at:     now.toISOString(),
    window_months:    COST_WINDOW_MONTHS,
    window_start:     isoDate(start),
    thresholds,
    unit_count:          units.length,
    candidate_count:     0,
    urgent_count:        0,
    missing_value_count: 0,
    candidate_spend:     0,
    candidates:    [],
    missing_value: [],
  }

  if (unitIds.length === 0) return base

  const [costs, downtime] = await Promise.all([
    loadFleetCosts(svc, fleetId, unitIds, now),
    loadDowntime(svc, fleetId, unitIds, now),
  ])

  const candidates:   ReplacementCandidate[] = []
  const missingValue: MissingValueUnit[]     = []

  for (const u of units) {
    const cost = costs.get(u.id)
    const down = downtime.get(u.id) ?? { breakdowns: 0, days_total: 0, measured_events: 0, open_events: 0 }

    const metrics = {
      cost_12mo:       cost?.total_cost ?? 0,
      // numOrNull, not num: an unset value must stay null all the way through the
      // rule. Coercing it to 0 here would make every un-valued unit read as
      // infinitely over threshold and fill the report with noise.
      estimated_value: numOrNull(u.estimated_value),
      breakdown_count: down.breakdowns,
    }

    // Surfaced whether or not the unit is flagged: the manager cannot act on the
    // cost rule for these until he types a number, and a silent exclusion would let
    // a whole fleet be half-evaluated without anyone noticing.
    if (metrics.estimated_value === null) {
      missingValue.push({
        unit_id:     u.id,
        unit_number: u.unit_number ?? '',
        cost_12mo:   metrics.cost_12mo,
      })
    }

    const verdict = classifyReplacement(metrics, thresholds)
    if (!verdict.is_candidate) continue

    candidates.push({
      unit_id:       u.id,
      unit_number:   u.unit_number ?? '',
      manufacturer:  u.manufacturer,
      model:         u.model,
      year:          u.year,
      unit_type:     u.unit_type,
      serial_number: u.serial_number,
      status:        u.status,

      cost_12mo:        metrics.cost_12mo,
      estimated_value:  metrics.estimated_value,
      value_updated_at: u.value_updated_at,
      value_status:     verdict.value_status,
      cost_ratio_pct:   verdict.cost_ratio_pct,

      breakdown_count: down.breakdowns,
      repair_events:   cost?.repair_events ?? 0,

      // Mean over the events that actually had a measurable duration, not over every
      // breakdown: dividing by breakdowns that contributed nothing would quietly drag
      // the average toward zero and make a badly-recorded unit look healthy.
      avg_days_down:            down.measured_events > 0 ? down.days_total / down.measured_events : null,
      days_down_total:          down.days_total,
      measured_downtime_events: down.measured_events,
      open_work_orders:         down.open_events,

      triggers: verdict.triggers,
      level:    verdict.level,
      score:    replacementScore(verdict, metrics, thresholds),
    })
  }

  candidates.sort((a, b) =>
    b.score - a.score ||
    a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true }),
  )

  // Worst spend first: the point of this list is which units to fix by writing a
  // cheque, and the manager reads it top down.
  missingValue.sort((a, b) =>
    b.cost_12mo - a.cost_12mo ||
    a.unit_number.localeCompare(b.unit_number, 'en', { numeric: true }),
  )

  return {
    ...base,
    candidate_count:     candidates.length,
    urgent_count:        candidates.filter(c => c.level === 'urgent').length,
    missing_value_count: missingValue.length,
    candidate_spend:     candidates.reduce((sum, c) => sum + c.cost_12mo, 0),
    candidates,
    missing_value:       missingValue,
  }
}
