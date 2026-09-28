// ─── The out-of-service determination, for every inspection form ──────────────
//
// FAIL and OUT OF SERVICE are two separate decisions. 49 CFR 396.11 asks the mechanic
// to certify whether a defect "would affect the safety of operation"; CVSA
// out-of-service criteria are a separate standard from "something is wrong". A form
// that collapses the two gets marked Pass instead, and then it is worth nothing.
//
// Pass / Fail / N-A is unchanged. There is no fourth grade on purpose: a third
// severity turns an objective form into a judgment call and becomes a dumping ground.
// Instead, a FAIL opens one follow-up question.
//
// Six form types, two storage shapes: LD multi-point keeps item results as rows
// (inspection_items, migration 141), the five HD/Fleet-Pro forms keep them inside a
// JSONB payload. Both carry the same two fields, and this module is the only place
// that decides what they mean.

/** The two fields a failed checkpoint gains. Mixed into every form's item state. */
export interface OosDetermination {
  /**
   * TRUE   this defect takes the unit out of service
   * FALSE  the mechanic certified it does not affect safety of operation
   * NULL   never asked -- a record written before this shipped
   *
   * NULL IS NOT FALSE. False is a certification somebody signed; null is silence.
   * Nothing in this codebase may coerce one into the other.
   */
  outOfService?: boolean | null
  /** Required whenever outOfService is set either way. */
  oosNote?: string | null
}

/** Any form's item state, once the determination is mixed in. */
export interface InspectedItemState extends OosDetermination {
  result: string
  notes:  string
}

/** A checkpoint definition that can default the determination to Yes. */
export interface OosCapableItem {
  id:    string
  label: string
  /**
   * Defaults the out-of-service answer to Yes for this checkpoint: brakes,
   * structural and boom welds, dielectric and insulation, steering, tires below
   * minimum, ROPS/FOPS, coupling devices.
   *
   * DELIBERATELY NOT `safetyCritical`. That flag marks 366 of 796 checkpoints -- 74%
   * of a crane form -- and using it here would default three of every four possible
   * fails to "deadline the machine", which is the dumping ground this design exists
   * to avoid. `safetyCritical` keeps its own job: the warning badge, and the
   * existing aerial/equipment submit gate. This is a separate, narrower marker on
   * 71 checkpoints.
   *
   * A default, not a lock. The tech can still answer No, the note is required either
   * way, and the record shows the override.
   */
  autoOos?: boolean
  safetyCritical?: boolean
}

/** Results that open the out-of-service question. */
const FAILING = new Set(['fail'])

/**
 * Does this result open the question?
 *
 * LD's `needs_attention` deliberately does NOT. It is a pre-existing third grade on
 * the LD form (Pass / Attention / Fail) and every stored value keeps the meaning it
 * already had; going forward it is a deficiency for the follow-up list and can never
 * drive out-of-service. That keeps the meaning consistent without inventing a grade
 * or rewriting history.
 */
export function opensOosQuestion(result: string | null | undefined): boolean {
  return FAILING.has(String(result ?? '').toLowerCase())
}

/** True when this item's defect takes the unit out of service. */
export function itemIsOos(state: OosDetermination | null | undefined): boolean {
  return state?.outOfService === true
}

/** True when the question was answered, either way. */
export function itemOosAnswered(state: OosDetermination | null | undefined): boolean {
  return state?.outOfService === true || state?.outOfService === false
}

/** The default answer a newly-failed checkpoint starts on. */
export function defaultOosFor(item: OosCapableItem | null | undefined): boolean {
  return item?.autoOos === true
}

/**
 * Why this item cannot be submitted yet, or null.
 *
 * The note is required whichever way the question is answered. If a tech is
 * deadlining a machine, or choosing not to, there has to be a reason on the record --
 * that is the whole audit value of the split.
 */
export function oosBlocker(
  item:  OosCapableItem,
  state: InspectedItemState | null | undefined,
): string | null {
  if (!opensOosQuestion(state?.result)) return null
  if (!itemOosAnswered(state)) {
    return `${item.label} — answer whether this takes the unit out of service`
  }
  if (!String(state?.oosNote ?? '').trim()) {
    return `${item.label} — a note is required on the out-of-service decision`
  }
  return null
}

/** One failed checkpoint, ready to print or list. */
export interface FailedItem {
  sectionLabel: string
  itemId:       string
  label:        string
  /** The tech's own notes on the checkpoint. */
  notes:        string
  /** The reason given for the out-of-service decision. */
  oosNote:      string
  outOfService: boolean
  /** True when the tech answered No to a checkpoint that defaults to Yes. */
  overridden:   boolean
}

/**
 * Split a form's failures into the two sections the printed document and the
 * follow-up list both need.
 *
 * `read` pulls one item's state out of whatever shape the form stores -- rows for LD,
 * nested JSONB for the HD families -- so this works for all six without knowing any
 * of their payload layouts.
 */
export function splitFailures<TItem extends OosCapableItem>(
  sections: Array<{ label: string; items: TItem[] }>,
  read: (sectionIndex: number, item: TItem) => InspectedItemState | null | undefined,
): { outOfService: FailedItem[]; repairs: FailedItem[] } {
  const outOfService: FailedItem[] = []
  const repairs: FailedItem[] = []

  sections.forEach((section, si) => {
    for (const item of section.items) {
      const state = read(si, item)
      if (!opensOosQuestion(state?.result)) continue
      const isOos = itemIsOos(state)
      const row: FailedItem = {
        sectionLabel: section.label,
        itemId:       item.id,
        label:        item.label,
        notes:        String(state?.notes ?? '').trim(),
        oosNote:      String(state?.oosNote ?? '').trim(),
        outOfService: isOos,
        // Worth surfacing: a checkpoint that defaults to out-of-service and was
        // answered No is a deliberate call somebody should be able to see.
        overridden:   defaultOosFor(item) && state?.outOfService === false,
      }
      ;(isOos ? outOfService : repairs).push(row)
    }
  })

  return { outOfService, repairs }
}

/**
 * The inspection-level flag, derived from the items rather than asked separately.
 *
 * Returns null when no failed item answered the question, so an inspection that
 * predates the split stores NULL rather than a fabricated false.
 */
export function deriveRemovedFromService(
  failures: { outOfService: FailedItem[]; repairs: FailedItem[] },
): boolean | null {
  if (failures.outOfService.length > 0) return true
  if (failures.repairs.length > 0) return false
  return null
}

// Re-exported, not redefined: a declined segment and an in-service defect wait the
// same length of time, and that number lives in lib/followups.
export { FOLLOWUP_DAYS, followupDueOn } from '@/lib/followups'
