// ─── How long deferred work waits before it gets chased ───────────────────────
//
// Shared by the two things that produce deferred work: a segment the customer
// declined, and an inspection defect that did not take the unit out of service. Both
// are the same commercial idea -- known machine, known fault, a customer who said
// "not today" -- so they wait the same length of time.
//
// This was duplicated as a bare `const FOLLOWUP_DAYS = 30` in two segment routes.
// Two copies of a number that has to agree is one copy too many.

export const FOLLOWUP_DAYS = 30

/** The date something found today should be followed up on, as YYYY-MM-DD. */
export function followupDueOn(from: Date = new Date()): string {
  return new Date(from.getTime() + FOLLOWUP_DAYS * 86_400_000).toISOString().slice(0, 10)
}
