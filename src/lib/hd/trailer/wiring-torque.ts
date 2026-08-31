// Trailer electrical (7-way RV blade) and fastener torque reference.
//
// One of the data modules for hd_trailer_reference. Owns the 'Electrical' and
// 'Torque Specs' systems. Loaded by /api/hd/trailer-reference/seed alongside the
// air-brake, slack-adjuster and ABS modules.
//
// Colour-to-circuit mapping below follows the SAE J560 / RV-blade convention that is
// standard on North American trailers. Physical pin POSITIONS are described using the
// common tow-vehicle socket view (facing the socket, latch at 12 o'clock); a plug-side
// view is the mirror image of that, which is the single most common way a technician
// misreads a wiring diagram. Identify circuits by colour and by test light, not by
// position alone.

import type { TrailerReferenceRow } from './types'

export const WIRING_TORQUE_ROWS: TrailerReferenceRow[] = [
  // ---------------------------------------------------------------------------
  // PART 1 - 7-WAY RV BLADE CONNECTOR (SAE J560 RV-style, 7 pins)
  // ---------------------------------------------------------------------------
  {
    system: 'Electrical',
    component: 'Ground (7-Way Pin 1)',
    description:
      'WHITE wire. Common ground return for every trailer circuit. Upper-left outer pin (approx 11 o\'clock) on the tow-vehicle socket, latch at top; largest-gauge conductor in the harness.',
    value: '10-12',
    units: 'AWG',
    notes:
      'Carries the SUM of all trailer current - lights, brakes and any 12V accessory load - back to the tow vehicle battery. Must land on clean bare metal at the trailer frame, not on painted or primered surface, and not on a rusted bolt. This is the highest-failure pin on the connector: see the "7-Way Ground Failure" entry. Position is stated for the standard socket-face view; confirm with a test light before cutting any wire.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: '12V Constant / Battery Charge (7-Way Pin 2)',
    description:
      'BLACK wire. Switched or constant 12V feed from the tow vehicle for trailer battery charge, interior loads and breakaway battery maintenance. Upper-right outer pin (approx 1 o\'clock) on the socket face.',
    value: '30',
    units: 'amps (typical fuse)',
    notes:
      'Some OEM and older installations use RED for this circuit instead of black - if the harness has a red wire and no black, treat red as the 12V constant feed. Fuse rating varies by tow vehicle (commonly 30A, sometimes 40A); confirm against the vehicle fuse chart before upsizing. This is the pin most likely to be swapped with the electric-brake pin on shop-built or aftermarket harnesses - verify with a meter, do not assume.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Electric Brakes (7-Way Pin 3)',
    description:
      'BLUE wire. Output from the in-cab brake controller to the trailer electric brake magnets. Lower-right outer pin (approx 5 o\'clock) on the socket face.',
    value: '20-30',
    units: 'amps (typical fuse)',
    notes:
      'Voltage on this pin is variable, not a steady 12V - it ramps with brake controller output, so a meter reading of 0V at rest is normal and correct. Test it by applying the controller manual override and reading voltage at the connector. Typical current draw is roughly 3 amps per brake magnet, so a two-axle trailer with four magnets pulls about 12 amps at full application. A brake magnet drawing well over 3 amps is shorting; one drawing well under is open or has a worn magnet.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Right Turn / Stop (7-Way Pin 4)',
    description:
      'GREEN wire. Combined right-side turn signal and stop lamp feed. Right-side outer pin (approx 3 o\'clock) on the socket face.',
    value: '10',
    units: 'amps (typical fuse)',
    notes:
      'On a trailer with combined stop/turn lamps this circuit is fed by both the brake switch and the right turn signal. If the right turn flashes but the brake lights do not work on that side only, suspect the tow vehicle taillight converter rather than the trailer.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Left Turn / Stop (7-Way Pin 5)',
    description:
      'YELLOW wire. Combined left-side turn signal and stop lamp feed. Lower-left outer pin (approx 7 o\'clock) on the socket face.',
    value: '10',
    units: 'amps (typical fuse)',
    notes:
      'Mirror of the green right turn/stop circuit. Green = right, yellow = left is the North American standard and does not vary; if a trailer signals backwards, the trailer plug has been miswired, not the connector standard.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Tail / Running / Marker Lights (7-Way Pin 6)',
    description:
      'BROWN wire. Tail lamps, side marker lamps, clearance lamps and licence plate lamp - everything that comes on with the headlight switch. Left-side outer pin (approx 9 o\'clock) on the socket face.',
    value: '10',
    units: 'amps (typical fuse)',
    notes:
      'The highest continuous-load lighting circuit on the trailer because it feeds every marker and clearance lamp at once. On long trailers with incandescent markers this circuit is the one most likely to show measurable voltage drop; converting markers to LED roughly cuts the load by an order of magnitude and often cures dim-tail-light complaints outright.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Auxiliary / Reverse (7-Way Centre Pin)',
    description:
      'CENTRE pin of the connector. Auxiliary 12V or reverse/backup lamp feed depending on how the trailer is built. Wire colour is not standardised - commonly purple, sometimes red or violet.',
    value: '10-20',
    units: 'amps (typical fuse)',
    notes:
      'FLAGGED AS UNCERTAIN - this is the one pin on the connector whose function is not fixed. The centre pin is assigned to reverse/backup lamps on most modern tow vehicles and cargo trailers, but is used as a general 12V auxiliary (hydraulic pump, dump trailer, liftgate) on others, and the wire colour varies by builder. Ring the pin out with a meter and confirm what the tow vehicle is actually putting on it before connecting anything to it. Backfeeding an auxiliary load onto a reverse-lamp output, or a reverse output into a pump circuit, is how this pin gets burned.',
    manufacturer: 'Trailer',
  },

  // ---------------------------------------------------------------------------
  // PART 1b - VOLTAGE, TESTING AND FAULT DIAGNOSIS
  // ---------------------------------------------------------------------------
  {
    system: 'Electrical',
    component: 'Voltage Requirement Under Load',
    description:
      'Acceptable voltage at the trailer connector with the circuit switched ON and carrying its normal load. Measured pin-to-ground at the connector, not at the battery.',
    value: '0.5',
    units: 'volts max drop',
    notes:
      'The number that matters is the DROP, not the nominal 12V. With the engine off and the circuit loaded, voltage at the connector should be within 0.5 volts of battery voltage - so roughly 12.1-12.6V on a healthy 12.6V battery, and roughly 13.5-14.0V with the engine running and the alternator charging. A circuit that reads a full 12.6V with the load switched OFF and collapses to 9 or 10V the moment the load is applied has a high-resistance connection and will be dismissed as "good" by anyone testing open-circuit. Over 0.5V total drop needs repair; over 1.0V will visibly dim lamps and will under-apply electric brakes.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Voltage Drop Test Procedure',
    description:
      'Stepwise voltage-drop test of a trailer circuit at the 7-way connector. Separates a bad ground from a bad feed - a test light cannot do this.',
    value: '0.5',
    units: 'volts max total',
    notes:
      'STEP 1 - Measure and record battery voltage at the tow vehicle battery posts, engine off. This is the baseline. STEP 2 - Plug the trailer in and switch the circuit under test ON so it is carrying real current (headlights on for the brown circuit, brake pedal or controller override for blue, hazards or turn for green/yellow). Testing an open circuit with no load is the single most common mistake and will read normal on a connection that fails under load. STEP 3 - With the load still applied, put the meter red lead on the circuit pin at the connector and the black lead on a clean chassis ground on the TOW VEHICLE. Subtract that reading from the STEP 1 baseline: the difference is the drop on the FEED side. STEP 4 - Move the meter to read directly across the ground path: red lead on the trailer frame or the trailer-side white ground, black lead on tow vehicle battery negative, load still applied. Whatever the meter reads here is drop on the GROUND side and should be under 0.2V. INTERPRETING IT: high drop in Step 3 with a clean Step 4 = bad feed - corroded pin, damaged wire, failing relay or converter, undersized wire. Clean Step 3 with high drop in Step 4 = bad ground - the white pin, the frame stud, or a rusted ground bolt. Both high = corroded connector body, replace the connector. Zero drop everywhere but the lamp is still dim = the fault is downstream in the trailer harness, so repeat the test at the lamp socket.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: '7-Way Ground Failure (White Pin)',
    description:
      'The white ground pin is the most common electrical failure on the entire trailer connector. Symptom is rarely a dead circuit - it is dim, flickering or cross-connected lights.',
    value: '0.2',
    units: 'volts max drop',
    notes:
      'WHY IT FAILS FIRST: every circuit on the trailer returns through this one pin, so it carries more current than any other pin in the connector and sits at the lowest point of the plug where road salt and water collect. WHY THE SYMPTOM IS INTERMITTENT: a partly degraded ground still passes enough current to light the lamps most of the time, so the fault comes and goes with vibration, moisture and load - lights work until you turn on the headlights and add the marker load, then dim or flicker. THE TELL-TALE: with a bad ground, current backfeeds through whatever return path it can find, so circuits interact - hit the brakes and the turn signal dims, or the tail lights glow when the turn signal flashes, or the running lights pulse in time with the flasher. Any time two unrelated trailer circuits affect each other, check the white ground before anything else. REPAIR: do not just clean the pin. Also pull the trailer-side ground ring terminal off the frame, wire-brush the frame down to bare metal, use a star washer, re-torque, and coat with dielectric grease. A ground that reads over 0.2V drop under load is failed even if the lights currently work.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Corroded Connector Pins',
    description:
      'Green, white or powdery corrosion on the blades and sockets of the 7-way. Raises circuit resistance without opening it, so lamps still light but at reduced voltage.',
    value: null,
    units: null,
    notes:
      'Corrosion is a resistance fault, not an open, which is why it defeats test-light diagnosis - a test light will glow on a pin that has lost 3 volts. Inspect both halves: the socket on the tow vehicle collects water because it points slightly upward, and the plug on the trailer collects it because it hangs. REPAIR: clean sockets with a nylon or brass connector brush and electrical contact cleaner - never sandpaper or a file, which removes the plating and guarantees the corrosion comes back worse. Spread the socket contacts slightly if they have taken a set. Pack with dielectric grease on reassembly. Replace the connector outright if the blades are pitted, thinned, or if any pin is loose in the housing. Always keep the spring-loaded cover closed when the trailer is unhooked.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Electrical',
    component: 'Intermittent Trailer Light Diagnosis',
    description:
      'Diagnostic order for lights that work sometimes - the most common trailer electrical complaint and almost never a bulb.',
    value: null,
    units: null,
    notes:
      'ORDER OF ATTACK: (1) The white ground pin and the trailer-side frame ground - this is the cause in the clear majority of intermittent cases, especially if multiple lamps misbehave together or circuits interact. (2) The connector pins themselves, both halves, for corrosion and for spread/loose sockets. (3) The harness where it flexes or chafes - at the tongue, over the frame rails, and anywhere it is zip-tied against a sharp edge; wiggle-test each section with the circuit loaded and the meter connected. (4) Individual lamp grounds at each housing, which corrode the same way the main ground does. (5) The bulb itself, last. RULE OF THUMB: one lamp out is usually that lamp or its ground; several lamps out or misbehaving together is the shared ground or the connector. Do the wiggle test with the circuit LOADED and a voltmeter attached, so a momentary resistance spike shows as a voltage dip - unloaded continuity testing will not reproduce the fault.',
    manufacturer: 'Trailer',
  },

  // ---------------------------------------------------------------------------
  // PART 2 - TORQUE SPECIFICATIONS
  // ---------------------------------------------------------------------------
  {
    system: 'Torque Specs',
    component: 'Wheel Lug Nuts',
    description: 'Trailer wheel lug nut / flange nut torque.',
    value: '450-500',
    units: 'ft-lbs',
    notes:
      'Tighten in a STAR (criss-cross) pattern, never around the circle - sequential tightening cocks the wheel on the hub and leaves the clamp load uneven. Bring all fasteners up in stages (roughly one third, then two thirds, then full spec), completing the full star pattern at each stage. RE-TORQUE AFTER THE FIRST 50-100 MILES of service after any wheel is removed, and again after the next 50-100 miles if any nut moved. The mating surfaces bed in and the joint relaxes on the first heat cycle, so a wheel torqued correctly once will still come loose without the re-torque. This is the fastener on this list that strands trailers and drops wheels. Threads must be clean and DRY unless the OEM specifically calls for lubricant - oiled threads reach the spec torque at far higher clamp load and will stretch or snap studs.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Brake Chamber Mounting Bolts',
    description: 'Brake chamber to bracket mounting nuts/bolts.',
    value: '90-100',
    units: 'ft-lbs',
    notes:
      'Cage the spring brake before removing a chamber. Check that the mounting bracket is not cracked or elongated at the bolt holes while the chamber is off - a chamber that has been loose will have wallowed the holes and will not hold torque no matter how it is tightened.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Slack Adjuster Clamp Bolt',
    description: 'Automatic slack adjuster clamp / pinch bolt.',
    value: '40-50',
    units: 'ft-lbs',
    notes:
      'Low relative to the fasteners around it - do not reach for the same wrench used on the chamber bolts. Overtightening distorts the clamp and can bind the adjuster mechanism so it stops taking up stroke; undertightening lets the slack adjuster walk on the camshaft splines.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Brake Spider Bolts',
    description: 'Brake spider to axle flange mounting bolts.',
    value: '250-300',
    units: 'ft-lbs',
    notes:
      'Tighten in a criss-cross pattern. A loose spider shows up as uneven or grabby braking and as fretting rust weeping from the joint. Inspect the axle flange for cracks around the bolt holes whenever the spider is off.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'King Pin Lock / Retaining Bolts',
    description: 'Kingpin lock plate / retaining fastener torque.',
    value: '200-250',
    units: 'ft-lbs',
    notes:
      'Safety-critical - this is the connection holding the trailer to the tractor. Inspect the kingpin for wear, ovality and cracking at the same time, and check the upper coupler plate for cracks or distortion. Any doubt about kingpin wear is a gauge measurement against OEM limits, not a visual call.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Landing Gear Mounting Bolts',
    description: 'Landing gear leg to frame mounting bolts.',
    value: '90-120',
    units: 'ft-lbs',
    notes:
      'Both legs must be mounted at the same height and the cross shaft must turn freely by hand before final torque, or the gearbox binds and strips. Check for elongated mounting holes and cracked frame gussets - landing gear damage from being dropped or dragged usually shows at the mounting bolts first.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Fifth Wheel Mounting Bolts',
    description: 'Fifth wheel plate / mounting bracket bolts.',
    value: '300-400',
    units: 'ft-lbs',
    notes:
      'Safety-critical. Use only the grade of fastener specified by the fifth wheel manufacturer - substituting a lower-grade bolt at the same torque is a failure waiting to happen. Verify torque on every bolt in the pattern rather than spot-checking, and re-check after the first loaded trip following any fifth wheel service.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Glad Hand Fittings',
    description: 'Glad hand coupling to air line / bracket fitting.',
    value: '25-30',
    units: 'ft-lbs',
    notes:
      'Low torque - overtightening cracks the casting or distorts the sealing face and causes the leak it was meant to fix. Replace the rubber seal whenever a glad hand is disturbed; a hardened or nicked seal will leak at any torque. Soap-test the joint after assembly with the system charged.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'ABS Wheel Speed Sensor',
    description: 'ABS wheel speed sensor retaining fastener / bracket bolt.',
    value: '13-18',
    units: 'ft-lbs',
    notes:
      'Very low torque - a hand wrench only, never an impact. The sensor body and its bracket are easily crushed or cracked, and a damaged sensor reads erratically rather than failing outright, which produces intermittent ABS faults that are hard to trace. Push the sensor fully into its bushing against the tone ring before securing, and route the lead so it cannot chafe on the hub or the brake components.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Torque Specs',
    component: 'Push-To-Connect Air Fittings',
    description:
      'Push-to-connect (DOT push-lock) air line fittings. Assembly instruction, not a torque figure.',
    value: 'Hand tight plus 1.5 turns',
    units: null,
    notes:
      'DO NOT TORQUE THESE. There is deliberately no ft-lbs figure here because the seal is made by an internal O-ring and a gripping collet, not by clamp load on the threads. Thread the fitting in by hand until it seats, then turn it a further 1 to 1.5 turns with a wrench and stop. Applying torque-wrench values cracks the plastic or brass body, deforms the collet so it will not grip the tube, or splits the port boss - and the resulting leak is usually blamed on the tube rather than the fitting. Cut the air line square with a proper tube cutter, deburr it, and push it fully home until it bottoms; a tube cut on an angle or not fully inserted will leak no matter how the fitting is tightened. Tug-test every connection after assembly and soap-test with the system charged.',
    manufacturer: 'Trailer',
  },
]
