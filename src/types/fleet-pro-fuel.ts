// Fuel log — shared shapes for the driver QR capture, the write path, and the
// manager dashboard's MPG alert.
//
// Everything the three surfaces agree on lives here rather than in
// src/types/fleet-pro.ts, which is shared with other work in flight. The dashboard
// route extends its own payload locally with FuelAlert rather than widening
// FleetProDashboard, the same pattern the PM fields already use in that file.

/** A driver as the QR screen sees him: enough to pick a name, and nothing else.
 *
 *  Deliberately NOT the full FleetProDriver shape. /api/inspect/[unitId] is an
 *  unauthenticated capability URL, so the roster it returns carries the id and the
 *  name and stops there — no CDL number, no medical card date, no phone, no email.
 *  A QR sticker photographed off the side of a truck must not turn into a list of
 *  the carrier's drivers and their licence numbers. */
export interface FuelRosterDriver {
  id:        string
  full_name: string
}

/** What the vision model returns from a photo of a pump display.
 *
 *  Every field is nullable and null is the expected answer for anything the model
 *  could not actually read — the driver fills it in on the confirmation screen. See
 *  the prompt in /api/inspect/fuel-extract for why blank beats plausible here. */
export interface ExtractedFuel {
  gallons:          number | null
  total_cost:       number | null
  price_per_gallon: number | null
}

export const EMPTY_FUEL_EXTRACTION: ExtractedFuel = {
  gallons:          null,
  total_cost:       null,
  price_per_gallon: null,
}

export type FuelFieldKey = keyof ExtractedFuel

export const FUEL_FIELD_LABELS: Record<FuelFieldKey, string> = {
  gallons:          'Gallons',
  total_cost:       'Total cost',
  price_per_gallon: 'Price per gallon',
}

/** Which boxes the machine could not read, so the confirmation screen can flag them.
 *  A driver who is not shown WHICH fields are blank skims a form that looks complete. */
export function unreadFuelFields(extracted: ExtractedFuel): FuelFieldKey[] {
  return (Object.keys(FUEL_FIELD_LABELS) as FuelFieldKey[])
    .filter(key => extracted[key] === null)
}

// ─── Limits ───────────────────────────────────────────────────────────────────
// Mirrored by the CHECK constraints in migration 133. Both exist on purpose: these
// give the driver an error at the moment he types, the database ones are the thing
// that is actually true regardless of which client wrote the row.

/** A tandem-tank tractor holds ~300gal. 500 is already past any single fillup. */
export const MAX_GALLONS = 500
/** Past any real single fillup, including a reefer top-off on the same ticket. */
export const MAX_FUEL_COST = 5_000
/** Past any real diesel price, including remote-highway and Canadian markup. */
export const MAX_PRICE_PER_GALLON = 25
/** Same ceiling the pre-trip submit route clamps odometers to. */
export const MAX_ODOMETER = 9_999_999

/** A loaded class-8 runs 5-9 mpg, a light truck 12-20. Past 30 is a mis-keyed
 *  odometer — almost always trip miles typed in place of hub miles — and letting it
 *  through would lift the unit's rolling average enough to suppress the next alert. */
export const MAX_PLAUSIBLE_MPG = 30

/** Photo limits for this flow. Same 5MB ceiling as the invoice reader: a phone photo
 *  of a pump display is well under it, and the cap is what stops an unauthenticated
 *  endpoint being used as free object storage. */
export const MAX_FUEL_IMAGE_BYTES = 5 * 1024 * 1024
export const FUEL_IMAGE_TYPES = ['image/jpeg', 'image/png'] as const
export type FuelImageType = (typeof FUEL_IMAGE_TYPES)[number]

export const MAX_DRIVER_NAME_CHARS = 120

// ─── MPG alerting ─────────────────────────────────────────────────────────────

/** A fillup this far below the unit's rolling average is flagged. 15% is wide enough
 *  that a headwind, a hill route or a cold week does not trip it, and tight enough to
 *  catch a dragging brake or a plugged DPF weeks before the dash says anything. */
export const MPG_DROP_ALERT_PCT = 15

/** Minimum prior fillups with a real MPG before the average means anything.
 *
 *  Without a floor, fillup #2 is compared against an "average" of exactly one reading
 *  — so a single long-idle tank defines the baseline, and every normal fillup after it
 *  looks like a failure. Three is the smallest number where one outlier cannot own the
 *  average outright. */
export const MPG_MIN_SAMPLE = 3

/** One unit whose latest fillup came in under its own rolling average.
 *
 *  Carries the figures the card needs rather than a pre-formatted string, so the
 *  dashboard can render it and the alert digest could later phrase it differently. */
export interface FuelAlert {
  unit_id:       string
  unit_number:   string
  /** MPG on the most recent fillup. */
  latest_mpg:    number
  /** Mean MPG of the prior fillups it is being judged against. */
  average_mpg:   number
  /** How far below average, as a positive percentage. */
  drop_pct:      number
  /** How many prior fillups the average rests on — shown so a manager can weigh it. */
  sample_size:   number
  fuel_date:     string
  driver_name:   string | null
}

/** Rounds to the precision the column stores, so the number shown and the number
 *  saved are the same. Floating error in the third decimal is how a 15.0% drop
 *  renders as 14.999% and quietly fails an equality check downstream. */
export function roundMpg(value: number): number {
  return Math.round(value * 100) / 100
}
