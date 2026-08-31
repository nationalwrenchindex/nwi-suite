// Trailer ABS — Haldex and Bendix blink codes, sensor and modulator specs.
//
// Loaded into hd_trailer_reference by /api/hd/trailer-reference/seed alongside the
// other trailer system modules. Every row here is system: 'ABS'.
//
// ACCURACY POLICY FOR THIS FILE
// Trailer ABS is a federally mandated safety system (FMVSS 121). A wrong code meaning
// sends a tech to the wrong axle, the wrong sensor, or the wrong valve on a brake
// system. So: specs and procedures that are standard across the industry are stated
// plainly. Manufacturer-specific NUMERIC BLINK CODE MAPPINGS ARE NOT ASSERTED HERE —
// Haldex and Bendix have each used more than one blink-code table across ECU
// generations (Haldex Gen 4 vs Gen 5, Bendix TABS-6 vs the trailer EC series), and the
// same flash pattern does not mean the same thing on every ECU. Each code row below
// therefore carries the diagnostic workflow that applies to that code plus an explicit
// instruction to confirm the meaning against the decal on the ECU itself before
// replacing parts. Do not "fill in" these meanings from memory or from a chart for a
// different ECU generation — read the decal.

import type { TrailerReferenceRow } from './types'

/** Appended to every brand-specific blink code row. */
const CONFIRM_MAPPING =
  'CONFIRM THE CODE MEANING BEFORE REPLACING ANY PART. Read the blink code decal on the ' +
  'ABS ECU housing itself (it is printed on the ECU or on the inside of its cover and it ' +
  'matches that exact ECU generation), or the manufacturer service literature for the ' +
  'part number stamped on the ECU. Blink code tables differ between ECU generations — a ' +
  'chart for the wrong generation will point you at the wrong wheel end.'

/** Appended to every row that ends in a repair. */
const ROAD_TEST =
  'After any ABS repair: clear codes, cycle power, confirm the trailer ABS lamp performs ' +
  'its normal self-check and then goes out, and road test above 6 mph so the ECU can see ' +
  'all wheel speed signals. A lamp that goes out at power-up but returns on the road is a ' +
  'sensor signal that drops out only under rotation.'

