// DVIR-style driver pre-trip checklist — PURE DATA + PURE HELPERS.
//
// NOTHING may be imported here beyond the shared type. No React, no Supabase, no
// server modules: the service worker caches /inspect/[unitId] and this list has to
// survive in the bundle with zero network. A driver in a dead zone gets the same
// checklist a driver on wifi gets, or the offline story is a lie.
//
// Items are modelled on the FMCSA 396.11 DVIR inspection points. `critical: true`
// marks the items that are genuinely out-of-service conditions — a truck that fails
// one of them should not roll. It is used to color the summary, never to silently
// drop or reorder an item: every item a driver marks fail is reported.

import type { PretripItem } from '@/types/fleet-pro-partner'

/** Bumped when the item list changes shape. Stored with cached drafts so a stale
 *  draft from an older list is discarded instead of half-applied. */
export const PRETRIP_CHECKLIST_VERSION = 1

/** Section render order. The array is the order — do not sort it alphabetically. */
export const PRETRIP_SECTIONS = [
  'Exterior & Lights',
  'Brakes & Air',
  'Tires & Wheels',
  'Steering & Suspension',
  'Engine Compartment',
  'Coupling',
  'Reefer Unit',
  'In-Cab & Safety Equipment',
] as const

export type PretripSection = (typeof PRETRIP_SECTIONS)[number]

export type PretripAnswer = 'pass' | 'fail' | 'na'

export const PRETRIP_ANSWERS: PretripAnswer[] = ['pass', 'fail', 'na']

/** Keys are stable identifiers written into checklist_data JSONB. Never rename one
 *  in place — an old inspection would stop matching its own label. */
