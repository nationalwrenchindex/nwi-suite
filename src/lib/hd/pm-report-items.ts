// Joins a saved PM checklist back to the item definitions so a report can show the
// COMPLETE inspection, not just the failures.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// checklist_data is stored as { "1-01": { state: "pass" }, ... } — item ids and
// states, no text. Only flagged_items carries human-readable labels, because those
// were captured at submit time. So every report built from flagged_items alone could
// physically only show the failures: 72 of 73 inspection points were invisible, and a
// customer receiving one had no evidence the rest had been looked at.
//
// That is the wrong document. A PM inspection is a record that the work was performed,
// and "everything not listed was fine" is an assertion the customer has to take on
// trust. Re-joining against CHECKLIST_SECTIONS restores the item text so every point
// can be shown with its own result.
//
// ── WHAT IS AND IS NOT INCLUDED ──────────────────────────────────────────────
// Only items actually present in checklist_data are returned. The checklist is
// conditional — sections carry showWhen ('12month' | '24month' | 'multitemp') and a dry
// PM never renders them — so listing every item in the master definition would invent
// inspection points that were never part of that job and mark them N/A. A section with
// no recorded items is dropped entirely rather than rendered empty.

import { CHECKLIST_SECTIONS, type ItemState } from '@/components/hd/checklist-data'

/** A single inspection point as it should appear on the report. */
export interface PMReportItem {
  id:    string
  text:  string
  state: ItemState
  /** Display label for the state: Pass / Fail / N/A / Not recorded. */
  label: string
  /** True for a failure, so callers can highlight without re-deriving the rule. */
  failed: boolean
}

export interface PMReportSection {
  id:    string
  title: string
  items: PMReportItem[]
}

export interface PMReportSummary {
  sections: PMReportSection[]
  total:    number
  passed:   number
  failed:   number
  na:       number
  /** Recorded in checklist_data but with no usable state — should normally be 0. */
  unrecorded: number
}

/**
 * 'flag' is the stored value for a failure. It is surfaced as "Fail" because that is
 * what it means to the customer reading the report — the tech flagged it because it did
 * not pass. Keeping the UI word ("Flag") on a customer document would understate it.
 */
function labelFor(state: ItemState): string {
  switch (state) {
    case 'pass': return 'Pass'
    case 'flag': return 'Fail'
    case 'na':   return 'N/A'
    default:     return 'Not recorded'
  }
}

/** Narrow an unknown stored value to an ItemState without trusting the JSON blob. */
function readState(raw: unknown): ItemState {
  if (raw && typeof raw === 'object' && 'state' in raw) {
    const s = (raw as { state?: unknown }).state
    if (s === 'pass' || s === 'flag' || s === 'na') return s
  }
  return null
}

/**
 * Build the full inspection record from a stored checklist_data blob.
 * Returns empty sections (and zero counts) when the blob is missing or malformed,
 * so a report never throws on an old or partial row.
 */
export function buildPMReport(checklistData: unknown): PMReportSummary {
  const data =
    checklistData && typeof checklistData === 'object' && !Array.isArray(checklistData)
      ? (checklistData as Record<string, unknown>)
      : {}

  const sections: PMReportSection[] = []
  let passed = 0, failed = 0, na = 0, unrecorded = 0

  for (const section of CHECKLIST_SECTIONS) {
    const items: PMReportItem[] = []

    for (const item of section.items) {
      // Absent id => this item was not part of this PM type. Skip rather than
      // inventing an N/A for a point the tech was never asked to inspect.
      if (!(item.id in data)) continue

      const state = readState(data[item.id])
      if (state === 'pass') passed++
      else if (state === 'flag') failed++
      else if (state === 'na') na++
      else unrecorded++

      items.push({
        id:     item.id,
        text:   item.text,
        state,
        label:  labelFor(state),
        failed: state === 'flag',
      })
    }

    if (items.length > 0) sections.push({ id: section.id, title: section.title, items })
  }

  return { sections, total: passed + failed + na + unrecorded, passed, failed, na, unrecorded }
}
