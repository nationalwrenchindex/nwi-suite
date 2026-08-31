// Deterministic labor ranges for trailer ABS repairs.
//
// WHY THIS IS A HAND-WRITTEN TABLE AND NOT SOMETHING THE MODEL PRODUCES:
// The AI diagnostic in /api/hd/trailer-abs-diagnostic asks Gemini what is wrong with the
// brake system. It does NOT ask Gemini how long the repair takes, and it never passes a
// model-authored number through to the response. A labor figure is not a diagnosis — it
// is a billable quantity a shop puts in front of a customer, and a language model will
// happily produce a fluent, confident, slightly different number every time it is asked.
// A quote that moves between two identical jobs is a customer dispute; a quote a tech
// cannot defend is a lost job. So the model classifies the fault, and this file — a flat
// lookup that a human owns and can be corrected in one place — supplies the hours.
//
// Ranges below are shop-standard book-time bands for trailer ABS work, not a specific
// manufacturer's warranty time. They deliberately stay a LOW..HIGH band rather than a
// single figure: a wheel speed sensor at an accessible hub is not the same job as one
// seized in the block behind a mud-caked drum, and collapsing that spread to one number
// would guarantee the estimate is wrong in one direction on every job.

/** The repairs this table prices. Anything outside this list resolves to null. */
export type ABSFaultCategory =
  | 'wheel_speed_sensor_replacement'
  | 'modulator_valve_replacement'
  | 'abs_ecu_replacement'
  | 'wiring_harness_repair'
  | 'sensor_air_gap_adjustment'

export interface ABSLaborEntry {
  category:    ABSFaultCategory
  low_hours:   number
  high_hours:  number
  description: string
}

export const ABS_FAULT_CATEGORIES: readonly ABSFaultCategory[] = [
  'wheel_speed_sensor_replacement',
  'modulator_valve_replacement',
  'abs_ecu_replacement',
  'wiring_harness_repair',
  'sensor_air_gap_adjustment',
] as const

export const ABS_LABOR_TABLE: Readonly<Record<ABSFaultCategory, ABSLaborEntry>> = {
  wheel_speed_sensor_replacement: {
    category:    'wheel_speed_sensor_replacement',
    low_hours:   0.5,
    high_hours:  1.0,
    description: 'Wheel speed sensor replacement — remove and replace the sensor at one wheel end, re-seat it fully against the tone ring, and verify signal.',
  },
  modulator_valve_replacement: {
    category:    'modulator_valve_replacement',
    low_hours:   1.0,
    high_hours:  1.5,
    description: 'ABS modulator valve replacement — depressurise the affected circuit, replace the modulator, and leak-check and function-test the circuit.',
  },
  abs_ecu_replacement: {
    category:    'abs_ecu_replacement',
    low_hours:   1.5,
    high_hours:  2.0,
    description: 'Trailer ABS ECU replacement — remove and replace the ECU, transfer or reconnect the harness, and configure and verify the new unit.',
  },
  wiring_harness_repair: {
    category:    'wiring_harness_repair',
    low_hours:   1.0,
    high_hours:  2.0,
    description: 'ABS wiring harness repair — trace the affected circuit, repair or replace the damaged section and connectors, and verify continuity end to end.',
  },
  sensor_air_gap_adjustment: {
    category:    'sensor_air_gap_adjustment',
    low_hours:   0.3,
    high_hours:  0.5,
    description: 'Wheel speed sensor air gap adjustment — push the sensor back in against the tone ring in its holder and re-verify the signal. No parts.',
  },
}

export function isABSFaultCategory(value: unknown): value is ABSFaultCategory {
  return typeof value === 'string' && (ABS_FAULT_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Primary resolver. The route hands this whatever the model put in its
 * `fault_category` field — which may be null, a typo, a category we do not price, or
 * not a string at all — and gets either a real priced entry or null.
 *
 * Returning null is a supported outcome, not a failure: an ABS fault that does not map
 * to one of the five repairs above (a low-voltage supply fault, a tone ring, a fault
 * that turns out to be the tractor and not the trailer) has no honest number here, and
 * the route renders no labor estimate rather than inventing one.
 */
export function resolveABSLabor(category: unknown): ABSLaborEntry | null {
  return isABSFaultCategory(category) ? ABS_LABOR_TABLE[category] : null
}

// Keyword fallback, used only when the model returned a usable diagnosis but left
// `fault_category` empty or unrecognised. Matchers are evaluated in order and the FIRST
// hit wins, which is why the order matters and is not alphabetical:
//
//   - Air gap is checked before sensor replacement, because "adjust the wheel speed
//     sensor air gap" contains the words "wheel speed sensor" and would otherwise be
//     priced as a replacement — double the correct labor for a job with no parts on it.
//   - Harness is checked before the component categories, because "chafed harness to
//     the modulator valve" is a wiring repair, not a valve replacement.
//   - ECU is checked before modulator, because WABCO and Haldex package the ECU and the
//     modulator as one assembly and the text usually names both.
//
// Anything that matches nothing returns null and no estimate is shown.
const CATEGORY_MATCHERS: readonly { category: ABSFaultCategory; pattern: RegExp }[] = [
  { category: 'sensor_air_gap_adjustment',    pattern: /air[\s-]?gap|re-?seat(?:ing)?\s+the\s+sensor|push(?:ing)?\s+the\s+sensor\s+(?:back\s+)?in/i },
  { category: 'wiring_harness_repair',        pattern: /harness|chafe|wiring\s+(?:repair|damage|fault|short|open)|open\s+circuit\s+in\s+the\s+wiring|damaged\s+(?:wire|cable|connector)/i },
  { category: 'abs_ecu_replacement',          pattern: /\becu\b|electronic\s+control\s+unit|\bec[u]?-?\d+\b|control\s+module\s+(?:failure|replacement)/i },
  { category: 'modulator_valve_replacement',  pattern: /modulator|relay\s+valve|abs\s+valve|solenoid\s+valve/i },
  { category: 'wheel_speed_sensor_replacement', pattern: /wheel[\s-]?speed\s+sensor|\bwss\b|speed\s+sensor\s+(?:failure|open|short|replacement)/i },
]

/**
 * Best-effort classification from free text. Deliberately conservative — it only
 * recognises the five repairs this file prices, and returns null for everything else
 * rather than reaching for the nearest match.
 */
export function classifyABSFault(text: string): ABSFaultCategory | null {
  if (!text || typeof text !== 'string') return null
  for (const { category, pattern } of CATEGORY_MATCHERS) {
    if (pattern.test(text)) return category
  }
  return null
}
