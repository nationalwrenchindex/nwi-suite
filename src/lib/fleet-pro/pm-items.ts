// ─── Model-specific PM items ───────────────────────────────────────────────────
//
// THE CONTAINER, NOT THE CONTENTS. Nothing in this file knows what a fuel filter
// is. Every interval, every model list and every "why" is a row in `pm_items`
// (migration 144), so a second item needs a row and no code change at all.
//
// THERE IS NO COMPONENTS TABLE. `fleet_pro_unit_components` does not exist —
// PostgREST returns PGRST205 for it. The only unit table is `hd_units`, so status
// is per UNIT and `component_type` on the ITEM is what tells a reefer item apart
// from a chassis one. component_id is carried through as a nullable seam.

/** reefer | apu | chassis, and whatever is added next. Free text by design. */
export type ComponentType = string

export type IntervalRule = 'hours' | 'months' | 'first_of_either'

export interface PmItem {
  id:                string
  user_id:           string | null
  name:              string
  part_number:       string | null
  component_type:    ComponentType
  /** NULL or empty = every model. */
  applies_to_models: string[] | null
  interval_hours:    number | null
  interval_months:   number | null
  warn_months:       number | null
  interval_rule:     IntervalRule
  why:               string | null
  is_critical:       boolean
}

export interface UnitPmItemStatus {
  id:                   string
  unit_id:              string
  component_id:         string | null
  pm_item_id:           string
  /** NULL = never recorded. NOT "due now", NOT "done". */
  last_completed_on:    string | null
  last_completed_hours: number | null
  next_due_on:          string | null
  next_due_hours:       number | null
}

export const PM_ITEM_SELECT =
  'id, user_id, name, part_number, component_type, applies_to_models, ' +
  'interval_hours, interval_months, warn_months, interval_rule, why, is_critical'

export const UNIT_PM_ITEM_STATUS_SELECT =
  'id, unit_id, component_id, pm_item_id, last_completed_on, last_completed_hours, ' +
  'next_due_on, next_due_hours'

// ─── Does an item apply to a unit? ────────────────────────────────────────────

/**
 * Model matching, deliberately forgiving in one direction only.
 *
 * Production holds "C-600", "C-600m", "C-600M" and "Thermo King C-600" as
 * separate strings for what is one model family, because a tech types what is on
 * the nameplate. So the comparison strips case, spaces and punctuation and asks
 * whether either string CONTAINS the other.
 *
 * It never guesses across families: "C-600" does not match "S-600", because
 * neither contains the other once normalised.
 */
export function modelMatches(unitModel: string | null | undefined, pattern: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const u = norm(String(unitModel ?? ''))
  const p = norm(pattern)
  if (!u || !p) return false
  return u.includes(p) || p.includes(u)
}

/**
 * True when this item applies to this unit.
 *
 * An item with no model list applies to every unit OF ITS COMPONENT TYPE — not to
 * every unit. A chassis oil change does not belong on a reefer's list.
 */
export function itemAppliesTo(
  item: PmItem,
  unit: { manufacturer?: string | null; model?: string | null; unit_type?: string | null },
  componentType?: ComponentType,
): boolean {
  if (componentType && item.component_type !== componentType) return false

  const models = item.applies_to_models ?? []
  if (models.length === 0) return true

  // Matched against manufacturer + model combined, because a row may be written
  // either as "Thermo King C-600" or just "C-600" and both are reasonable.
  const combined = [unit.manufacturer, unit.model].filter(Boolean).join(' ')
  return models.some(m => modelMatches(combined, m) || modelMatches(unit.model, m))
}

// ─── Due state ────────────────────────────────────────────────────────────────

/**
 * OK / due soon / overdue, and WHY.
 *
 * The reason is part of the state, not a decoration. "Overdue by date" and
 * "overdue by hours" mean different things to a tech: the first says the part has
 * aged out, the second says the unit has run it out. Showing only "overdue"
 * throws away the half of the information that decides what to do about it.
 */
export type PmItemState = 'never_recorded' | 'ok' | 'due_soon' | 'overdue'
export type PmItemReason = 'date' | 'hours' | 'both' | 'none'

export interface PmItemDue {
  state:  PmItemState
  reason: PmItemReason
  /** Reads as a tech would say it. Never "0 days" when nothing is known. */
  label:  string
  daysUntilDue:  number | null
  hoursUntilDue: number | null
}

const DAY_MS = 86_400_000

function dayNum(s: string | null | undefined): number | null {
  if (!s) return null
  const t = Date.parse(`${String(s).slice(0, 10)}T12:00:00Z`)
  return Number.isNaN(t) ? null : t
}

function addMonths(iso: string, months: number): string | null {
  const d = dayNum(iso)
  if (d === null) return null
  const base = new Date(d)
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate(), 12))
  // A 31st rolling into a short month lands on the 1st of the next; pull it back
  // to the last day of the intended month so a 4-month interval from 31 Aug is
  // 31 Dec and not 1 Jan.
  if (target.getUTCDate() !== base.getUTCDate()) target.setUTCDate(0)
  return target.toISOString().slice(0, 10)
}

/**
 * Resolve one item's standing on one unit.
 *
 * WHICHEVER COMES FIRST, when the rule says so. The worse of the two clocks wins,
 * because a part that has aged out is due even if the unit has barely run — which
 * is exactly the bug this run was asked to fix.
 *
 * NEVER RECORDED IS ITS OWN STATE. A unit with no completion recorded is not
 * overdue and not OK; nobody knows. Calling it overdue would fill a fleet
 * dashboard with red on day one; calling it OK would hide a filter nobody has
 * ever changed.
 */
