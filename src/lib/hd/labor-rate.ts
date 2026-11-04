// The shop's HD labor rate, and the one rule for where a NEW labor line's rate comes from.
//
// profiles.hd_labor_rate ONLY. Not default_labor_rate - that is LD's, and reading it
// bills an HD job at the light-duty rate (they matched at 135 for one shop, which is how
// it went unnoticed). Not 125 - that was a constant in the HD forms that put someone
// else's rate on every new quote and invoice. A shop that has set no HD rate gets NULL,
// and the screen says so; nothing here invents a number.
//
// A DOCUMENT'S RECORDED RATE WINS. A new line on a work order made from an approved quote
// opens at the quote's rate, because that is the rate the customer agreed to. The shop's
// rate fills only a document that recorded none. This only decides what a new line
// pre-fills - a line already on a document keeps the rate it was saved with.

/** profiles.hd_labor_rate, or NULL when it is unset, blank, zero or not a number. */
export function hdLaborRateFrom(profile: Record<string, unknown> | null | undefined): number | null {
  const v = profile?.hd_labor_rate
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The rate a new labor line pre-fills: the document's own, else the shop's, else NULL. */
export function newLaborLineRate(documentRate: unknown, shopRate: number | null): number | null {
  const d = documentRate === null || documentRate === undefined || documentRate === '' ? NaN : Number(documentRate)
  return Number.isFinite(d) && d > 0 ? d : shopRate
}

/** What a labor rate box says when there is no rate to pre-fill it with. */
export const NO_HD_LABOR_RATE = 'No HD labor rate is set. Set one in HD Settings, or enter the rate here.'