export const ABS_ROWS: TrailerReferenceRow[] = [

  // ───────────────────────────────────────────────────────────────────────────────
  // HALDEX TRAILER ABS — BLINK CODES
  // ───────────────────────────────────────────────────────────────────────────────

  {
    system: 'ABS',
    component: 'Haldex Blink Code 1-1',
    description:
      'Haldex trailer ABS two-digit blink code: one flash, pause, one flash. On Haldex ' +
      'ECUs the first digit identifies the fault group and the second digit identifies ' +
      'which channel or circuit within that group. The exact group-to-number mapping ' +
      'varies by ECU generation and is NOT asserted here — read it off the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Write the code down exactly as flashed — first digit, then second digit.\n' +
      '2. Read the blink code decal on the Haldex ECU to translate 1-1 for that specific ECU.\n' +
      '3. On many Haldex ECUs the lowest code in the table is the "no active fault" / ' +
      'end-of-sequence indication, so before chasing a repair confirm whether 1-1 is a ' +
      'fault at all on the unit in front of you.\n' +
      '4. If the decal is missing or unreadable, record the ECU part number and serial from ' +
      'the housing and pull the matching Haldex service literature.\n' +
      '5. Regardless of the code: check trailer ABS power and ground at the ECU first ' +
      '(constant power on the blue circuit of the 7-way, clean chassis ground). Low voltage ' +
      'and bad grounds set codes that look like component failures.\n' +
      CONFIRM_MAPPING,
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex Blink Code 2-1',
    description:
      'Haldex trailer ABS two-digit blink code: two flashes, pause, one flash. First digit ' +
      'is the fault group, second digit is the channel or circuit. Specific meaning must be ' +
      'confirmed against the ECU decal — Haldex has used different tables across ECU ' +
      'generations and the meaning is not asserted here.',
    value: null,
    units: null,
    notes:
      '1. Record the code exactly as flashed.\n' +
      '2. Translate it using the blink code decal on the Haldex ECU housing.\n' +
      '3. If the decal identifies this as a wheel speed sensor circuit, run the wheel speed ' +
      'sensor test procedure in this reference: 1000-2500 ohms resistance, 0.020-0.040 in ' +
      'air gap, minimum 0.2 V AC output while spinning the wheel by hand.\n' +
      '4. If the decal identifies this as a modulator circuit, run the modulator valve test ' +
      'procedure in this reference.\n' +
      '5. Inspect the sensor lead and modulator harness where it crosses the suspension and ' +
      'the slider box — chafe and pulled pins cause more trailer ABS codes than failed ' +
      'components do.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex Blink Code 3-1',
    description:
      'Haldex trailer ABS two-digit blink code: three flashes, pause, one flash. First digit ' +
      'is the fault group, second digit is the channel or circuit. Meaning not asserted — ' +
      'confirm against the ECU decal for that ECU generation.',
    value: null,
    units: null,
    notes:
      '1. Record the code exactly as flashed.\n' +
      '2. Translate using the blink code decal on the Haldex ECU housing.\n' +
      '3. Before condemning a component, back-probe the ECU connector for the circuit the ' +
      'decal names and verify the fault is present at the ECU, not just at the wheel end. ' +
      'A good reading at the sensor with a bad reading at the ECU is a harness fault.\n' +
      '4. Check for water intrusion in the ECU connector — pull it, look for green corrosion ' +
      'and pushed-back pins, and reseat with dielectric grease.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex Blink Code 4-1',
    description:
      'Haldex trailer ABS two-digit blink code: four flashes, pause, one flash. First digit ' +
      'is the fault group, second digit is the channel or circuit. Meaning not asserted — ' +
      'confirm against the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Record the code exactly as flashed.\n' +
      '2. Translate using the blink code decal on the Haldex ECU housing.\n' +
      '3. Higher first-digit codes on trailer ECUs commonly cover power supply, ECU ' +
      'internal, and configuration faults rather than wheel-end faults — but do not act on ' +
      'that assumption, read the decal.\n' +
      '4. Load-test trailer ABS power before replacing an ECU: key the ECU circuit and ' +
      'measure voltage at the ECU connector under load, not just open circuit. Voltage drop ' +
      'through a corroded 7-way pin or a bad ground strap will set ECU and valve faults.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex Blink Code 5-1',
    description:
      'Haldex trailer ABS two-digit blink code: five flashes, pause, one flash. First digit ' +
      'is the fault group, second digit is the channel or circuit. Meaning not asserted — ' +
      'confirm against the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Record the code exactly as flashed.\n' +
      '2. Translate using the blink code decal on the Haldex ECU housing.\n' +
      '3. If the decal identifies this as an ECU internal fault, confirm supply voltage and ' +
      'ground quality first, then clear the code and re-power. An ECU internal fault that ' +
      'will not clear on good power is a replacement.\n' +
      '4. Do not replace a Haldex ECU on a single blink code without confirming the code ' +
      'repeats after a full power cycle and a road test.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex ECU Blink Code Decal',
    description:
      'Where to find the authoritative blink code table for the trailer in front of you. ' +
      'Haldex prints the blink code list for that ECU generation on a decal on the ECU ' +
      'housing or inside its cover. That decal outranks any chart, including this one.',
    value: null,
    units: null,
    notes:
      '1. Locate the Haldex ECU — commonly mounted on the trailer frame rail near the front ' +
      'of the slider, on the crossmember, or integrated with the modulator valve assembly.\n' +
      '2. Wipe the housing down; road film hides the decal.\n' +
      '3. Read the blink code table and the ECU part number off the decal.\n' +
      '4. If the decal is destroyed, record the part number stamped in the housing and pull ' +
      'the Haldex service literature for that number.\n' +
      '5. Photograph the decal and attach it to the work order so the next tech on that ' +
      'trailer does not have to crawl under it again.',
    manufacturer: 'Haldex',
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // HALDEX — WHEEL SPEED SENSOR SPECS
  // ───────────────────────────────────────────────────────────────────────────────

  {
    system: 'ABS',
    component: 'Haldex Wheel Speed Sensor Air Gap',
    description:
      'Clearance between the wheel speed sensor tip and the tone ring (exciter ring) teeth ' +
      'on Haldex trailer ABS. Too much gap and the sensor output drops below what the ECU ' +
      'can read at low speed, which sets an intermittent code that only appears on the road.',
    value: '0.020-0.040',
    units: 'inches',
    notes:
      '1. Sensors are set by pushing, not by measuring: push the sensor all the way in ' +
      'through its spring clip until it bottoms against the tone ring, then rotate the ' +
      'wheel. Normal hub runout backs the sensor off to its running gap.\n' +
      '2. Verify with a feeler gauge or by measuring AC output — 0.020-0.040 in is the ' +
      'acceptable running gap.\n' +
      '3. Excessive gap is usually a worn sensor spring clip that no longer holds the ' +
      'sensor. Replace the clip whenever you pull the sensor; it is cheap and it is the ' +
      'actual failure most of the time.\n' +
      '4. Lubricate the sensor body with the manufacturer-specified sensor lubricant before ' +
      'installing so it can slide in its clip.\n' +
      '5. Inspect the tone ring while you are in there — a cracked ring, a missing tooth, or ' +
      'a ring loose on the hub produces erratic signal that reads as a sensor fault.\n' +
      'CAUTION: chock the wheels and support the axle before rotating any wheel.',
    manufacturer: 'Haldex',
  },

  {
    system: 'ABS',
    component: 'Haldex Wheel Speed Sensor Resistance',
    description:
      'Coil resistance of a Haldex trailer ABS wheel speed sensor measured across the two ' +
      'sensor leads with the sensor unplugged from the harness. Out of range means an open ' +
      'or shorted sensor winding.',
    value: '1000-2500',
    units: 'ohms',
    notes:
      '1. Disconnect the sensor from the harness before measuring — measuring through the ' +
      'ECU gives a meaningless reading.\n' +
      '2. Meter on ohms, one lead on each sensor pin. Reading must fall in 1000-2500 ohms.\n' +
      '3. OL / infinite = open winding or broken lead. Near zero = shorted winding. Both are ' +
      'sensor replacement.\n' +
      '4. Also check each sensor pin to ground: must be open (well above 20k ohms). ' +
      'Continuity to ground is a chafed lead, usually where the sensor cable crosses the ' +
      'brake spider or the air line bundle.\n' +
      '5. A sensor that passes resistance can still fail — resistance only proves the ' +
      'winding is intact, not that output is strong enough. Follow with the AC output test.',
    manufacturer: 'Haldex',
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // BENDIX TRAILER ABS — BLINK CODES
  // ───────────────────────────────────────────────────────────────────────────────

  {
    system: 'ABS',
    component: 'Bendix Blink Code 1',
    description:
      'Bendix trailer ABS blink code: one flash of the trailer ABS lamp between pauses ' +
      'while the ECU is in diagnostic blink code mode. The specific meaning depends on the ' +
      'Bendix trailer module generation (TABS-6 and the trailer EC series do not share one ' +
      'table) and is NOT asserted here — confirm against the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Count the flashes carefully and note whether the module flashes a single number or ' +
      'a two-part pattern; some Bendix trailer modules flash a main code and a sub-code.\n' +
      '2. Translate the count using the decal on the Bendix ECU housing or the Bendix ' +
      'service data sheet for the module part number.\n' +
      '3. Do not read a Bendix trailer code off a Bendix TRACTOR ABS chart (EC-60 and ' +
      'similar). The tables are different systems.\n' +
      '4. Verify ABS power and ground at the module before diagnosing any component.\n' +
      CONFIRM_MAPPING,
    manufacturer: 'Bendix',
  },

  {
    system: 'ABS',
    component: 'Bendix Blink Code 2',
    description:
      'Bendix trailer ABS blink code: two flashes between pauses in diagnostic blink code ' +
      'mode. Meaning varies by Bendix trailer module generation and is not asserted here — ' +
      'confirm against the ECU decal or the Bendix service data sheet for that part number.',
    value: null,
    units: null,
    notes:
      '1. Record the flash count exactly.\n' +
      '2. Translate using the decal on the Bendix module.\n' +
      '3. If the decal identifies a wheel speed sensor circuit, run the wheel speed sensor ' +
      'test procedure: resistance, air gap, and minimum 0.2 V AC output while spinning the ' +
      'wheel by hand.\n' +
      '4. If the decal identifies a modulator circuit, check modulator coil resistance ' +
      '(3.5-6.5 ohms) and confirm the valve actually cycles.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Bendix',
  },

  {
    system: 'ABS',
    component: 'Bendix Blink Code 3',
    description:
      'Bendix trailer ABS blink code: three flashes between pauses in diagnostic blink code ' +
      'mode. Meaning varies by module generation and is not asserted here — confirm against ' +
      'the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Record the flash count exactly.\n' +
      '2. Translate using the decal on the Bendix module.\n' +
      '3. Confirm the fault is present at the module connector, not only at the component. ' +
      'Back-probe the named circuit at the ECU. Good at the component and bad at the ECU is ' +
      'a harness repair, not a parts replacement.\n' +
      '4. Check the module connector for corrosion and pushed-back pins; reseat with ' +
      'dielectric grease.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Bendix',
  },

  {
    system: 'ABS',
    component: 'Bendix Blink Code 4',
    description:
      'Bendix trailer ABS blink code: four flashes between pauses in diagnostic blink code ' +
      'mode. Meaning varies by module generation and is not asserted here — confirm against ' +
      'the ECU decal.',
    value: null,
    units: null,
    notes:
      '1. Record the flash count exactly.\n' +
      '2. Translate using the decal on the Bendix module.\n' +
      '3. If the decal identifies a power supply or ECU fault, measure ABS supply voltage at ' +
      'the module connector under load and check the ground path. Voltage drop across a ' +
      'corroded 7-way pin, a bad nosebox connection, or a painted ground stud sets faults ' +
      'that mimic module failure.\n' +
      '4. Clear the code, re-power, and road test before replacing a module.\n' +
      CONFIRM_MAPPING + '\n' + ROAD_TEST,
    manufacturer: 'Bendix',
  },

  {
    system: 'ABS',
    component: 'Bendix ECU Blink Code Decal',
    description:
      'Where to find the authoritative blink code table for a Bendix trailer ABS module. ' +
      'Bendix prints or supplies the code list for that specific module; it outranks any ' +
      'general chart including this one.',
    value: null,
    units: null,
    notes:
      '1. Locate the Bendix trailer module — frame-rail mounted, or integrated with the ' +
      'modulator valve assembly on TABS-6 style units.\n' +
      '2. Clean the housing and read the decal plus the module part number.\n' +
      '3. If there is no decal, pull the Bendix service data sheet for that part number.\n' +
      '4. Bendix trailer modules and Bendix tractor ECUs (EC-60 and similar) use different ' +
      'code tables — make sure you are holding the trailer document.\n' +
      '5. Photograph the decal onto the work order.',
    manufacturer: 'Bendix',
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // BENDIX — MODULATOR SPEC
  // ───────────────────────────────────────────────────────────────────────────────

  {
    system: 'ABS',
    component: 'Bendix Modulator Coil Resistance',
    description:
      'Resistance of a Bendix trailer ABS modulator valve solenoid coil, measured at the ' +
      'valve connector with the harness disconnected. Each modulator has a hold coil and a ' +
      'release coil and both must be in spec.',
    value: '3.5-6.5',
    units: 'ohms',
    notes:
      '1. Turn off ABS power and disconnect the modulator connector.\n' +
      '2. Measure each coil across its signal pin and the common/ground pin. Both the hold ' +
      'and the release coil must read 3.5-6.5 ohms.\n' +
      '3. OL / infinite = open coil. Near zero = shorted coil. Either one is valve ' +
      'replacement.\n' +
      '4. Measure each coil pin to the valve body/ground: must be open. Continuity to the ' +
      'body is a shorted coil.\n' +
      '5. A coil that reads in spec cold can still open when hot. If the code is ' +
      'intermittent and appears after a run, re-measure with the valve at operating ' +
      'temperature.\n' +
      '6. Coil resistance in spec does not prove the valve moves air — follow with the ' +
      'modulator valve cycling test.',
    manufacturer: 'Bendix',
  },

  // ───────────────────────────────────────────────────────────────────────────────
  // BOTH SYSTEMS — PROCEDURES
  // ───────────────────────────────────────────────────────────────────────────────

  {
    system: 'ABS',
    component: 'Retrieving Trailer ABS Blink Codes',
    description:
      'How to put a trailer ABS ECU into diagnostic blink code mode and read the flashes off ' +
      'the trailer ABS warning lamp. Applies to both Haldex and Bendix trailer ABS; the ' +
      'exact number of power cycles to enter the mode is set by the ECU and is on its decal.',
    value: null,
    units: null,
    notes:
      'SETUP\n' +
      '1. Chock the wheels. Trailer must be stationary with the parking brake set.\n' +
      '2. Locate the trailer ABS warning lamp — on the left (roadside) of the trailer near ' +
      'the front, required on trailers built after March 1998 under FMVSS 121. This lamp is ' +
      'what flashes the codes.\n' +
      '3. Apply power to the trailer ABS circuit. On a trailer connected to a tractor this ' +
      'is the constant-power blue circuit of the 7-way. Off the truck, apply 12 V to the ABS ' +
      'power pin at the nosebox.\n' +
      '4. Watch the normal power-up self-check: the lamp illuminates for roughly 2-3 seconds ' +
      'and goes out if no faults are stored. A lamp that stays on means an active fault.\n' +
      '\n' +
      'ENTERING BLINK CODE MODE\n' +
      '5. With power applied and the self-check complete, cycle the ABS power off and on in ' +
      'quick succession. Most trailer ECUs enter blink code mode after a specific number of ' +
      'cycles (commonly three) within a few seconds. THE EXACT COUNT IS ECU-SPECIFIC — read ' +
      'it off the ECU decal.\n' +
      '6. Some ECUs use a momentary diagnostic switch or a diagnostic wire grounded briefly ' +
      'instead of a power cycle. If cycling power does not produce flashes, look for that ' +
      'switch or wire on the ECU.\n' +
      '7. The ECU acknowledges the mode by beginning to flash the lamp in a deliberate, ' +
      'countable pattern rather than a steady light.\n' +
      '\n' +
      'READING A TWO-DIGIT CODE (Haldex style)\n' +
      '8. Count the first group of flashes. That is the FIRST digit.\n' +
      '9. A SHORT PAUSE (roughly 1.5-2 seconds) with the lamp off separates the first digit ' +
      'from the second. That pause is the only thing telling you where one digit ends and ' +
      'the next begins — if you miss it you will read 2-1 as three flashes.\n' +
      '10. Count the second group of flashes. That is the SECOND digit. Three flashes, pause, ' +
      'two flashes = code 3-2.\n' +
      '11. A LONGER PAUSE (roughly 4 seconds or more) with the lamp off ends the code. The ' +
      'ECU then repeats the same code, or moves to the next stored code.\n' +
      '\n' +
      'READING A SINGLE-DIGIT CODE (Bendix style)\n' +
      '12. Count the flashes in the group, then wait through the long pause. The repeat tells ' +
      'you whether you counted right.\n' +
      '\n' +
      'MULTIPLE CODES AND VERIFICATION\n' +
      '13. Watch through at least two full repetitions before writing anything down. Miscounts ' +
      'are the single most common trailer ABS diagnostic error.\n' +
      '14. If more than one code is stored, the ECU steps through them separated by the long ' +
      'pause. Keep watching until the sequence starts over from the first code.\n' +
      '15. Translate every code against the decal on that ECU. See the Haldex and Bendix ECU ' +
      'decal entries in this reference.\n' +
      '16. After repair, clear codes per the ECU procedure, power cycle, and road test above ' +
      '6 mph so the ECU re-validates every wheel speed signal.\n' +
      'CAUTION: an ABS lamp that is out does not mean the system is healthy — it means no ' +
      'active fault is stored. Stored history codes may still be present.',
    manufacturer: 'Trailer',
  },

  {
    system: 'ABS',
    component: 'Wheel Speed Sensor Testing Procedure',
    description:
      'Full three-part test of a trailer ABS wheel speed sensor: coil resistance, air gap, ' +
      'and AC voltage output while the wheel is turned by hand. A sensor must pass all three ' +
      '— resistance alone does not prove the sensor will produce a usable signal.',
    value: '0.2',
    units: 'V AC (minimum output)',
    notes:
      'SAFETY\n' +
      '1. Chock the wheels that stay on the ground. Support the axle on jack stands before ' +
      'lifting any wheel — never work under a trailer on a jack alone.\n' +
      '2. Release the spring brakes so the wheel can turn, and keep hands clear of the tread.\n' +
      '\n' +
      'STEP 1 — RESISTANCE\n' +
      '3. Disconnect the sensor from the harness at the sensor pigtail connector.\n' +
      '4. Meter on ohms across the two sensor pins. Haldex spec 1000-2500 ohms; confirm the ' +
      'Bendix figure against the sensor part number, most trailer sensors fall in the same ' +
      'general range.\n' +
      '5. OL / infinite = open winding or broken lead. Near zero = shorted winding. Replace.\n' +
      '6. Check each pin to ground: must be open. Continuity to ground = chafed lead.\n' +
      '\n' +
      'STEP 2 — AIR GAP\n' +
      '7. Inspect the sensor tip for metal pickup, scoring, and a burnt smell.\n' +
      '8. Verify the running gap is 0.020-0.040 in. If the gap is excessive, push the sensor ' +
      'back in until it bottoms on the tone ring and rotate the wheel to reset it.\n' +
      '9. If the sensor will not hold position, the spring clip is worn out — replace the ' +
      'clip. This is the most common cause of an intermittent wheel speed fault.\n' +
      '10. Inspect the tone ring for cracks, missing or damaged teeth, packed debris, and ' +
      'looseness on the hub. A damaged ring produces erratic output that reads as a sensor ' +
      'fault and will not be fixed by a new sensor.\n' +
      '11. Check hub bearing endplay. Excessive endplay lets the gap open and close as the ' +
      'wheel turns and produces a signal that drops out only under load.\n' +
      '\n' +
      'STEP 3 — AC VOLTAGE OUTPUT (the test that actually proves the sensor)\n' +
      '12. Leave the sensor disconnected from the harness. Meter on AC volts across the two ' +
      'sensor pins.\n' +
      '13. Spin the wheel by hand at roughly one half revolution per second — about 30 rpm, ' +
      'a steady walking-speed pull on the tire.\n' +
      '14. A healthy sensor outputs at least 0.2 V AC at that speed. Most good sensors read ' +
      'well above it.\n' +
      '15. WHAT A FAILING READING LOOKS LIKE:\n' +
      '    - Below 0.2 V AC: weak sensor or excessive air gap. Reset the gap and retest ' +
      'before condemning the sensor.\n' +
      '    - Zero output with good resistance: sensor is not seeing the tone ring at all — ' +
      'sensor backed out of its clip, or the tone ring is missing/sheared.\n' +
      '    - Output that jumps around or drops to zero at points in the rotation: damaged ' +
      'tone ring tooth, bent ring, loose hub, or a broken wire that opens as the harness ' +
      'moves. Flex the sensor lead by hand while watching the meter — a reading that ' +
      'changes when you move the wire is a lead failure, not a sensor failure.\n' +
      '    - Output good at the sensor but the ECU still codes that channel: harness or ECU ' +
      'connector fault. Repeat the AC output test at the ECU connector to prove the wire.\n' +
      '16. Compare left to right on the same axle. A large difference between two sensors ' +
      'spun at the same speed points at the low one.\n' +
      '\n' +
      'AFTER REPAIR\n' +
      '17. Lubricate the sensor, install with a new spring clip, push fully to the tone ring.\n' +
      '18. Route and secure the lead away from the brake spider, air lines, and any pinch ' +
      'point. Leave enough slack for full suspension travel and axle articulation.\n' +
      '19. Clear codes, power cycle, road test above 6 mph and confirm the lamp stays out.',
    manufacturer: 'Trailer',
  },

  {
    system: 'ABS',
    component: 'Modulator Valve Testing Procedure',
    description:
      'Test of a trailer ABS modulator (pressure modulator valve). Two parts: solenoid coil ' +
      'resistance, and a functional check that confirms the valve actually cycles air. A ' +
      'valve can have electrically perfect coils and still be seized.',
    value: '3.5-6.5',
    units: 'ohms (Bendix coil)',
    notes:
      'SAFETY\n' +
      '1. Chock the wheels. The modulator controls service brake pressure — the trailer can ' +
      'apply or release brakes during this test.\n' +
      '2. Stand clear of the wheel ends while the valve is being cycled.\n' +
      '\n' +
      'PART 1 — COIL RESISTANCE\n' +
      '3. Turn off ABS power. Disconnect the modulator connector.\n' +
      '4. Measure the hold coil and the release coil separately, each from its signal pin to ' +
      'the common/ground pin. Bendix spec 3.5-6.5 ohms per coil. Confirm the Haldex figure ' +
      'against the valve part number — do not assume the Bendix number applies.\n' +
      '5. Both coils must be in spec. OL = open coil, near zero = shorted coil, either is ' +
      'valve replacement.\n' +
      '6. Measure each coil pin to the valve body: must be open. Continuity is a short.\n' +
      '7. Compare the two coils to each other. A significant difference between hold and ' +
      'release on the same valve is suspicious even if both fall inside the range.\n' +
      '\n' +
      'PART 2 — CONFIRMING THE VALVE ACTUALLY CYCLES\n' +
      '8. Reconnect the modulator and charge the trailer air system to full pressure.\n' +
      '9. Run the ECU self-test / valve activation routine. On most trailer ABS this fires ' +
      'automatically at power-up or at the start of the road test; some ECUs will cycle the ' +
      'valves on command from a diagnostic tool.\n' +
      '10. LISTEN AND FEEL at the modulator. A working valve produces a distinct audible ' +
      'click or chuff for each coil energizing and a short burst of air out the exhaust port. ' +
      'Put a hand on the valve body — you can feel it actuate.\n' +
      '11. No click and no exhaust on a coil that measured in spec means the valve is seized ' +
      'internally or is not being commanded. Verify the ECU is sending the command by ' +
      'back-probing the coil circuit during the test before replacing the valve.\n' +
      '12. Constant air leaking from the modulator exhaust port with the brakes released, or ' +
      'a valve that will not release applied pressure, is a failed valve — replace it.\n' +
      '13. Apply and release the service brakes and confirm the wheel end applies and ' +
      'releases fully. A modulator stuck in hold traps pressure at that wheel end and will ' +
      'drag the brake.\n' +
      '\n' +
      'AFTER REPAIR\n' +
      '14. Leak-check every air fitting you broke loose with soap solution at full pressure.\n' +
      '15. Clear codes, power cycle, and road test above 6 mph. Confirm the trailer ABS lamp ' +
      'completes its self-check and goes out.\n' +
      'CAUTION: never plug or bypass a modulator to "get it down the road." The valve is in ' +
      'the service brake circuit and the trailer is out of FMVSS 121 compliance without a ' +
      'functioning ABS.',
    manufacturer: 'Trailer',
  },

  {
    system: 'ABS',
    component: 'Trailer ABS Warning Lamp Operation',
    description:
      'Normal and abnormal behavior of the trailer-mounted ABS warning lamp. Reading the ' +
      'lamp correctly is the first diagnostic step on any trailer ABS complaint and it is ' +
      'what the blink codes are flashed on.',
    value: '2-3',
    units: 'seconds (normal power-up self-check)',
    notes:
      '1. LOCATION: on the roadside (left) of the trailer near the front. Required on ' +
      'trailers manufactured after March 1, 1998 under FMVSS 121.\n' +
      '2. NORMAL: lamp illuminates for about 2-3 seconds at power-up, then goes out. That is ' +
      'the ECU self-check completing with no active faults.\n' +
      '3. STAYS ON at power-up: active fault stored. Retrieve blink codes.\n' +
      '4. NEVER COMES ON at power-up: the lamp circuit itself is dead — burnt bulb/LED, no ' +
      'ABS power on the blue circuit, blown fuse, or an unplugged ECU. This is a defect in ' +
      'its own right; a lamp that cannot illuminate cannot warn the driver.\n' +
      '5. GOES OUT AT POWER-UP BUT COMES ON WHILE DRIVING: a signal that only fails under ' +
      'rotation — wheel speed sensor dropping out, excessive air gap, damaged tone ring, or ' +
      'a harness that opens with suspension movement.\n' +
      '6. FLASHES A PATTERN: the ECU is in blink code mode. See the blink code retrieval ' +
      'procedure in this reference.\n' +
      '7. In-cab trailer ABS indication is carried over PLC on the power line of the 7-way. ' +
      'If the dash indicator is dead but the trailer lamp works, suspect the PLC signal path ' +
      'or a tractor that does not support it — not the trailer ECU.\n' +
      '8. Corroded and loose 7-way nosebox pins are the most common cause of intermittent ' +
      'trailer ABS lamp and power complaints. Inspect and clean the nosebox before chasing ' +
      'the ECU.',
    manufacturer: 'Trailer',
  },
]
