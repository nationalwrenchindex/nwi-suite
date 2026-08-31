import type { TrailerReferenceRow } from './types'

// Trailer air brake system: pneumatic flow, gladhands, relay valve, spring brakes, and
// the brake chamber size/stroke tables.
//
// Two conventions this module holds to, because a wrong number here gets someone hurt:
//
// 1. Stroke limits are the FMVSS 121 / CVSA readjustment limits measured at 90-100 PSI,
//    and they differ between STANDARD stroke and LONG stroke chambers of the same type
//    number. A Type 30 is 2" standard and 2.5" long stroke. Rows below always say which,
//    because using the long-stroke limit on a standard-stroke chamber passes a brake
//    that is legally out of adjustment.
// 2. Where a figure is not one this module can stand behind for every make, `value` is
//    left null and the caution goes in `notes` telling the tech to read the chamber tag.
//    An honest "verify on the tag" is worth more to a roadside tech than a confident
//    number that is wrong for the chamber in front of him.

export const AIR_BRAKE_ROWS: TrailerReferenceRow[] = [
  // ---------------------------------------------------------------------------
  // Air Brakes — pneumatic flow
  // ---------------------------------------------------------------------------
  {
    system:      'Air Brakes',
    component:   'Charging Sequence (Red Supply Line)',
    description:
      'How air gets INTO the trailer and how the parking brakes release. The red ' +
      '(emergency/supply) gladhand is the only line that fills the trailer reservoir.',
    value:       '120-135',
    units:       'PSI',
    notes:
      'CHARGING SEQUENCE, in order:\n' +
      '1. Tractor compressor builds system pressure until the governor cuts out, ' +
      'typically 120-135 PSI. Governor cut-in is roughly 85-100 PSI.\n' +
      '2. Driver pushes in the red octagonal TRAILER AIR SUPPLY knob on the dash. That ' +
      'opens the tractor protection valve and charges the supply line.\n' +
      '3. Air leaves the RED gladhand and travels the supply/emergency line to the ' +
      'trailer.\n' +
      '4. Supply air reaches the trailer spring brake control valve (pressure ' +
      'protection valve) at the front of the trailer.\n' +
      '5. It passes through a one-way check valve into the trailer air reservoir and ' +
      'fills it to system pressure, 120-135 PSI. The check valve is what keeps the ' +
      'reservoir charged if the supply line is later broken or disconnected.\n' +
      '6. Once supply pressure rises past roughly 45 PSI the spring brake valve routes ' +
      'air to the PARKING side of the 30/30 chambers. That compresses the power springs ' +
      'and RELEASES the parking brakes. This is why a trailer will not roll until the ' +
      'system is nearly fully charged.\n' +
      '7. Reservoir air is now staged at the SUPPLY port of the relay valve, waiting. ' +
      'No air has reached the service side of the brake chambers yet — nothing applies ' +
      'the service brakes during charging.\n\n' +
      'DIAGNOSIS: trailer will not release = no supply air past step 5 or 6. Check the ' +
      'red gladhand seal, a kinked/frozen supply line, and the spring brake valve. If ' +
      'the reservoir will not hold pressure with the tractor disconnected, the one-way ' +
      'check valve is leaking back.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Brake Application Sequence (Blue Service Line)',
    description:
      'How the trailer brakes actually apply. The blue (service/control) gladhand ' +
      'carries a PILOT SIGNAL only — it does not carry the air that stops the trailer.',
    value:       null,
    units:       null,
    notes:
      'BRAKE APPLICATION SEQUENCE, in order:\n' +
      '1. Driver applies the treadle (foot) valve, or the trailer hand valve.\n' +
      '2. The tractor sends control pressure out the BLUE gladhand down the service ' +
      'line. This is a low-volume PILOT signal that tells the trailer HOW HARD to ' +
      'brake. It is not the delivery air and it never reaches a brake chamber.\n' +
      '3. Pilot pressure arrives at the SERVICE port of the trailer relay valve. At ' +
      'crack pressure — commonly about 4 PSI — the relay valve piston moves.\n' +
      '4. The relay valve closes its exhaust and opens its inlet, admitting HIGH-VOLUME ' +
      'air from the trailer RESERVOIR (a short, large-bore path only a few feet long) ' +
      'into the service side of the brake chambers, at a delivery pressure that tracks ' +
      'the pilot signal roughly 1:1.\n' +
      '5. Chamber pushrod extends and rotates the slack adjuster, which turns the ' +
      'camshaft, which rolls the S-cam over and forces the shoes out into the drum.\n' +
      '6. RELEASE: the pilot signal drops, the relay valve rebalances, its exhaust port ' +
      'opens and dumps the chamber air locally at the valve rather than back up the ' +
      '40+ feet of service line to the tractor.\n\n' +
      'This is the whole reason the relay valve exists. See the "Relay Valve" entry — ' +
      'because the delivery air comes from the trailer reservoir and exhausts at the ' +
      'trailer, relay valve response, not line length, governs trailer brake timing.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Relay Valve',
    description:
      'Remote-controlled inlet/exhaust valve that amplifies the small blue-line pilot ' +
      'signal into full-volume reservoir air at the brake chambers. Governs trailer ' +
      'brake apply and release timing.',
    value:       '4',
    units:       'PSI',
    notes:
      'Value shown is the common crack pressure — the pilot pressure at which the valve ' +
      'begins to deliver. Relay valves are also produced in 7.5 and 15 PSI crack ' +
      'pressures specifically to tune tractor-trailer brake balance; verify the crack ' +
      'pressure stamped on the valve before substituting one.\n\n' +
      'WHY TIMING DEPENDS ON THIS VALVE: without it, apply air would have to travel the ' +
      'full service line from the tractor and exhaust back up the same line. With it, ' +
      'the pilot signal travels that distance but the delivery air moves only a few feet ' +
      'from the trailer reservoir, and exhausts at the valve. FMVSS 121 requires trailer ' +
      'brakes to reach 60 PSI within 0.45 seconds of the application. A sticking, ' +
      'contaminated, or wrong-crack-pressure relay valve is the number one cause of ' +
      'trailer brake lag, brakes that drag on release, and tractor/trailer out-of-sync ' +
      'braking that shows up as trailer tire flat-spotting or tractor brake wear.\n\n' +
      'DIAGNOSIS: slow release almost always means a plugged or restricted relay valve ' +
      'exhaust port — pull the exhaust cover and check for ice, oil sludge, or a wasp ' +
      'nest. Brakes applying late means a restricted service port or a high crack ' +
      'pressure valve. If chambers apply but weakly, check reservoir pressure at the ' +
      'valve supply port, not at the gladhand.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Spring Brake Automatic Application',
    description:
      'The pressure band at which the trailer parking/emergency brakes apply themselves ' +
      'when supply pressure is lost.',
    value:       '20-45',
    units:       'PSI',
    notes:
      'As supply (red line) pressure falls, the spring brake control valve exhausts the ' +
      'parking side of the 30/30 chambers. The mechanical power springs then apply the ' +
      'brakes with no air required. FMVSS 121 requires this to happen automatically ' +
      'somewhere in the 20-45 PSI band.\n\n' +
      'This is why a broken supply line, a blown gladhand seal, or a trailer that comes ' +
      'uncoupled stops itself. It is also why you cannot move a trailer with a dead air ' +
      'system without caging the springs.\n\n' +
      'CAUTION: the spring brakes are a one-shot emergency device, not a service brake. ' +
      'Repeatedly pumping the brakes after a supply failure bleeds the reservoir and can ' +
      'leave the trailer with neither service nor spring pressure available.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Gladhand Identification (Red vs Blue)',
    description:
      'Red = emergency/supply, feeds the reservoir and holds the spring brakes off. ' +
      'Blue = service/control, carries the pilot signal to the relay valve.',
    value:       null,
    units:       null,
    notes:
      'RED (emergency/supply): larger flow duty, constantly pressurized while coupled. ' +
      'Loses pressure -> spring brakes apply.\n' +
      'BLUE (service/control): pressurized only during a brake application. Carries ' +
      'signal, not delivery volume.\n\n' +
      'CROSSED GLADHANDS is the classic failure and it is dangerous: the trailer ' +
      'reservoir never charges, the spring brakes never release, and the driver may drag ' +
      'the trailer brakes or find he has no trailer brakes at all when he needs them. ' +
      'Some trailers use offset or keyed couplers to prevent it. Always confirm the ' +
      'trailer reservoir charges to full system pressure after coupling.\n\n' +
      'Gladhand seals (polyurethane or rubber) are a consumable — a hissing coupling is ' +
      'a seal, not a line, the vast majority of the time. Carry spares.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Trailer Air Reservoir',
    description:
      'The trailer\'s own air tank. Every pound of air that applies a trailer brake ' +
      'comes out of here, not out of the tractor.',
    value:       '120-135',
    units:       'PSI',
    notes:
      'Charged through the red supply line via a one-way check valve, so it stays ' +
      'charged when the supply line is broken — that stored air is what the spring ' +
      'brake valve and relay valve work from during an emergency.\n\n' +
      'Drain the tank daily. Water and compressor oil collect at the bottom and are the ' +
      'root cause of most relay valve and ABS modulator failures; in winter the same ' +
      'water freezes lines and valves shut. If a drained tank produces a lot of black ' +
      'oily sludge, the tractor air dryer desiccant is done and the trailer valves are ' +
      'being contaminated downstream of it.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Pressure Protection / Spring Brake Control Valve',
    description:
      'Front-of-trailer valve that fills the reservoir, releases the spring brakes above ' +
      'roughly 45 PSI, and applies them automatically on supply loss.',
    value:       '45',
    units:       'PSI',
    notes:
      'Value is the approximate release threshold — the supply pressure above which the ' +
      'valve routes air to the parking side and holds the power springs caged. ' +
      'Application on the way back down happens in the 20-45 PSI band.\n\n' +
      'Many trailers combine this function with an anti-compounding feature that ' +
      'prevents the service brake and the spring brake applying to the same foundation ' +
      'brake at once. Compounding can nearly double the force through the slack ' +
      'adjuster, camshaft, and s-cam and will break parts.\n\n' +
      'DIAGNOSIS: spring brakes that will not release with full supply pressure at the ' +
      'gladhand, or that release only partly, point here before they point at the ' +
      'chambers.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Spring Brake Manual Release (Caging)',
    description:
      'Mechanically compressing the power spring with the caging bolt so a dead trailer ' +
      'can be moved. Safety-critical procedure.',
    value:       null,
    units:       null,
    notes:
      'DANGER: a 30/30 power spring stores enough energy to kill. NEVER cut, grind, or ' +
      'remove the clamp band on the spring (parking) side of a chamber, and never torch ' +
      'a chamber for scrap. Non-serviceable chambers are replaced, not opened.\n\n' +
      'PROCEDURE:\n' +
      '1. Chock the wheels first. Caging a spring removes the only brake holding the ' +
      'trailer.\n' +
      '2. Pull the caging bolt (release tool) from its holder on the chamber.\n' +
      '3. Remove the dust plug from the center of the spring chamber, insert the bolt, ' +
      'and rotate it 1/4 turn to seat the crossbar in the pressure plate.\n' +
      '4. Draw the nut up evenly to compress the spring until the pushrod fully ' +
      'retracts. Caging bolt torque is typically capped around 50 ft-lb — check the ' +
      'chamber tag, and stop when the spring is caged rather than chasing a number.\n' +
      '5. Confirm the pushrod is fully retracted and the brake is released before ' +
      'moving.\n\n' +
      'If a caging bolt cannot draw the spring, the spring is likely broken. Replace the ' +
      'chamber — do not attempt to free it.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Air Brakes',
    component:   'Air Leakage Test Limits',
    description:
      'Maximum allowable air loss rates for a coupled tractor-trailer combination, ' +
      'engine off, and for a single vehicle.',
    value:       '3-4',
    units:       'PSI/min',
    notes:
      'COMBINATION VEHICLE (tractor + trailer):\n' +
      '  Static, brakes released: 3 PSI/min max.\n' +
      '  Applied, brakes held down: 4 PSI/min max.\n' +
      'SINGLE VEHICLE:\n' +
      '  Static: 2 PSI/min max.\n' +
      '  Applied: 3 PSI/min max.\n\n' +
      'PROCEDURE: charge the system to governor cut-out, shut the engine off, release ' +
      'the brakes and time one minute of static loss. Then make and hold a full ' +
      'application and time one minute of applied loss.\n\n' +
      'A leak that appears only on the APPLIED test is downstream of the relay valve ' +
      'inlet — chamber diaphragms, delivery hoses, or the relay valve itself. A leak on ' +
      'the STATIC test is in the supply side, the reservoir, or the spring brake ' +
      'circuit. Splitting the test this way narrows a roadside air leak faster than soap ' +
      'and a flashlight.',
    manufacturer: 'Trailer',
  },

  // ---------------------------------------------------------------------------
  // Brake Chambers — sizes
  //
  // The "Type" number IS the nominal effective diaphragm area in square inches. Output
  // force at the pushrod is approximately area x applied pressure, so a Type 30 at
  // 90 PSI produces roughly 2,700 lbf. That relationship is the whole reason the type
  // number matters: mixing chamber sizes across an axle unbalances the brakes.
  // ---------------------------------------------------------------------------
  {
    system:      'Brake Chambers',
    component:   'Type 9 Brake Chamber',
    description:
      'Smallest common chamber. Light-duty and specialty axles, some steer and trailer ' +
      'applications on light equipment. Rare on over-the-road van trailers.',
    value:       '9',
    units:       'sq in',
    notes:
      'Approximately 810 lbf of pushrod output at 90 PSI.\n\n' +
      'STROKE: no maximum stroke figure is published in this reference for the Type 9, ' +
      'deliberately. It is uncommon enough on trailers that this module will not assert ' +
      'a limit it cannot stand behind for every make — read the readjustment limit off ' +
      'the chamber tag or the manufacturer\'s stroke chart before calling one out of ' +
      'adjustment.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 12 Brake Chamber',
    description:
      'Light service chamber. Common on trailer axles with light load ratings and on ' +
      'some steer axles.',
    value:       '12',
    units:       'sq in',
    notes:
      'Approximately 1,080 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '5-11/16 in, which is the field way to tell a 12 from a 16 without a tag.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 16 Brake Chamber',
    description:
      'Mid-size service chamber. Common on steer axles and on lighter trailer axles.',
    value:       '16',
    units:       'sq in',
    notes:
      'Approximately 1,440 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '6-3/8 in. Available in both standard and long stroke — the stroke limits differ, ' +
      'so identify which before measuring.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 20 Brake Chamber',
    description:
      'Common steer axle and light trailer axle chamber.',
    value:       '20',
    units:       'sq in',
    notes:
      'Approximately 1,800 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '6-25/32 in. Available in both standard and long stroke.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 24 Brake Chamber',
    description:
      'Very common drive and trailer axle service chamber, and the service half of the ' +
      'widespread 24/24 combination spring brake.',
    value:       '24',
    units:       'sq in',
    notes:
      'Approximately 2,160 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '7-7/32 in. Available in standard stroke, long stroke, and an extended "24L" ' +
      '3-inch-stroke variant — three different readjustment limits on the same type ' +
      'number, so the tag matters here more than on any other chamber.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 30 Brake Chamber',
    description:
      'The standard heavy trailer chamber. Service half of the Type 30/30 combination ' +
      'spring brake found on the large majority of trailer tandems.',
    value:       '30',
    units:       'sq in',
    notes:
      'Approximately 2,700 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '8-3/32 in.\n\n' +
      'If you are working on a dry van, reefer, or flatbed tandem and have not been told ' +
      'otherwise, assume Type 30 long stroke and then verify. See "Type 30/30 ' +
      'Combination Spring Brake".',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 36 Brake Chamber',
    description:
      'Largest common chamber. Heavy-haul, lowboy, and high-GVW trailer axles needing ' +
      'more output than a Type 30 delivers.',
    value:       '36',
    units:       'sq in',
    notes:
      'Approximately 3,240 lbf of pushrod output at 90 PSI. Outside diameter about ' +
      '9 in.\n\n' +
      'Do not substitute a 36 for a 30 (or the reverse) on one side of an axle. ' +
      'Mismatched chamber sizes across an axle produce unequal braking force, which ' +
      'shows up as a pull under braking and uneven lining wear, and is a violation on ' +
      'its own.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Type 30/30 Combination Spring Brake',
    description:
      'A Type 30 service chamber and a Type 30 spring parking chamber in one housing. ' +
      'THE most common chamber on trailer tandems — assume this unless proven otherwise.',
    value:       '30',
    units:       'sq in',
    notes:
      'The forward (service) half is fed by the relay valve and does the stopping. The ' +
      'rear (spring) half holds a caged power spring that applies the parking and ' +
      'emergency brake when air is removed from it. Both halves act on the same pushrod.\n\n' +
      'The power spring delivers roughly the same order of force as a full service ' +
      'application, but exact spring force varies by manufacturer and this module does ' +
      'not publish a figure for it — spec it off the make and part number if you need it.\n\n' +
      'ANTI-COMPOUNDING: never apply the service brake while the spring brake is ' +
      'applied. The two forces add through one pushrod and can overload the slack ' +
      'adjuster, camshaft, and s-cam. Trailer valving normally prevents this, but a ' +
      'bypassed or failed valve will not.\n\n' +
      'DANGER: the spring half is non-serviceable. Never open the clamp band. Cage the ' +
      'spring before removal — see "Spring Brake Manual Release (Caging)".',
    manufacturer: 'Trailer',
  },

  // ---------------------------------------------------------------------------
  // Brake Chambers — maximum pushrod stroke (readjustment limits)
  //
  // Measured with the system at 90-100 PSI. These are the FMVSS 121 / CVSA limits: at
  // or beyond the limit the brake is out of adjustment and, in enough numbers on one
  // vehicle, is an out-of-service condition.
  //
  // Standard stroke and long stroke are listed as SEPARATE rows on purpose. Applying a
  // long-stroke limit to a standard-stroke chamber passes a brake that is legally out
  // of adjustment, which is the single most common way this table gets misused.
  // ---------------------------------------------------------------------------
  {
    system:      'Brake Chambers',
    component:   'Stroke Measurement Procedure',
    description:
      'How to measure pushrod stroke correctly. A wrong measurement technique produces ' +
      'a wrong adjustment call no matter how good the limit table is.',
    value:       '90-100',
    units:       'PSI',
    notes:
      'PROCEDURE:\n' +
      '1. Park on level ground and chock the wheels. Release the parking brakes.\n' +
      '2. Build the system to at least 90 PSI, then shut the engine off. Reservoir ' +
      'pressure must stay in the 90-100 PSI band through the measurement — a low ' +
      'reading understates the stroke and hides an out-of-adjustment brake.\n' +
      '3. With the brakes RELEASED, mark the pushrod flush at the chamber face, or ' +
      'measure from the chamber face to the center of the clevis pin.\n' +
      '4. Make and hold a FULL brake application.\n' +
      '5. Measure again at the same reference. The difference is the applied stroke.\n' +
      '6. Compare to the readjustment limit for that chamber TYPE and STROKE CLASS ' +
      '(standard vs long). At or beyond the limit, the brake is out of adjustment.\n\n' +
      'Notes: measure every chamber, not a sample — brakes go out of adjustment one at ' +
      'a time. Stroke at or near the limit on an automatic slack adjuster is a slack ' +
      'adjuster or foundation brake fault, not something to be manually adjusted away; ' +
      'manually backing off an ASA hides the real problem and it will return.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 12, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 12 chamber, measured at ' +
      '90-100 PSI.',
    value:       '1.375',
    units:       'inches',
    notes: 'Commonly written as 1-3/8 in. Standard stroke clamp type only.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 16, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 16 chamber, measured at ' +
      '90-100 PSI.',
    value:       '1.75',
    units:       'inches',
    notes:
      'Commonly written as 1-3/4 in. Standard stroke clamp type only — the long stroke ' +
      'Type 16 limit is 2 in.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 20, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 20 chamber, measured at ' +
      '90-100 PSI.',
    value:       '1.75',
    units:       'inches',
    notes:
      'Commonly written as 1-3/4 in. Standard stroke clamp type only — the long stroke ' +
      'Type 20 limit is 2 in.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 24, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 24 chamber, measured at ' +
      '90-100 PSI.',
    value:       '1.75',
    units:       'inches',
    notes:
      'Commonly written as 1-3/4 in. Standard stroke clamp type only — the long stroke ' +
      'Type 24 limit is 2 in. A separate extended-stroke "24L" 3-inch chamber also ' +
      'exists with a different limit again; identify it by its tag rather than assuming.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 30, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 30 chamber, measured at ' +
      '90-100 PSI.',
    value:       '2.0',
    units:       'inches',
    notes:
      'This is the STANDARD stroke figure. Most modern trailer tandems use the LONG ' +
      'stroke Type 30 instead, whose limit is 2.5 in. Confirm which chamber you have ' +
      'before judging adjustment — using 2.5 in on a standard-stroke chamber passes a ' +
      'brake that is half an inch out of adjustment.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 36, Standard Stroke Clamp',
    description:
      'Readjustment limit for a standard-stroke clamp-type Type 36 chamber, measured at ' +
      '90-100 PSI.',
    value:       '2.25',
    units:       'inches',
    notes: 'Commonly written as 2-1/4 in. Standard stroke clamp type only.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 16, Long Stroke Clamp',
    description:
      'Readjustment limit for a LONG stroke clamp-type Type 16 chamber, measured at ' +
      '90-100 PSI.',
    value:       '2.0',
    units:       'inches',
    notes: 'Long stroke only. The standard stroke Type 16 limit is 1-3/4 in.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 20, Long Stroke Clamp',
    description:
      'Readjustment limit for a LONG stroke clamp-type Type 20 chamber, measured at ' +
      '90-100 PSI.',
    value:       '2.0',
    units:       'inches',
    notes: 'Long stroke only. The standard stroke Type 20 limit is 1-3/4 in.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 24, Long Stroke Clamp',
    description:
      'Readjustment limit for a LONG stroke clamp-type Type 24 chamber, measured at ' +
      '90-100 PSI.',
    value:       '2.0',
    units:       'inches',
    notes:
      'Long stroke only. The standard stroke Type 24 limit is 1-3/4 in. The extended ' +
      '"24L" 3-inch-stroke chamber is a different part with a different limit — do not ' +
      'apply this figure to it.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Max Stroke — Type 30, Long Stroke Clamp',
    description:
      'Readjustment limit for a LONG stroke clamp-type Type 30 chamber at 90-100 PSI. ' +
      'The figure that applies to most trailer tandems on the road.',
    value:       '2.5',
    units:       'inches',
    notes:
      'Long stroke only. The standard stroke Type 30 limit is 2 in.\n\n' +
      'This is the number a trailer tech reaches for most often, because the long stroke ' +
      'Type 30/30 is the dominant trailer tandem chamber. Still verify the chamber is ' +
      'long stroke — see "Long Stroke Chamber Identification". Do not apply this to a ' +
      'standard-stroke chamber.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Long Stroke Chamber Identification',
    description:
      'How to tell a long stroke chamber from a standard stroke chamber of the same ' +
      'type number before you judge its adjustment.',
    value:       null,
    units:       null,
    notes:
      'IDENTIFIERS, in order of reliability:\n' +
      '1. The stamped/embossed marking on the chamber body or the tag, which on ' +
      'long-stroke chambers states the maximum stroke directly. Trust this over ' +
      'everything else.\n' +
      '2. A SQUARE air inlet port boss on the service chamber. Standard stroke chambers ' +
      'use a round or hex boss. This is the fast visual check under a trailer.\n' +
      '3. Trapezoidal or square identification marks on the chamber body, and "LS" or ' +
      'similar in the part number.\n\n' +
      'Long stroke chambers exist to give more usable stroke before the brake runs out ' +
      'of travel, which improves the margin on a brake that is drifting out of ' +
      'adjustment. They do NOT produce more force — a long stroke Type 30 is still 30 ' +
      'square inches.\n\n' +
      'If you cannot positively identify the chamber, use the more conservative ' +
      '(shorter) standard-stroke limit. Calling a good brake for adjustment is a ' +
      'nuisance; passing an out-of-adjustment brake is a crash.',
    manufacturer: 'Trailer',
  },
  {
    system:      'Brake Chambers',
    component:   'Clamp-Type vs Rotochamber',
    description:
      'The two chamber constructions found on trailers. They look different, mount ' +
      'differently, and use entirely different stroke limit tables.',
    value:       null,
    units:       null,
    notes:
      'CLAMP TYPE (by far the most common):\n' +
      '  Two stamped steel shells with a flat rubber DIAPHRAGM pinched between them, ' +
      'held by a bolted clamp band around the seam.\n' +
      '  Squat, wide, visible band around the middle.\n' +
      '  Diaphragm is serviceable on the service half; the spring half is not.\n' +
      '  Force is area x pressure, and stroke is limited by how far the diaphragm can ' +
      'roll before it starts to stretch — which is why stroke limits are short and why ' +
      'output tails off badly near the end of stroke.\n\n' +
      'ROTOCHAMBER:\n' +
      '  Uses a rolling convoluted DIAPHRAGM inside a deeper, narrower cylindrical can ' +
      'rather than a flat clamped diaphragm.\n' +
      '  Noticeably longer and smaller in diameter than a clamp chamber of the same ' +
      'type number — a Type 30 rotochamber is about 7-1/16 in across versus about ' +
      '8-3/32 in for the clamp type.\n' +
      '  Delivers more nearly CONSTANT output force across its full stroke, because the ' +
      'rolling diaphragm keeps effective area steady instead of losing it as it ' +
      'stretches. That is the reason to use one.\n' +
      '  Longer available stroke, and a DIFFERENT readjustment limit table.\n' +
      '  Older and less common on modern van/reefer trailers; still found on some ' +
      'heavy-haul, vocational, and legacy equipment.\n\n' +
      'CRITICAL: rotochamber stroke limits are NOT the clamp-type limits and this ' +
      'module does not publish them, because getting them wrong in either direction is ' +
      'unsafe. If you are measuring a rotochamber, read the limit off the chamber tag or ' +
      'the manufacturer stroke chart for rotochambers specifically. Identify it first by ' +
      'the absence of a clamp band and the taller, narrower can.',
    manufacturer: 'Trailer',
  },
]