export function pmItemDue(
  item:   PmItem,
  status: UnitPmItemStatus | null | undefined,
  unit:   { total_hours?: number | string | null },
  today:  string,
): PmItemDue {
  const todayMs = dayNum(today)
  const totalHours = status || unit
    ? (unit.total_hours === null || unit.total_hours === undefined || unit.total_hours === ''
        ? null
        : Number(unit.total_hours))
    : null

  const lastOn    = status?.last_completed_on ?? null
  const lastHours = status?.last_completed_hours ?? null

  if (!status || (lastOn === null && lastHours === null)) {
    return {
      state: 'never_recorded',
      reason: 'none',
      label: 'Never recorded',
      daysUntilDue: null,
      hoursUntilDue: null,
    }
  }

  const rule = item.interval_rule
  const useDate  = (rule === 'months' || rule === 'first_of_either') && item.interval_months != null
  const useHours = (rule === 'hours'  || rule === 'first_of_either') && item.interval_hours  != null

  // ── The date clock ──
  let daysUntil: number | null = null
  if (useDate) {
    const dueOn = status.next_due_on ?? (lastOn ? addMonths(lastOn, item.interval_months!) : null)
    const dueMs = dayNum(dueOn)
    if (dueMs !== null && todayMs !== null) daysUntil = Math.round((dueMs - todayMs) / DAY_MS)
  }

  // ── The hours clock ──
  let hoursUntil: number | null = null
  if (useHours && totalHours !== null) {
    const dueHours = status.next_due_hours
      ?? (lastHours !== null ? lastHours + item.interval_hours! : null)
    if (dueHours !== null) hoursUntil = dueHours - totalHours
  }

  if (daysUntil === null && hoursUntil === null) {
    return {
      state: 'never_recorded',
      reason: 'none',
      label: lastOn ? `Last done ${lastOn} — no interval to measure against` : 'Never recorded',
      daysUntilDue: null,
      hoursUntilDue: null,
    }
  }

  // warn_months is in months; convert once so both clocks compare in their own unit.
  const warnDays = (item.warn_months ?? 0) * 30
  const dateState: PmItemState | null = daysUntil === null ? null
    : daysUntil < 0        ? 'overdue'
    : daysUntil <= warnDays ? 'due_soon'
    : 'ok'
  // No hours warn window is specified on the item, so 10% of the interval is used
  // and stated here rather than hidden: it is a presentation choice, not data.
  const warnHours = item.interval_hours != null ? Math.round(item.interval_hours * 0.1) : 0
  const hoursState: PmItemState | null = hoursUntil === null ? null
    : hoursUntil <= 0         ? 'overdue'
    : hoursUntil <= warnHours ? 'due_soon'
    : 'ok'

  const RANK: Record<PmItemState, number> = { never_recorded: 0, ok: 1, due_soon: 2, overdue: 3 }
  const candidates: PmItemState[] = []
  if (dateState  !== null) candidates.push(dateState)
  if (hoursState !== null) candidates.push(hoursState)
  // WHICHEVER COMES FIRST: the worse of the two clocks wins.
  const worst = candidates.sort((a, b) => RANK[b] - RANK[a])[0]

  // Which clock produced the worst state. 'both' when they agree and both apply —
  // which is itself worth saying, because it means there is no argument about it.
  const byDate  = dateState  === worst
  const byHours = hoursState === worst
  const reason: PmItemReason = byDate && byHours ? 'both' : byDate ? 'date' : 'hours'

  return {
    state: worst,
    reason,
    label: labelFor(worst, reason, daysUntil, hoursUntil),
    daysUntilDue:  daysUntil,
    hoursUntilDue: hoursUntil,
  }
}

/** THE STATE NAMES THE REASON. "overdue by date" reads differently to a tech. */
function labelFor(
  state: PmItemState,
  reason: PmItemReason,
  days: number | null,
  hours: number | null,
): string {
  if (state === 'never_recorded') return 'Never recorded'

  const dayPart  = days  === null ? null
    : days < 0  ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue by date`
    : days === 0 ? 'due today by date'
    : `due in ${days} day${days === 1 ? '' : 's'}`
  const hourPart = hours === null ? null
    : hours <= 0 ? `${Math.round(Math.abs(hours)).toLocaleString('en-US')} hrs overdue by hours`
    : `${Math.round(hours).toLocaleString('en-US')} hrs remaining`

  if (reason === 'both' && dayPart && hourPart) return `${cap(dayPart)} · ${hourPart}`
  if (reason === 'date'  && dayPart)  return cap(dayPart)
  if (reason === 'hours' && hourPart) return cap(hourPart)
  return cap(dayPart ?? hourPart ?? 'Unknown')
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ─── Marking complete ─────────────────────────────────────────────────────────

/**
 * The row written when a tech marks an item done.
 *
 * Stamps the date AND the hours at that moment, and recomputes both due figures
 * from the item's intervals. Stored rather than derived so that changing an
 * interval later does not silently move the due date of work already completed.
 */
export function completionRow(
  item:  PmItem,
  onDate: string,
  atHours: number | null,
): {
  last_completed_on: string
  last_completed_hours: number | null
  next_due_on: string | null
  next_due_hours: number | null
} {
  const useDate  = item.interval_months != null && (item.interval_rule === 'months' || item.interval_rule === 'first_of_either')
  const useHours = item.interval_hours  != null && (item.interval_rule === 'hours'  || item.interval_rule === 'first_of_either')
  return {
    last_completed_on:    onDate,
    last_completed_hours: atHours,
    next_due_on:    useDate ? addMonths(onDate, item.interval_months!) : null,
    next_due_hours: useHours && atHours !== null ? atHours + item.interval_hours! : null,
  }
}
