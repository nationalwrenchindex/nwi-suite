// Which of a shop's units a typed serial number means - or none.
//
// ONE RULE for every place that links a document to a unit from text (Brock, Nov 23, 2026):
//   * the calendar booking form                      (HDCalendarClient)
//   * a work order built from an approved quote      (lib/hd/quote-approval)
//   * an HD invoice's unit and fleet                 (lib/fleet-pro/invoice-link)
//   * a Fleet Pro scanned invoice's unit             (api/fleet-pro/service-entries/extract)
//   * scripts/backfill-wo-unit-by-serial.ts
//
// A SERIAL MATCH ALONE NEVER LINKS A UNIT. It links only when the serial matches AND the
// model agrees (unitModelMatches, the parts counter's own comparison - exact after
// normalizing, plus the Precedent S-600 == S-600 names). Serial 6001241923 documents
// reading "s-600" were linked to unit 53177, a C-600M, on the serial alone; a repair
// landing in the wrong unit's history is worse than no link - a missing link is
// recoverable, a wrong one is not.
//
//   serial matches nothing                    -> no link, nothing to say
//   serial matches, model agrees, ONE unit    -> that unit
//   serial matches, model disagrees or blank  -> no link, and the user is told
//   serial and model match TWO or more units  -> no link, and the user is told
//
// The serial comparison is trimmed and case-insensitive, and nothing else. Dashes and
// spaces are NOT stripped: "1HT-123" and "1HT123" may well be the same unit, but this
// cannot know that, and a conservative miss is recoverable where a wrong link is not.

import { unitModelMatches } from '@/lib/parts/narrow'

export interface SerialUnit {
  id: string
  serial_number: string | null
}

export interface SerialModelUnit extends SerialUnit {
  model: string | null
}

/** Shown wherever a serial found a unit but the link was refused (Brock's words, exactly). */
export const UNIT_SERIAL_MISMATCH_NOTICE =
  'A unit with this serial already exists but its model does not match. Pick the unit yourself or add a new one.'

export function normSerial(s: string | null | undefined): string {
  return String(s ?? '').trim().toUpperCase()
}

export type SerialModelMatch<T> =
  | { unit: T; reason: 'linked'; notice: null }
  | { unit: null; reason: 'no_serial' | 'no_match'; notice: null }
  | { unit: null; reason: 'model_mismatch' | 'ambiguous'; notice: string }

/**
 * The one unit whose serial matches AND whose model agrees with the model typed.
 *
 * A blank typed model can never agree: unitModelMatches treats a blank "wanted" as no
 * filter (true), which here would be a serial-only link, so a blank model is refused
 * before the comparison is ever asked.
 */
export function matchUnitBySerialAndModel<T extends SerialModelUnit>(
  units: readonly T[],
  serial: string | null | undefined,
  model: string | null | undefined,
): SerialModelMatch<T> {
  const want = normSerial(serial)
  if (!want) return { unit: null, reason: 'no_serial', notice: null }
  const bySerial = units.filter(u => normSerial(u.serial_number) === want)
  if (bySerial.length === 0) return { unit: null, reason: 'no_match', notice: null }
  const typedModel = String(model ?? '').trim()
  const agree = typedModel ? bySerial.filter(u => unitModelMatches(u.model, typedModel)) : []
  if (agree.length === 1) return { unit: agree[0], reason: 'linked', notice: null }
  return {
    unit: null,
    reason: agree.length > 1 ? 'ambiguous' : 'model_mismatch',
    notice: UNIT_SERIAL_MISMATCH_NOTICE,
  }
}
