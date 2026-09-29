// ─── Seeding a new quote from something that already exists ───────────────────
//
// The from-scratch quote form takes an optional seed. A blank quote passes none; a
// quote raised off something the shop already recorded passes one, and every field it
// carries is one the tech does not retype.
//
// THE SEAM IS THE POINT. The immediate need is the blank path, but the shape is built
// for the case that is coming: a failed inspection item has a unit, a checkpoint label
// and a tech's note, and today there is no route from any of that to a repair on HD.
// When that gets wired, it maps onto this type — it does not reshape the form.
//
// Nothing auto-filled is ever locked. A seed sets initial values and the tech edits
// them like anything else, same rule as segment 1's complaint inheritance.

export type QuoteSeedSource =
  /** Typed from nothing. */
  | 'manual'
  /** A failed checkpoint on any inspection form, LD or HD. */
  | 'inspection_item'
  /** A work order that needs quoting before the work is authorised. */
  | 'work_order'

export interface QuoteSeedLine {
  description: string
  quantity:    number
  /**
   * PRE-MARKUP base price — what the shop pays, not what the customer pays.
   *
   * This is the editor's own convention (see components/shared/line-items: every read
   * divides the markup out and every write multiplies it back in). A seed that passed
   * a post-markup price would be marked up a second time on save.
   */
  unit_price:  number
}

export interface QuoteSeed {
  source: QuoteSeedSource

  /**
   * Human origin, shown on the form so the tech can see what they are quoting from,
   * e.g. "DOT-260929-AB12 — Brake lining thickness". Also prefixed into the notes so
   * the finished quote records where it came from.
   */
  originLabel?: string | null
  /** The source record's id, for tracing back. Not a foreign key — quotes has no
   *  column for it yet, so this only reaches the notes today. */
  originId?:    string | null

  customerId?: string | null
  vehicleId?:  string | null
  notes?:      string | null

  /** Parts rows, pre-markup. */
  lines?:      QuoteSeedLine[]
  /** Labour hours; the rate comes from the shop's own default. */
  laborHours?: number | null
}

/** A blank quote. Written out rather than passing undefined, so the call site reads. */
export const BLANK_QUOTE_SEED: QuoteSeed = { source: 'manual' }

/**
 * The notes a seeded quote starts with: the origin line, then whatever the source
 * had to say. Kept here so every future seeder words it the same way.
 */
export function seedNotes(seed: QuoteSeed): string {
  const parts = [
    seed.originLabel ? `From: ${seed.originLabel}` : null,
    seed.notes?.trim() || null,
  ].filter(Boolean)
  return parts.join('\n')
}
