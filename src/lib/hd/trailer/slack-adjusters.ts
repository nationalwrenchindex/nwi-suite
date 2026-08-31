// NWI HD Suite — Trailer Systems Reference: Slack Adjusters, Brake Shoes & Drums
//
// Foundation brake adjustment and friction-material limits for air-braked trailers.
// Loaded with the other trailer modules by /api/hd/trailer-reference/seed.
//
// ACCURACY POLICY FOR THIS MODULE
// A tech measures and condemns parts against these rows. Where a figure is not
// certain across the whole trailer population it is deliberately LEFT OUT and the
// row instead tells the tech where the authoritative number lives — the casting on
// the drum, the FMSI number stamped on the shoe, the OEM service manual, or the
// current CVSA out-of-service criteria. A missing spec costs a lookup. A wrong spec
// costs a brake.

import type { TrailerReferenceRow } from './types'

export const SLACK_ADJUSTER_ROWS: TrailerReferenceRow[] = [

  // ─── Automatic Slack Adjusters — Specs ────────────────────────────────────────

  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — Clevis Freeplay',
    description:
      'Free play measured at the clevis, with the brakes released. Pry the slack adjuster arm away from the ' +
      'chamber by hand and measure the movement before the pushrod starts to load.',
    value: '0.500-0.625',
    units: 'inches',
    notes:
      'Spec is 1/2 in to 5/8 in (0.500-0.625 in) of freeplay at the clevis. Measure at the clevis pin, not at ' +
      'the far end of the arm — measuring further out on the arm multiplies the reading and makes a correctly ' +
      'adjusted brake look loose. Less than spec: the brake may drag and overheat. More than spec: the adjuster ' +
      'is not taking up wear, which is a slipping-adjuster investigation, NOT a reason to keep manually ' +
      'adjusting it. Applied pushrod stroke is a separate measurement with its own per-chamber limits — see the ' +
      'Brake Chambers section and the current CVSA out-of-service criteria for those figures.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — Arm Angle at Full Apply',
    description:
      'Geometry check: with the brakes fully applied, the brake chamber pushrod and the slack adjuster arm ' +
      'should form a right angle.',
    value: '90',
    units: 'degrees',
    notes:
      'At rest the angle sits slightly greater than 90 degrees so that it passes through 90 degrees during ' +
      'application, which is where the adjuster develops maximum mechanical advantage. An angle noticeably off ' +
      '90 at full apply means the wrong arm length, the wrong clevis, the wrong mounting hole in the arm, or a ' +
      'chamber mounted in the wrong position — it costs braking torque even though nothing looks broken. ' +
      'Correct the geometry rather than compensating with adjustment.',
    manufacturer: 'Trailer',
  },

  // ─── Automatic Slack Adjusters — Operation & Cautions ─────────────────────────

  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — NEVER Adjust Hot',
    description:
      'Do not adjust an automatic slack adjuster while the brakes are hot. Let the wheel end cool to ambient ' +
      'before touching it.',
    value: null,
    units: null,
    notes:
      'A hot drum has thermally expanded and its inside diameter is larger than it will be cold. An adjustment ' +
      'set against that expanded drum feels correct at the time, but as the drum cools it shrinks back onto the ' +
      'shoes — leaving the brake dragging, which builds more heat, which drags harder. Adjusted the other ' +
      'direction the result is simply badly out of adjustment once cold. Either way you have created the ' +
      'problem you were called out to fix. Cool first, then adjust.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — Pawl & Ratchet Operation',
    description:
      'How the self-adjusting action works: a one-way pawl-and-ratchet (clutch) mechanism inside the adjuster ' +
      'converts excess pushrod travel into permanent take-up of lining wear.',
    value: null,
    units: null,
    notes:
      'The adjuster body rotates on the camshaft splines when the chamber applies. A control arm (or actuator ' +
      'link) anchored to a fixed reference on the axle or chamber bracket stays put while the adjuster body ' +
      'swings past it. Any swing BEYOND the designed free-stroke window drives an internal pawl across the ' +
      'ratchet teeth; on release, the pawl holds that new position and indexes the worm gear a small amount, ' +
      'rotating the camshaft slightly further and taking up the wear. Travel within the normal window produces ' +
      'no indexing, which is why a correctly adjusted brake stops adjusting itself. Two consequences on the ' +
      'truck: (1) the anchor reference must be solid — a loose, bent or missing control arm anchor means the ' +
      'adjuster has nothing to measure against and will never adjust; (2) the mechanism only takes up wear ' +
      'during actual brake applications, so after a shoe job the adjuster needs several full applications to ' +
      'walk itself in.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — Repeated Manual Adjustment Is a Red Flag',
    description:
      'An automatic slack adjuster is not supposed to need manual adjustment in service. Manually adjusting one ' +
      'to bring stroke back into spec masks a defect instead of fixing it.',
    value: null,
    units: null,
    notes:
      'The manual adjusting hex on an automatic slack adjuster exists for two jobs: setting initial adjustment ' +
      'at installation, and backing the shoes off for a reline or drum removal. It is NOT a service adjustment. ' +
      'If a unit is out of stroke, manually adjusting it will bring it back for a short time and then it goes ' +
      'out again — during which the vehicle is running on a brake nobody diagnosed. Enforcement takes the same ' +
      'view: an automatic adjuster found out of adjustment is treated as a defect, not as a missed adjustment. ' +
      'Adjust it once to make the unit safe to move, then diagnose it.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Automatic Slack Adjuster — Brand Coverage (Bendix, Haldex, Gunite)',
    description:
      'Bendix, Haldex and Gunite are the three brands you will meet on North American trailers. All three are ' +
      'pawl-and-ratchet self-adjusting units and all three hold the same in-service freeplay target.',
    value: null,
    units: null,
    notes:
      'Shared across brands: pawl-and-ratchet take-up, a control arm anchored to a fixed reference, a manual ' +
      'adjusting hex intended only for installation and reline, and the same never-adjust-hot rule. What ' +
      'DIFFERS by brand is the installation and initial-setup routine — how the control arm is anchored and ' +
      'clocked, which anchor bracket and link are correct for the axle, and how many degrees the adjusting nut ' +
      'is turned to set initial adjustment. Follow the installation sheet in the box for the brand and part ' +
      'number in your hand; do not carry a Haldex setup routine onto a Bendix unit or the reverse. This module ' +
      'deliberately does not publish per-brand installation angles or hex sizes — they belong to the specific ' +
      'part number, not to the brand as a whole.',
    manufacturer: 'Bendix / Haldex / Gunite',
  },

  // ─── Slipping Automatic Slack Adjuster — Diagnosis ────────────────────────────

  {
    system: 'Slack Adjusters',
    component: 'Slipping Automatic Slack Adjuster — Symptoms',
    description:
      'Recognizing an adjuster that will not hold adjustment, as opposed to one that is simply out of ' +
      'adjustment.',
    value: null,
    units: null,
    notes:
      'Symptom pattern: (1) freeplay and pushrod stroke come back into spec when adjusted, then drift back out ' +
      'within days or a single trip; (2) the same wheel end is out of adjustment at every inspection while the ' +
      'others hold; (3) the manual adjusting nut turns with little or no ratcheting resistance, or turns and ' +
      'then gives back — the internal clutch is slipping; (4) the adjuster body swings on the camshaft without ' +
      'the arm following it; (5) brake pull, brake fade, or one cold drum in a set after a run, because that ' +
      'wheel end is contributing little braking torque; (6) uneven lining wear side to side on the same axle. ' +
      'A single out-of-adjustment finding is not a slipping adjuster. Two in a row on the same wheel end is.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Slipping Automatic Slack Adjuster — What to Check Before Condemning',
    description:
      'The adjuster is often innocent. Work the surrounding hardware before buying a new unit.',
    value: null,
    units: null,
    notes:
      'Check in this order: (1) CONTROL ARM AND ANCHOR — loose, bent, broken, missing, or anchored to the wrong ' +
      'point; with no valid reference the adjuster cannot sense excess travel. (2) CAMSHAFT AND CAM BUSHINGS — ' +
      'dry, worn or seized bushings, or a corroded camshaft binding in its tube; a cam that will not rotate ' +
      'freely defeats the adjuster and mimics slipping. (3) SPLINES — worn or rolled-over camshaft splines, or ' +
      'a worn adjuster spline bore, let the adjuster move without moving the cam. (4) CLEVIS AND PINS — ' +
      'elongated pin holes and worn pins add lost motion that reads at the clevis as freeplay. (5) CHAMBER AND ' +
      'PUSHROD — a pushrod out of alignment with the arm, or a chamber with a failed diaphragm, produces short ' +
      'or erratic stroke. (6) FOUNDATION BRAKE — worn-out linings, a cracked or badly oversize drum, worn cam ' +
      'head and rollers, or collapsed shoe return springs all give travel the adjuster cannot make up. Fix any ' +
      'of these before you condemn the adjuster; replacing the adjuster on a seized camshaft just wastes a part.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Slipping Automatic Slack Adjuster — Replace, Do Not Re-Adjust',
    description:
      'If the surrounding hardware checks out and the adjuster still will not hold adjustment, the adjuster is ' +
      'a replacement. It is not a repeat adjustment and it is not a rebuild.',
    value: null,
    units: null,
    notes:
      'The pawl, ratchet and internal clutch are not serviceable in the field. Once the clutch slips it will ' +
      'keep slipping, and every manual adjustment written on the ticket is a temporary cover over a brake that ' +
      'goes out of adjustment again on the road. Replace the unit. Replace in axle pairs where shop or fleet ' +
      'policy calls for it so both ends of the axle behave the same. After installation, set initial adjustment ' +
      'per the manufacturer sheet, then make several full brake applications and re-measure freeplay at the ' +
      'clevis to confirm the new unit is taking up and holding.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Camshaft & Cam Bushing Wear',
    description:
      'Excess radial play in the camshaft, or a camshaft binding in worn or dry bushings, is a leading cause of ' +
      'brakes that will not stay adjusted.',
    value: null,
    units: null,
    notes:
      'Check by prying the camshaft radially at the head and by rotating it through its full travel by hand ' +
      'with the shoes backed off — it should turn freely with no binding or notchiness. Grease the cam ' +
      'bushings at every service interval; dry bushings are the usual root cause. Maximum allowable radial cam ' +
      'play is an OEM figure that varies with axle make and bushing type, so it is NOT published here — look it ' +
      'up in the axle manufacturer service manual for the axle you are under rather than working to a ' +
      'remembered number.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Clevis & Clevis Pin Wear',
    description:
      'Worn clevis pins and elongated clevis holes add lost motion that reads as freeplay and hides the real ' +
      'condition of the brake.',
    value: null,
    units: null,
    notes:
      'Inspect the pin for flat spots and the clevis holes for egg-shaping. Any measurable slop between pin and ' +
      'hole means both the pin and the clevis get replaced — a new pin in an elongated hole is still loose. Use ' +
      'the correct pins and retaining hardware; do not substitute a bolt for a clevis pin. Confirm the pushrod ' +
      'threads into the clevis to the full specified depth and that the jam nut is tight, otherwise the clevis ' +
      'can back off in service and the brake loses adjustment all at once.',
    manufacturer: 'Trailer',
  },

  // ─── Manual Slack Adjusters ───────────────────────────────────────────────────

  {
    system: 'Slack Adjusters',
    component: 'Manual Slack Adjuster — Adjustment Procedure',
    description:
      'Stepwise adjustment for a MANUAL slack adjuster. The initial back-off is 90 degrees. Do not run this ' +
      'procedure on an automatic slack adjuster.',
    value: '90',
    units: 'degrees',
    notes:
      'Wheel end cool to ambient before starting. STEP 1 — Chock the wheels and make sure the vehicle cannot ' +
      'roll. STEP 2 — Release the parking brakes so the spring brakes are not applying the foundation brake ' +
      '(cage the spring brakes if they cannot be released with air). STEP 3 — Depress and hold the locking ' +
      'sleeve/collar on the adjusting bolt so the worm shaft is free to turn. STEP 4 — Back the adjusting nut ' +
      'off 90 degrees (a quarter turn in the loosening direction). STEP 5 — Turn the adjusting nut in the ' +
      'tightening direction until the shoes just contact the drum and you feel the shoes drag — the wheel gets ' +
      'noticeably harder to rotate by hand. STEP 6 — Back the adjusting nut off 1/4 turn from that drag point. ' +
      'STEP 7 — Release the locking sleeve and confirm it has re-seated in the nut. STEP 8 — Spin the wheel: it ' +
      'must turn freely with no drag. STEP 9 — Make several full brake applications, then re-check freeplay and ' +
      'applied pushrod stroke, and repeat the same procedure on the opposite end of the axle so both sides ' +
      'match.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Manual Slack Adjuster — Final Back-Off From Drag',
    description:
      'The last step of the manual adjustment: after tightening until the shoes drag on the drum, back the ' +
      'adjusting nut off one quarter turn.',
    value: '1/4',
    units: 'turn',
    notes:
      'This 1/4 turn is what establishes running clearance between lining and drum. Backing off less leaves the ' +
      'brake dragging and cooking the lining; backing off more gives away pushrod stroke and braking response. ' +
      'Always verify by hand afterward — the wheel must spin free. See the Manual Slack Adjuster Adjustment ' +
      'Procedure entry for the full ordered sequence.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Manual Slack Adjuster — Locking Sleeve / Collar',
    description:
      'The spring-loaded locking sleeve (collar) over the adjusting bolt must be depressed to turn the nut, and ' +
      'must be confirmed re-seated afterward.',
    value: null,
    units: null,
    notes:
      'The sleeve locks the worm shaft so vibration cannot back the adjustment out in service. Forcing the ' +
      'adjusting nut without depressing the sleeve chews the locking teeth and the adjuster will no longer hold ' +
      'its setting. After adjusting, release the sleeve and check that it has popped back and engaged — an ' +
      'adjuster left with the sleeve unseated will drift out of adjustment on the road.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Manual Slack Adjuster — Safety Prep Before Adjusting',
    description:
      'Chock the wheels, release or cage the spring brakes, and confirm nobody can charge or apply the system ' +
      'while you are under the trailer.',
    value: null,
    units: null,
    notes:
      'Adjusting against an applied spring brake gives a false drag point and produces a brake that drags hard ' +
      'once the parking brake is released. Chocks go in first because the parking brake is coming off. If the ' +
      'spring brakes must be caged, cage them properly with the correct release tool and back the caging bolts ' +
      'out fully — never strike or cut open a spring brake chamber, the power spring is capable of killing you.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Slack Adjusters',
    component: 'Manual vs Automatic — What You Should Find on a Trailer',
    description:
      'Automatic slack adjusters are required equipment on new air-braked vehicles built since the mid-1990s ' +
      'under FMVSS 121. A manual slack adjuster on a modern trailer is usually a wrong-part repair.',
    value: null,
    units: null,
    notes:
      'Practical consequence: if you find a manual slack adjuster on a trailer that left the factory with ' +
      'automatics, someone substituted the wrong part — flag it and replace it with the correct automatic unit ' +
      'rather than adjusting it. Confirm the exact applicability date against the current rule text before ' +
      'making a formal compliance call; this entry is for identifying a wrong-part condition, not for citing a ' +
      'regulation. Identify which type you have before you touch the adjusting nut: adjusting an automatic as ' +
      'though it were manual is the most common way techs damage them.',
    manufacturer: 'Trailer',
  },

  // ─── Brake Shoes — Sizing ─────────────────────────────────────────────────────

  {
    system: 'Brake Shoes & Drums',
    component: 'Brake Shoe Sizing Convention',
    description:
      'Trailer brake shoes are called out by two dimensions: lining width and drum diameter. Confirm which ' +
      'number is which before ordering.',
    value: null,
    units: null,
    notes:
      'This module lists trailer shoe sizes as WIDTH x DIAMETER (for example 4 x 15 in = 4 in wide lining on a ' +
      '15 in drum). Be aware that catalogs, drums and many parts counters state the same brake the other way ' +
      'round, DIAMETER x WIDTH (16.5 x 7 in = 16.5 in drum, 7 in lining width). The two numbers are never ' +
      'ambiguous in practice because the diameter is always the larger of the pair — read them that way and you ' +
      'cannot get it backwards. Before ordering, verify against the FMSI number stamped on the shoe or lining ' +
      'block and against the diameter cast into the drum. Width and diameter must both match: a correct-' +
      'diameter shoe in the wrong width will bolt up and then run on partial lining contact.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Trailer Brake Shoe Size — 4 x 14.5 in',
    description: 'Common trailer brake shoe size: 4 in lining width on a 14.5 in drum diameter.',
    value: '4 x 14.5',
    units: 'inches',
    notes:
      'Width x diameter. Found on lighter and older trailer axles. Confirm the size against the diameter cast ' +
      'into the drum and the FMSI number on the shoe before ordering — 14.5 in and 15 in axles look ' +
      'interchangeable at a glance and are not.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Trailer Brake Shoe Size — 4 x 15 in',
    description: 'Common trailer brake shoe size: 4 in lining width on a 15 in drum diameter.',
    value: '4 x 15',
    units: 'inches',
    notes:
      'Width x diameter. Confirm against the drum casting and the FMSI number on the shoe. Do not mix a 4 x ' +
      '14.5 in and a 4 x 15 in set across an axle — the two ends will not brake alike.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Trailer Brake Shoe Size — 7 x 16.5 in',
    description:
      'The dominant size on current North American van and reefer trailers: 7 in lining width on a 16.5 in ' +
      'drum, usually written 16.5 x 7 on the drum and in catalogs.',
    value: '7 x 16.5',
    units: 'inches',
    notes:
      'Width x diameter, matching the 16.5 x 7 in standard trailer drum entry in this section. Wider linings ' +
      '(such as 8-5/8 in) also run on 16.5 in drums on heavier spec axles, so verify the lining WIDTH as well ' +
      'as the diameter — the wrong-width shoe on a correct-diameter drum is an easy and expensive mistake. ' +
      'Confirm with the FMSI number stamped on the shoe.',
    manufacturer: 'Trailer',
  },

  // ─── Brake Shoes — Lining Wear Limits (two different limits, do not confuse) ───

  {
    system: 'Brake Shoes & Drums',
    component: 'Lining Replacement Limit — RIVETED Linings',
    description:
      'RIVETED lining: replace when the lining remaining ABOVE THE RIVET HEADS is down to 1/4 in. Measured from ' +
      'the top of the rivet head to the friction surface, at the thinnest point.',
    value: '0.250',
    units: 'inches',
    notes:
      'This limit applies ONLY to riveted linings and the measurement reference is the rivet head, NOT the shoe ' +
      'table. Measure at the thinnest point on the block, which is usually a lining end rather than the middle. ' +
      'Riveted linings get their own limit because the rivet heads reach the drum before the shoe table does — ' +
      'run past this and you score the drum with rivet heads and destroy a drum that would otherwise have been ' +
      'serviceable. Do not apply the bonded-lining figure here; see the RIVETED vs BONDED entry.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Lining Replacement Limit — BONDED Linings',
    description:
      'BONDED lining: replace when 1/8 in of lining thickness remains. Measured from the shoe table to the ' +
      'friction surface, at the thinnest point.',
    value: '0.125',
    units: 'inches',
    notes:
      'This limit applies ONLY to bonded linings. There are no rivets, so the measurement reference is the shoe ' +
      'table itself and the usable thickness runs closer to the table than a riveted lining can. Measure at the ' +
      'thinnest point. Do not apply the riveted-lining figure here; see the RIVETED vs BONDED entry.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'RIVETED vs BONDED — Two Different Limits, Two Different Linings',
    description:
      'Identify the lining type FIRST, then apply the matching limit. Riveted: 1/4 in above the rivet heads. ' +
      'Bonded: 1/8 in remaining. These are not the same measurement and they are not interchangeable.',
    value: null,
    units: null,
    notes:
      'The two limits differ because the datum differs. On a RIVETED lining you measure from the top of the ' +
      'rivet head, because the rivet head is what will contact the drum, and the limit is 1/4 in (0.250 in). On ' +
      'a BONDED lining there is nothing between the friction material and the shoe table, so you measure total ' +
      'remaining thickness from the table and the limit is 1/8 in (0.125 in). Applying the bonded number to a ' +
      'riveted lining lets rivet heads reach the drum. Applying the riveted number to a bonded lining throws ' +
      'away usable lining. Look at the shoe: visible rivet heads through the friction surface means riveted; a ' +
      'continuous unbroken friction surface means bonded. NOTE: these are SHOP REPLACEMENT limits. The ' +
      'enforcement out-of-service thickness is a separate, thinner figure — check the current CVSA ' +
      'out-of-service criteria and 49 CFR 393.47 rather than assuming the two are the same number.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Lining Condition — Replace in Axle Sets',
    description:
      'Reline both ends of an axle together, with the same friction material and the same part number on both ' +
      'sides.',
    value: null,
    units: null,
    notes:
      'Mismatched friction material across an axle produces uneven braking torque, which shows up as pull, ' +
      'premature wear on the harder-working end, and unpredictable behavior in a hard stop. Also replace shoes ' +
      'outright — rather than just relining — where the shoe table is cracked, distorted, corroded, or the ' +
      'anchor pin and roller bores are worn. Replace shoe return springs, retaining hardware, anchor pins and ' +
      'cam rollers with the shoe job; a fatigued return spring is a dragging brake that no adjustment will fix. ' +
      'Any lining contaminated with oil or grease from a leaking wheel seal is replaced, not cleaned, and the ' +
      'seal is fixed at the same time.',
    manufacturer: 'Trailer',
  },

  // ─── Q-Plus vs Standard S-Cam ─────────────────────────────────────────────────

  {
    system: 'Brake Shoes & Drums',
    component: 'Q-Plus and Standard S-Cam Are NOT Interchangeable',
    description:
      'Bendix Q-Plus and standard S-cam foundation brakes use different cam head profiles and different, ' +
      'matched shoes. Components from one must never be mixed into the other, in either direction.',
    value: null,
    units: null,
    notes:
      'Q-Plus is an extended-service S-cam-family brake, but its camshaft head profile and its shoe geometry ' +
      'are matched to each other and differ from standard S-cam. WHAT GOES WRONG WHEN THEY ARE MIXED: the cam ' +
      'rollers no longer sit correctly on the cam head profile, so the geometry that converts cam rotation into ' +
      'shoe travel is wrong. The results are a brake that produces less torque than the driver and the rest of ' +
      'the combination expect, uneven and partial lining-to-drum contact with hot spots and rapid wear, ' +
      'inconsistent pushrod stroke that will not stay in adjustment, and — in the worst case — a roller that ' +
      'walks off or dislodges from the cam head, which drops that wheel end out of braking entirely and can jam ' +
      'the foundation brake. The trailer will roll out of the shop and the fault will only show up in a hard ' +
      'stop or a brake test. IDENTIFY BY PART NUMBER, NOT BY EYE — the two look similar enough to be swapped by ' +
      'accident. Match camshaft, shoes and hardware as a set from the same brake family, and never build one ' +
      'wheel end Q-Plus and the other standard on the same axle.',
    manufacturer: 'Bendix',
  },

  // ─── Drums ────────────────────────────────────────────────────────────────────

  {
    system: 'Brake Shoes & Drums',
    component: 'Standard Trailer Brake Drum — 16.5 x 7 in',
    description:
      'The standard current trailer brake drum: 16.5 in inside diameter by 7 in friction surface width, stated ' +
      'in the usual catalog order of diameter x width.',
    value: '16.5 x 7',
    units: 'inches',
    notes:
      'Pairs with the 7 x 16.5 in shoe entry in this section. Heavier spec axles use wider friction surfaces ' +
      '(8-5/8 in is common) on the same 16.5 in diameter, so confirm WIDTH as well as diameter. Also confirm ' +
      'bolt circle, pilot, and drum style (outboard vs inboard mounted) before ordering — diameter and width ' +
      'alone do not guarantee the drum bolts on.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Brake Drum — Maximum Out-of-Round',
    description:
      'Maximum allowable out-of-round for a trailer brake drum: 0.020 in. Beyond this the drum is machined or ' +
      'replaced.',
    value: '0.020',
    units: 'inches',
    notes:
      'Measure with a drum micrometer (gauge), not a tape or caliper. Take readings at several points around ' +
      'the circumference and at several depths across the friction surface — inner edge, middle and outer edge ' +
      '— because a drum can be round at one depth and bell-mouthed or barrel-shaped across the width. ' +
      'Out-of-round is the difference between the largest and smallest diameter readings. Symptoms in service: ' +
      'pedal or brake pulsation, cyclic grab, and audible cycling from that wheel end under light application. ' +
      'IMPORTANT: a drum can only be machined back to round if doing so stays inside the drum maximum diameter ' +
      'cast into it — see the drum maximum diameter entry.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Brake Drum — Maximum / Discard Diameter',
    description:
      'Every drum carries its own maximum diameter figure. Read it off the drum in front of you — this module ' +
      'does not publish one, because it varies by drum part number.',
    value: null,
    units: null,
    notes:
      'The maximum diameter (and where the manufacturer distinguishes them, the maximum REBORE diameter for ' +
      'machining versus the DISCARD diameter at which the drum comes off the trailer) is cast or stamped into ' +
      'the drum, typically on the outer face or the outer edge of the friction surface. That cast figure ' +
      'governs — it is specific to that drum and it overrides any remembered rule of thumb, including a number ' +
      'from a different drum on the same trailer. Two separate limits matter: you may not machine a drum to a ' +
      'diameter larger than its rebore limit, and you may not RUN a drum at or past its discard diameter even ' +
      'if it wore there on its own without ever being turned. If the casting is unreadable through corrosion, ' +
      'look the figure up by part number in the drum manufacturer catalog or the axle service manual — do not ' +
      'guess, and do not machine to whatever cleans it up. An oversize drum has thinner walls, less heat ' +
      'capacity, and gives away pushrod stroke on every application.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Brake Drum — Cracks vs Heat Checks',
    description:
      'Fine heat checking on the friction surface is normal wear. A crack is not — a cracked drum is replaced, ' +
      'not machined.',
    value: null,
    units: null,
    notes:
      'Heat checks are shallow hairline marks in the friction surface from normal thermal cycling and do not by ' +
      'themselves condemn a drum. A crack is a defined separation, will usually catch a fingernail or a pick, ' +
      'and any crack that extends through the friction surface to the outer edge of the drum, or that is ' +
      'visible on the outside of the drum, is an out-of-service condition — replace it. Also replace for heavy ' +
      'bluing, deep scoring or rivet-head grooving, a bell-mouthed or barrel-worn friction surface, and any ' +
      'chipped or missing material at the drum edge. Never weld a brake drum. If a drum is condemned, inspect ' +
      'the opposite end of the same axle and the linings at the same time, since whatever overheated the drum ' +
      'usually also cooked the lining.',
    manufacturer: 'Trailer',
  },
  {
    system: 'Brake Shoes & Drums',
    component: 'Brake Drums — Replace in Axle Sets',
    description:
      'Replace or machine drums as an axle pair so both ends of the axle have matched diameter and matched heat ' +
      'capacity.',
    value: null,
    units: null,
    notes:
      'A new drum on one end and a worn near-limit drum on the other gives the two ends different effective ' +
      'radii, different heat capacity and different fade behavior, which shows up as brake pull and as one end ' +
      'doing more than its share of the work. If drums are machined, machine both ends of the axle to the same ' +
      'diameter. Always reline against a serviceable drum: new shoes bedded into an out-of-round or oversize ' +
      'drum will not seat evenly and the wheel end will be back out of adjustment quickly.',
    manufacturer: 'Trailer',
  },
]