export const PRETRIP_ITEMS: PretripItem[] = [
  // ── Exterior & Lights ───────────────────────────────────────────────────────
  { key: 'head_lamps',       section: 'Exterior & Lights', critical: true,  label: 'Headlights — high and low beam' },
  { key: 'turn_signals',     section: 'Exterior & Lights', critical: true,  label: 'Turn signals and 4-way flashers' },
  { key: 'brake_lamps',      section: 'Exterior & Lights', critical: true,  label: 'Brake lights' },
  { key: 'marker_lamps',     section: 'Exterior & Lights', critical: true,  label: 'Clearance, marker and identification lamps' },
  { key: 'reflectors',       section: 'Exterior & Lights', critical: false, label: 'Reflectors and conspicuity tape' },
  { key: 'mirrors',          section: 'Exterior & Lights', critical: false, label: 'Mirrors — secure, clean, adjusted' },
  { key: 'windshield',       section: 'Exterior & Lights', critical: false, label: 'Windshield, wipers and washer fluid' },
  { key: 'body_damage',      section: 'Exterior & Lights', critical: false, label: 'Body, doors and panels — no new damage' },
  { key: 'plate_placards',   section: 'Exterior & Lights', critical: false, label: 'License plate and required placards legible' },

  // ── Brakes & Air ────────────────────────────────────────────────────────────
  { key: 'service_brakes',   section: 'Brakes & Air', critical: true,  label: 'Service brakes apply and release' },
  { key: 'parking_brake',    section: 'Brakes & Air', critical: true,  label: 'Parking / spring brake holds' },
  { key: 'air_leak_rate',    section: 'Brakes & Air', critical: true,  label: 'Air loss within limits — no audible leaks' },
  { key: 'air_buildup',      section: 'Brakes & Air', critical: true,  label: 'Air pressure builds 85–100 psi' },
  { key: 'low_air_warning',  section: 'Brakes & Air', critical: true,  label: 'Low-air warning light and buzzer at ~60 psi' },
  { key: 'air_lines',        section: 'Brakes & Air', critical: true,  label: 'Air lines, hoses and glad hands — no chafing or leaks' },
  { key: 'slack_adjusters',  section: 'Brakes & Air', critical: true,  label: 'Slack adjusters and pushrod travel' },
  { key: 'brake_hardware',   section: 'Brakes & Air', critical: true,  label: 'Drums, linings and brake chambers' },
  { key: 'abs_lamp',         section: 'Brakes & Air', critical: false, label: 'ABS lamp cycles and goes out' },

  // ── Tires & Wheels ──────────────────────────────────────────────────────────
  { key: 'tire_pressure',    section: 'Tires & Wheels', critical: true,  label: 'Tire pressure — every position' },
  { key: 'tread_depth',      section: 'Tires & Wheels', critical: true,  label: 'Tread depth — 4/32 steer, 2/32 all others' },
  { key: 'tire_condition',   section: 'Tires & Wheels', critical: true,  label: 'No cuts, bulges, sidewall damage or exposed cord' },
  { key: 'wheels_rims',      section: 'Tires & Wheels', critical: true,  label: 'Wheels and rims — no cracks or illegal welds' },
  { key: 'lug_nuts',         section: 'Tires & Wheels', critical: true,  label: 'Lug nuts tight — no rust streaks or missing studs' },
  { key: 'hub_seals',        section: 'Tires & Wheels', critical: false, label: 'Hub oil level and seals — no leaks' },
  { key: 'mud_flaps',        section: 'Tires & Wheels', critical: false, label: 'Mud flaps and brackets secure' },

  // ── Steering & Suspension ───────────────────────────────────────────────────
  { key: 'steering_play',    section: 'Steering & Suspension', critical: true,  label: 'Steering wheel free play within limits' },
  { key: 'steering_gear',    section: 'Steering & Suspension', critical: true,  label: 'Steering box, arms and linkage secure' },
  { key: 'suspension',       section: 'Steering & Suspension', critical: true,  label: 'Springs, air bags, shocks and U-bolts' },
  { key: 'frame',            section: 'Steering & Suspension', critical: true,  label: 'Frame and crossmembers — no cracks' },
  { key: 'driveline',        section: 'Steering & Suspension', critical: false, label: 'Driveshaft, U-joints and guards' },

  // ── Engine Compartment ──────────────────────────────────────────────────────
  { key: 'engine_oil',       section: 'Engine Compartment', critical: false, label: 'Engine oil level' },
  { key: 'coolant_level',    section: 'Engine Compartment', critical: false, label: 'Coolant level' },
  { key: 'power_steer_fluid',section: 'Engine Compartment', critical: false, label: 'Power steering fluid level' },
  { key: 'belts_hoses',      section: 'Engine Compartment', critical: false, label: 'Belts and hoses — condition and tension' },
  { key: 'fuel_leaks',       section: 'Engine Compartment', critical: true,  label: 'No fuel leaks' },
  { key: 'def_level',        section: 'Engine Compartment', critical: false, label: 'DEF level' },
  { key: 'battery_secure',   section: 'Engine Compartment', critical: false, label: 'Battery secured, cables clean and tight' },
  { key: 'exhaust',          section: 'Engine Compartment', critical: true,  label: 'Exhaust system secure — no leaks into the cab' },

  // ── Coupling ────────────────────────────────────────────────────────────────
  { key: 'fifth_wheel',      section: 'Coupling', critical: true,  label: 'Fifth wheel locked — jaws closed, no gap' },
  { key: 'kingpin',          section: 'Coupling', critical: true,  label: 'Kingpin and upper apron — no damage' },
  { key: 'release_arm',      section: 'Coupling', critical: true,  label: 'Release arm seated, safety latch engaged' },
  { key: 'coupling_lines',   section: 'Coupling', critical: true,  label: 'Air and electrical lines secure, not dragging' },
  { key: 'landing_gear',     section: 'Coupling', critical: false, label: 'Landing gear fully raised, crank secured' },
  { key: 'load_secure',      section: 'Coupling', critical: true,  label: 'Load secured, doors closed and latched' },

  // ── Reefer Unit ─────────────────────────────────────────────────────────────
  { key: 'reefer_fuel',      section: 'Reefer Unit', critical: false, label: 'Reefer fuel level adequate for the run' },
  { key: 'reefer_setpoint',  section: 'Reefer Unit', critical: false, label: 'Setpoint and box temperature correct' },
  { key: 'reefer_alarms',    section: 'Reefer Unit', critical: true,  label: 'No active alarm codes' },
  { key: 'reefer_belts',     section: 'Reefer Unit', critical: false, label: 'Reefer belts and hoses — condition' },
  { key: 'reefer_leaks',     section: 'Reefer Unit', critical: false, label: 'No oil, coolant or refrigerant leaks' },
  { key: 'reefer_mounting',  section: 'Reefer Unit', critical: true,  label: 'Unit mounting bolts tight' },
  { key: 'reefer_doors',     section: 'Reefer Unit', critical: false, label: 'Unit doors, latches and grille secure' },
  { key: 'reefer_airflow',   section: 'Reefer Unit', critical: false, label: 'Condenser and evaporator clear — airflow unobstructed' },

  // ── In-Cab & Safety Equipment ───────────────────────────────────────────────
  { key: 'gauges',           section: 'In-Cab & Safety Equipment', critical: true,  label: 'Gauges and warning lights normal' },
  { key: 'horn',             section: 'In-Cab & Safety Equipment', critical: false, label: 'Horn — city and air' },
  { key: 'heater_defroster', section: 'In-Cab & Safety Equipment', critical: true,  label: 'Heater and defroster' },
  { key: 'seat_belt',        section: 'In-Cab & Safety Equipment', critical: true,  label: 'Seat belt — condition and latch' },
  { key: 'fire_extinguisher',section: 'In-Cab & Safety Equipment', critical: true,  label: 'Fire extinguisher charged and secured' },
  { key: 'warning_devices',  section: 'In-Cab & Safety Equipment', critical: true,  label: 'Warning triangles / reflective devices' },
  { key: 'spare_fuses',      section: 'In-Cab & Safety Equipment', critical: false, label: 'Spare fuses' },
  { key: 'eld_logbook',      section: 'In-Cab & Safety Equipment', critical: false, label: 'ELD / logbook operating' },
  { key: 'paperwork',        section: 'In-Cab & Safety Equipment', critical: false, label: 'Registration, insurance, permits, previous DVIR' },
  { key: 'emergency_kit',    section: 'In-Cab & Safety Equipment', critical: false, label: 'First aid kit and PPE on board' },
]

/** O(1) lookups. Built once at module load. */
const ITEM_BY_KEY = new Map<string, PretripItem>(PRETRIP_ITEMS.map(i => [i.key, i]))

export function pretripItem(key: string): PretripItem | undefined {
  return ITEM_BY_KEY.get(key)
}

export interface PretripGroup {
  section: string
  items:   PretripItem[]
}

/** Items grouped in PRETRIP_SECTIONS order. Sections with no items are dropped. */
export function groupedPretripItems(): PretripGroup[] {
  return PRETRIP_SECTIONS
    .map(section => ({ section, items: PRETRIP_ITEMS.filter(i => i.section === section) }))
    .filter(g => g.items.length > 0)
}

export type PretripAnswers = Record<string, PretripAnswer>

/**
 * FAIL beats everything. One failed item fails the whole inspection — this mirrors a
 * paper DVIR, where any noted defect makes the vehicle's condition unsatisfactory
 * until a mechanic signs it off. Non-critical items count too; "critical" only drives
 * how loudly the result is presented.
 */
export function pretripOverallResult(answers: PretripAnswers): 'pass' | 'fail' {
  return Object.values(answers).some(v => v === 'fail') ? 'fail' : 'pass'
}

/** Keys the driver has not answered yet, in checklist order. */
export function unansweredPretripKeys(answers: PretripAnswers): string[] {
  return PRETRIP_ITEMS.filter(i => !answers[i.key]).map(i => i.key)
}

export function criticalFailureCount(answers: PretripAnswers): number {
  return PRETRIP_ITEMS.filter(i => i.critical && answers[i.key] === 'fail').length
}

/**
 * Build the defects payload from the answers plus whatever notes the driver typed.
 * The label is denormalized into the row on purpose: an inspection is a legal record
 * and must still read correctly years later, after this file has been edited.
 */
export function pretripDefects(
  answers: PretripAnswers,
  notes:   Record<string, string>,
): { key: string; label: string; note?: string }[] {
  return PRETRIP_ITEMS
    .filter(i => answers[i.key] === 'fail')
    .map(i => {
      const note = (notes[i.key] ?? '').trim()
      return note ? { key: i.key, label: i.label, note } : { key: i.key, label: i.label }
    })
}

/** Drop anything that is not a known item / known answer. Used on both sides of the
 *  wire so a corrupt cached draft can never produce an unparseable submission. */
export function sanitizePretripAnswers(input: unknown): PretripAnswers {
  const out: PretripAnswers = {}
  if (!input || typeof input !== 'object') return out
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ITEM_BY_KEY.has(key)) continue
    if (value === 'pass' || value === 'fail' || value === 'na') out[key] = value
  }
  return out
}
