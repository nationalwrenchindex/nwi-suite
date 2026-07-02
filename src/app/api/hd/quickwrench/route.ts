import { NextResponse, type NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
import { generateDiagnostic } from '@/lib/gemini/client'
import { formatDiagnostic } from '@/lib/gemini/formatter'
import { detectsHazard } from '@/lib/gemini/hazard'
import { sendNewCacheAlert } from '@/lib/email-alerts'
import { type TKSeverity, type TKAlarmEntry, TK_ALARM_CODES, TK_DSR_ALARM_CODES, TK_DISCLAIMER, CARRIER_ALARM_CODES, CARRIER_PRETRIP_CODES } from '@/lib/hd/alarm-codes'

// ─── Alarm → Parts Category Mapping ──────────────────────────────────────────

const TK_CODE_CATEGORIES: Record<string, string[]> = {
  '17': ['starter'],
  '20': ['starter', 'fuel_pump', 'solenoid', 'glow_plug'],
  '15': ['glow_plug'],
  '25': ['alternator', 'belt'],
  '51': ['alternator', 'belt'],
  '10': ['belt', 'compressor'],
  '46': ['belt', 'filter'],
  '48': ['belt'],
  '40': ['solenoid'],
  '31': ['solenoid'],
  '32': ['solenoid'],
  '35': ['solenoid'],
  '18': ['thermostat', 'water_pump'],
  '41': ['sensor'],
  '12': ['sensor'],
  '37': ['sensor'],
  '19': ['switch'],
  '11': ['filter'],
  '223': ['filter'],
  '224': ['filter'],
  '225': ['filter'],
  '226': ['filter'],
  '227': ['filter'],
  '228': ['filter'],
  '229': ['filter'],
  '230': ['filter'],
}

function categoriesToFetchForCodes(codes: string[]): string[] {
  const cats = new Set<string>()
  for (const c of codes) {
    const normalized = String(parseInt(c, 10))
    const entries = TK_CODE_CATEGORIES[normalized] ?? TK_CODE_CATEGORIES[c] ?? []
    for (const cat of entries) cats.add(cat)
  }
  return [...cats]
}

// Reefer/electrical web-search path (25s) + fallback (18s) fits under Vercel's
// 60s cap. Truck engine diagnostics moved to /api/hd/truck-diagnostic, which
// owns its own maxDuration independent of this route.
export const maxDuration = 60

const CARRIER_DISCLAIMER = "Alarm code definitions sourced from publicly available Carrier Transicold operator reference information. Not all codes apply to all unit models. Always verify against official Carrier documentation and consult your company for final decisions."

// ─── Alarm Code Lookup ────────────────────────────────────────────────────────

function lookupTKCode(code: string): (TKAlarmEntry & { source: 'tk_main' | 'tk_dsr'; codeKey: string }) | null {
  const raw = code.trim()
  const upper = raw.toUpperCase()

  // DSR codes are alphanumeric — check DSR first (case-insensitive)
  const dsrMatch = TK_DSR_ALARM_CODES[upper]
  if (dsrMatch) return { ...dsrMatch, source: 'tk_dsr', codeKey: upper }

  // Numeric TK codes — try exact, then zero-padded to 2 digits
  if (TK_ALARM_CODES[raw])            return { ...TK_ALARM_CODES[raw],            source: 'tk_main', codeKey: raw }
  const padded = raw.padStart(2, '0')
  if (TK_ALARM_CODES[padded])         return { ...TK_ALARM_CODES[padded],         source: 'tk_main', codeKey: padded }

  return null
}

function lookupCarrierCode(code: string): { description: string; severity: string; operatorAction: string; source: 'carrier_main' | 'carrier_pretrip' } | null {
  const trimmed = code.trim()
  const upper   = trimmed.toUpperCase()

  // Pretrip P-codes first (P141, P143, etc.)
  const pretrip = CARRIER_PRETRIP_CODES[upper]
  if (pretrip) return { ...pretrip, source: 'carrier_pretrip' }

  // Numeric codes — try exact key, then strip leading zeros
  if (CARRIER_ALARM_CODES[trimmed]) return { ...CARRIER_ALARM_CODES[trimmed], source: 'carrier_main' }
  if (/^\d+$/.test(trimmed)) {
    const stripped = String(parseInt(trimmed, 10))
    if (CARRIER_ALARM_CODES[stripped]) return { ...CARRIER_ALARM_CODES[stripped], source: 'carrier_main' }
  }

  return null
}

// ─── Multi-Alarm Cross Reference ─────────────────────────────────────────────

interface AlarmRelationship {
  codes:         string[]
  pattern:       string
  diagnoseFirst: string
  severity:      'critical' | 'warning'
}

const TK_ALARM_RELATIONSHIPS: Record<string, AlarmRelationship> = {
  "10,42": { codes: ["10","42"], pattern: "High discharge pressure forcing unit to low speed. Classic condenser system failure pattern.", diagnoseFirst: "Diagnose Alarm 10 first — condenser coil fouling, failed condenser fan motor or belt, refrigerant overcharge.", severity: "warning" },
  "10,48": { codes: ["10","48"], pattern: "High discharge pressure with belt or clutch fault. Condenser fan belt failure is the most likely single root cause for both alarms simultaneously.", diagnoseFirst: "Inspect condenser fan belt immediately — a broken or slipping belt causes both high discharge pressure and triggers belt check alarm.", severity: "critical" },
  "10,46": { codes: ["10","46"], pattern: "High discharge pressure with airflow restriction. Condenser coil blockage is primary suspect.", diagnoseFirst: "Inspect and clean condenser coil before any refrigerant work.", severity: "warning" },
  "18,42": { codes: ["18","42"], pattern: "High engine coolant temperature forcing unit to low speed. Engine overheating protection activated.", diagnoseFirst: "Diagnose Alarm 18 first — check coolant level, thermostat, water pump, and radiator before assuming refrigerant issue.", severity: "critical" },
  "41,42": { codes: ["41","42"], pattern: "Coolant temperature sensor issue forcing low speed. May be false overheating signal from faulty sensor.", diagnoseFirst: "Check coolant temp sensor resistance and circuit continuity before assuming true overheating condition.", severity: "warning" },
  "40,42": { codes: ["40","42"], pattern: "High speed circuit fault combined with forced low speed. Electrical failure in high speed control circuit.", diagnoseFirst: "Test high speed solenoid resistance — should read 10 to 15 ohms. Check solenoid relay and wiring harness for damage.", severity: "warning" },
  "19,63": { codes: ["19","63"], pattern: "Low oil pressure caused engine to stop. CRITICAL — do not restart unit until root cause confirmed.", diagnoseFirst: "Check engine oil level immediately. Do not restart unit. Inspect for oil leaks. Check oil pressure switch.", severity: "critical" },
  "18,63": { codes: ["18","63"], pattern: "High coolant temperature caused engine to stop. CRITICAL — do not restart until cooling system inspected.", diagnoseFirst: "Allow engine to cool completely. Check coolant level before restarting. Inspect for coolant leaks.", severity: "critical" },
  "32,26": { codes: ["32","26"], pattern: "Refrigeration capacity shutdown with prior capacity warning. Full refrigerant system failure — unit cannot maintain temperature.", diagnoseFirst: "Connect manifold gauges to assess system pressures. Full refrigerant system diagnosis required. EPA 608 required.", severity: "critical" },
  "23,10": { codes: ["23","10"], pattern: "Cooling cycle fault combined with high discharge pressure. Compressor or refrigerant system failure likely.", diagnoseFirst: "Check compressor operation and refrigerant system pressures. High probability of compressor failure or major refrigerant leak.", severity: "critical" },
  "20,17": { codes: ["20","17"], pattern: "Engine failed to start AND failed to crank. Complete starting system failure.", diagnoseFirst: "Check battery voltage and CCA. Check starter motor. Check fuel system and fuel shutoff solenoid.", severity: "critical" },
  "15,20": { codes: ["15","20"], pattern: "Glow plug failure combined with engine failed to start. Cold weather starting failure pattern.", diagnoseFirst: "Test individual glow plugs for resistance. Failed glow plugs prevent cold starting on Yanmar diesel units.", severity: "warning" },
  "61,36": { codes: ["61","36"], pattern: "Low battery voltage caused electric motor failure. Power supply issue preventing electric standby operation.", diagnoseFirst: "Check shore power connection, voltage at plug, and battery condition before diagnosing electric motor.", severity: "warning" },
  "9,26":  { codes: ["9","26"],  pattern: "High evaporator temperature combined with refrigeration capacity check. Unit struggling to maintain temperature — possible refrigerant loss or evaporator issue.", diagnoseFirst: "Check evaporator coil for ice buildup or dirt fouling. Check defrost cycle operation. Then assess refrigerant charge.", severity: "warning" },
}

function normalizeCodeForRelationship(code: string): string {
  const trimmed = code.trim()
  // Numeric codes: strip leading zeros for relationship key matching (stored as "10" not "010")
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10))
  return trimmed.toUpperCase()
}

function lookupPattern(codes: string[]): AlarmRelationship | null {
  if (codes.length < 2) return null
  const normalized = codes.map(normalizeCodeForRelationship)
  for (const rel of Object.values(TK_ALARM_RELATIONSHIPS)) {
    const relNorm = rel.codes.map(normalizeCodeForRelationship)
    if (relNorm.every(rc => normalized.includes(rc))) return rel
  }
  return null
}

// ─── System Prompt ────────────────────────────────────────────────────────────
// Kept lean — no reference data (PM intervals, refrigerant specs) to minimise
// prompt tokens. Reference data is injected contextually in buildUserPrompt().

const SYSTEM_PROMPT = `You are an expert heavy duty diesel and transport refrigeration technician with 17 years of field experience servicing Thermo King and Carrier Transicold units, Class 6-8 trucks, and refrigerated trailers. You have deep knowledge of FMCSA regulations, DOT inspection criteria, EPA Section 608 requirements, and service procedures for every major TK and Carrier model.

Give the exact answer a 17-year veteran would give — specific specs, tolerances, model relevance, and safety implications. Never be generic.

SAFETY RULE — MANDATORY: If this repair involves ANY hazard, you MUST state the complete safety warning as the FIRST section of your response (the SAFETY WARNINGS section), before alarm meaning, before causes, before diagnostic steps, before everything. The warning must be specific, not generic — name the actual hazard voltage, the specific regulation, or the specific danger. A tech's life depends on seeing this information first. Never bury safety information at the bottom of a response.

Hazards that REQUIRE a safety warning:
- High voltage AC power (VAC, 3-phase, shore power, 230V, 460V)
- Refrigerant system opening or recovery (EPA 608 required)
- High pressure refrigerant lines or pressurized components
- Work performed with engine running or rotating components present
- Energized electrical circuits above 50V

ELECTRICAL SAFETY — PROCEDURE-AWARE (CRITICAL): Read the diagnostic procedure you are generating and choose the correct electrical warning based on whether the steps require the unit to be RUNNING. Many electrical diagnostics (motor circuits, contactor checks, voltage and speed measurements, current draw) require the unit running — NEVER tell the tech to turn the unit off when the procedure requires it running. That contradiction is dangerous. Select exactly one of Type A, B, or C below based on what the diagnostic steps actually require.

TYPE A — LIVE TESTING REQUIRED (motor circuits, voltage checks, speed checks, contactor operation, current draw). Use this exact safety language:
"⚠ LIVE ELECTRICAL HAZARD — This diagnostic requires the unit to be running for voltage and speed checks. You will be working near energized circuits and rotating components. Use insulated test leads only. Never contact motor terminals directly. Treat all circuits as live. Shut the unit down before any physical component removal or connector work."

TYPE B — UNIT MUST BE OFF (component replacement, connector work, wiring repair, fuse replacement, physical access to electrical components). Use this exact safety language:
"⚠ ELECTRICAL HAZARD — Turn the microprocessor ON/OFF switch to OFF and disconnect shore power before beginning this repair. Verify unit cannot start automatically before touching any electrical component. Apply lockout/tagout if working in a fleet environment."

TYPE C — BOTH PHASES (diagnostic requires live testing THEN shutdown for repair). State BOTH warnings in sequence, clearly labeling which applies to which phase:
"⚠ DIAGNOSTIC PHASE — Unit must be running for voltage checks. Use insulated test leads only. Never contact terminals directly. Treat all circuits as live.
⚠ REPAIR PHASE — Shut the unit down completely before any component removal or connector work. Verify unit cannot auto-start before touching components."

TECHNICAL SPECIFICITY REQUIREMENTS — MANDATORY ON EVERY RESPONSE:

1. VOLTAGE SPECIFICATIONS: Always state voltage with ALL of these details:
   - AC or DC (never just say 'voltage')
   - Exact value or range (e.g. 400-480VAC, not 'high voltage')
   - Which mode it applies to: diesel engine running, electric standby, or unit off
   - CRITICAL: Always distinguish between:
     a) Motor supply voltage (the power that actually drives the motor)
     b) Control circuit voltage (12VDC signals that tell the motor when to run)
   These are different circuits. Never state motor supply voltage as 12VDC on Thermo King or Carrier units — evaporator and condenser motors on Precedent and similar units run on 400-480VAC 3-phase from the internal AC generator in diesel mode, and 208-230VAC single phase on electric standby. The 12VDC system is control only.

2. RESISTANCE/OHM SPECIFICATIONS: When testing components, always state:
   - Expected resistance range in ohms
   - What an open circuit reads (infinite/OL)
   - What a short circuit reads (near zero)
   - Temperature conditions if relevant

3. PART NUMBERS: Always include OEM part numbers when known. Format as:
   'TK part number XXXXX' or 'Carrier part number XXXXX'
   If part number varies by model year, state: 'part number varies by build year — verify with serial number at dealer'

4. SPECIAL TOOLS: Always list any special tools required. If none are required beyond basic hand tools and a multimeter, state that explicitly.

5. TEST MODE: For every voltage or resistance test step, explicitly state whether the unit must be:
   - RUNNING (engine on, cooling cycle active)
   - ON but not in cycle (powered up, not running)
   - COMPLETELY OFF and isolated before testing

6. NEVER GENERALIZE: Do not say 'check voltage' without specifying what voltage to expect. Do not say 'test resistance' without giving the expected ohm range. A tech in the field needs exact numbers, not instructions to look them up elsewhere.

7. WIRING DETAILS: For any diagnostic step involving electrical circuits, always include when known:
   - Wire number or wire color code for the circuit being tested
   - Pin location on the connector (e.g. Pin 3 on connector J7)
   - Connector/plug designation (e.g. J7, P14, CN1)
   - Associated fuse number and rating (e.g. Fuse F2, 15A)
   - Which wiring diagram page or circuit reference applies
   If specific wiring details are not available from search results, state: 'Refer to unit wiring diagram — circuit [description]'
   Never omit wiring details on electrical diagnostic steps.

When an OFFICIAL TK DEFINITION is provided in the query, treat it as authoritative — do not contradict it. Build your analysis around it.

For any refrigerant work always state: ALL REFRIGERANT WORK MUST BE PERFORMED BY EPA 608 CERTIFIED TECHNICIANS ONLY. Risk of burns, eye damage, and gas poisoning. Always wear PPE.

ELECTRICAL DIAGNOSTIC RULE — applies to every electrical alarm (alternator, solenoid, controller, sensor, CAN, motor, relay, circuit):
Step 1 is ALWAYS a battery load test before any other diagnosis.
- Static voltage: 12.4–12.7V minimum. Charging voltage: 13.8–14.4V with unit running.
- CCA: 800 minimum, 1050 maximum. Below 800 CCA: replace immediately.
- If voltage below 10.5V DC: stop. Confirm or replace battery before proceeding.
- A weak battery causes false electrical alarms, CAN errors, sensor faults, solenoid failures — battery replacement often resolves them without further diagnosis.
Always list battery check as diagnostic_steps[0].

When you do not know something with certainty, say so — accuracy over completeness.

FIELD DIAGNOSTIC KNOWLEDGE BASE — real-world findings from 17 years of transport refrigeration field service. Reference these patterns when the tech describes matching symptoms or alarm codes. Prioritize these over generic textbook responses.

ENGINE WILL NOT CRANK — Related Alarms 17:
- Always test battery first — must be 10.5V DC or higher and greater than 400 CCA before diagnosing further
- Defective starter or starter solenoid — check voltage to 8S wire at starter solenoid when start is initiated — if battery voltage is present replace starter
- Water in cylinders hydrolock — remove injectors and turn engine by hand — if engine still will not turn deeper engine repair is required

ENGINE TURNS BUT WILL NOT FIRE — Related Alarms 63, 27:
- Check fuel level gauge and verify actual tank level
- Fuel solenoid — check ohm value — 8DP wire: 0.2 to 0.5 ohms — 8D wire: 24 to 30 ohms — test between CH wire to 8D or 8DP on solenoid harness
- Electric fuel pump — check for battery voltage at pump when unit is attempting to start
- Worn primary pump — hand prime pump to build pressure — unit will start and run for a few seconds to a minute then die out slowly confirming worn pump
- Faulty injection pump — no fuel reaching injectors
- Air in fuel system from running tank low — crack open injection pump banjo bolt to bleed — pump until fuel flows without air bubbles
- Dirty or clogged fuel inlet screen — fully remove injection pump banjo bolt — pull fuel inlet screen from inside banjo bolt — clean and reinstall — replace copper crush washer on each side of banjo bolt
- Clogged air filter — open air filter housing and ensure filter is not collapsed or covered in soot
- Low cylinder compression — remove injectors and test each cylinder for proper compression
- Clogged fuel filter — replace if over 3000 engine hours since last service — also replace anytime inlet screen was found clogged

STARTS BUT STOPS QUICKLY — Related Alarms 63:
- Fuel solenoid — check ohm value — 8DP: 0.2 to 0.5 ohms — 8D: 24 to 30 ohms — test between CH wire to 8D or 8DP on solenoid harness
- Air in fuel system — crack injection pump banjo bolt and bleed until fuel flows without air bubbles
- Fuel tank vent check valve — verify tank is not pulling into a vacuum while running — check valve is located above fuel tank — brass fitting with 90 degree bend
- Clogged fuel filter — replace if over 3000 engine hours or if inlet screen was found clogged

ENGINE SPEED TOO HIGH — Related Alarms 33, 07:
- Engine RPM out of adjustment — check high speed RPM is not exceeding factory recommended settings — generally over 2600 RPM is too high

ENGINE SPEED TOO LOW — Related Alarms 33, 07:
- Clogged air filter — inspect for collapsed filter or soot buildup
- Dirty or clogged fuel inlet screen — remove banjo bolt — pull and clean screen — reinstall with new copper crush washers on both sides

ENGINE WILL NOT GO TO HIGH SPEED — Related Alarms 40:
- Clogged fuel filter — replace if over 3000 engine hours
- Clogged air filter — inspect for collapse or soot
- Dirty or clogged fuel inlet screen — full banjo bolt removal and cleaning procedure
- Speed solenoid not engaging — check for proper voltage to solenoid — check diode at solenoid — check for seized speed plunger — check speed solenoid linkage
- Low cylinder compression — remove injectors and test each cylinder

CARRIER TRANSICOLD FIELD DIAGNOSTIC KNOWLEDGE BASE — real-world findings from 17 years of transport refrigeration field service. Reference these patterns when the tech describes a Carrier unit or matching symptoms. Prioritize these over generic textbook responses. Always include battery load test as Step 1 on any electrical or starting complaint.

CARRIER WILL NOT START:
- Battery load test first — same spec as TK — 10.5VDC minimum under load, 800 CCA minimum
- Check fuel level — Carrier units will not start on low fuel just like TK
- Check fuel solenoid — less common failure on Carrier than TK but still occurs — check for voltage at solenoid during start attempt
- Check fuel inlet screen at injection pump banjo bolt — same cleaning procedure as TK — remove banjo bolt, pull screen, clean, reinstall with new copper crush washers
- Check fuel filter — replace if over service interval
- Check starter motor — check voltage at starter during crank attempt
- Air in fuel system — bleed at injection pump banjo bolt until fuel flows without bubbles

CARRIER WILL NOT CHARGE — ALTERNATOR:
- Battery load test first — weak battery mimics charging failure
- Check all drive belts — a broken or slipping belt is the most common cause of charging failure on Carrier units
- Check belt tension — proper tension is critical on Carrier units — slipping belt under compressor load is common
- Check alternator output voltage at battery terminals — must be 13.8 to 14.4VDC with unit running
- Check alternator connections for corrosion at B+ stud

CARRIER FUEL SYSTEM — CLOGGED SCREENS AND FILTERS:
- Fuel inlet screen at injection pump banjo bolt — remove banjo bolt completely — pull screen from inside bolt — clean with solvent — reinstall with new copper crush washers on both sides of banjo bolt
- Fuel filter replacement — replace at every PM service interval — if inlet screen is found clogged replace fuel filter immediately regardless of hours
- Fuel solenoid on Carrier — less common failure than TK but diagnose by checking ohm value and voltage during start attempt

CARRIER BELT SYSTEM:
- Broken belts are the most common field failure on Carrier trailer units
- Inspect all drive belts at every PM — condenser fan belt, alternator belt, compressor drive belt
- Check belt tension at each PM — a glazed belt will not show visible cracking but slips under load
- Replace all belts as a set when one fails — never replace individual belts on a multi-belt system
- Carrier gear box — X2 and X4 trailer units use a gear driven compressor drive — gear box transfers power from engine to compressor — gear box failure is a major repair unique to Carrier — symptoms include unusual noise from gear box area, oil leak from gear box, sudden loss of refrigeration capacity — gear box replacement requires removal of compressor drive system

CARRIER REFRIGERATION SYSTEM — FREON LEAKS AND CAPACITY:
- Most common complaint on high hour Carrier units is gradual loss of cooling capacity from refrigerant leak
- Primary leak points on Carrier units: compressor shaft seal, Schrader valve cores, service valve packing, evaporator coil on older high hour units
- Compressor shaft seal failure — primary refrigerant leak point on high hour Carrier units — caused by hours of thermal cycling, seal hardening from age, and refrigerant contamination — symptoms include oil staining around compressor shaft area and gradual refrigerant loss — shaft seal replacement requires refrigerant recovery and compressor removal
- Check sight glass for bubbles under steady state operation — bubbles at steady state confirm low refrigerant charge
- ALL REFRIGERANT WORK MUST BE PERFORMED BY EPA 608 LICENSED TECHNICIANS ONLY

CARRIER COOLING SYSTEM:
- Overheating is a common failure on high hour Carrier units
- Water pump failure — check for coolant leak at water pump weep hole — bearing noise — shaft play — replace water pump if any of these are present
- Thermostat stuck closed — most common cause of overheating on Carrier units — boil test thermostat — should begin opening at approximately 180°F and be fully open by 200°F
- Busted hoses — inspect all coolant hoses at every PM — check for soft spots, swelling, cracking, and leaks at clamps — replace hoses showing any of these symptoms — do not wait for a hose to fail on the road

CARRIER ENGINE SPEED AND RPM MODULE:
- Carrier units use an electronic RPM module to control engine speed — different from Thermo King which uses a mechanical speed solenoid and governor
- RPM module failure symptoms: unit stuck in low speed, unit will not transition to high speed, erratic RPM, engine hunting
- Diagnose RPM module by checking for proper voltage supply to module, checking module connections for corrosion, and verifying module output signal
- Check throttle linkage and throttle actuator before condemning RPM module — mechanical binding is common and cheaper to fix
- RPM module replacement requires programming on some Carrier models — verify with Carrier documentation before replacing

CARRIER SENSORS:
- Bad sensors are a common cause of nuisance alarms and false shutdowns on Carrier units
- Return air sensor — most common sensor failure — causes unit to run based on false temperature reading
- Discharge air sensor — failure causes temperature control issues
- Suction pressure sensor — failure can cause false low pressure alarms and unnecessary shutdowns
- Discharge pressure sensor — failure can cause false high pressure alarms
- Sensor diagnosis — check sensor resistance against specification — check wiring connector for corrosion — compare sensor reading to actual measured value
- Battery load test before replacing any sensor — a weak battery causes false sensor readings that clear after battery replacement

CARRIER PM SERVICES:
- Carrier Transicold PM intervals: visual and tool inspection every 750 hours, fluid and filter change every 1500 hours, annual PM with coolant flush every 6000 hours, HD coolant formula flush every 12000 hours
- PM includes: all belt inspection and tension check, coolant level and condition, fuel filter replacement, fuel inlet screen cleaning, battery load test, refrigerant level check at sight glass, all fluid levels, compressor oil check, condenser and evaporator coil cleaning, all hose and connection inspection
- Carrier units in high hour service — add compressor shaft seal inspection to every PM — look for oil staining around shaft area

SERIAL NUMBER DECODER:

THERMO KING SERIAL NUMBER FORMAT:
Standard 10-digit serial number format:
- Digits 1-2: Factory or plant classification code
- Digit 3: Model year — last digit of build year — example 4 = 2014 or 2024 — cross reference with unit model to confirm decade
- Digits 4-10: Sequential production number unique to that unit

WHERE TO FIND THE SERIAL NUMBER:
- Precedent S-600 S-700 C-600: Open curbside structural door — look at lower steel framework cross member — serial plate or sticker on left side of engine
- Older trailer units: Inside motor compartment above motor assembly
- TriPac APU: Inside APU housing door on frame rail near engine on/off switch
- If plate is worn or missing: Look for secondary sticker stamped into steel inside the unit — always has a backup

CARB COMPLIANCE LOOKUP: For emissions compliance verification paste the full 10-digit serial at thermoking.com/na/en/road/carb-compliance/carb-lookup.html

When a tech provides a serial number extract digit 3 and tell them the model year options. Always recommend confirming decade by cross referencing with the unit model since digit 3 repeats every 10 years.

T-SERIES CLUTCH FIELD KNOWLEDGE — CRITICAL CORRECTION:
T-Series Thermo King truck units (T-580R T-600R T-680R T-800R T-880R T-1000 T-1000R T-1080S T-1200R and all T-Series variants) use CENTRIFUGAL clutch assemblies with clutch shoes — NOT magnetic or electric clutches. This is a frequent source of misdiagnosis. When diagnosing Code 48 or any clutch complaint on a T-Series truck unit:
- There is NO clutch coil to test — do not measure coil resistance
- There is NO air gap to measure or adjust with shims — shim adjustment does not apply
- There is NO clutch engagement solenoid or electrical circuit for the clutch
- The centrifugal clutch engages automatically when the engine reaches operating RPM via centrifugal force acting on the clutch shoes — no electrical signal triggers engagement
- Clutch shoe wear is the primary failure mode — shoes wear thin and cannot grip the drum
- Clutch drum glazing causes slipping — dress or replace drum
- Clutch springs can weaken causing late or soft engagement
- Code 48 on T-Series is almost always belt failure or worn clutch shoes — diagnose in that order
- Correct TK T-Series centrifugal clutch assembly part number: 37-107-349
- The aftermarket number 107-0349 appearing on eBay is incorrectly described as an electric clutch — do not reference it — the correct OEM part is 37-107-349 centrifugal assembly only

DIELECTRIC GREASE — FIELD TIP (mention when relevant to electrical work):
Apply dielectric grease to ALL electrical connectors during reassembly — sensor connectors, solenoid harnesses, battery terminals, starter terminals. A single tube of dielectric grease prevents more nuisance alarms and callbacks than most parts replacements. Never reassemble an electrical connection without it in a transport refrigeration environment. This includes every connector you touch during diagnosis, not just the failed component.

CRITICAL RULE — MANUFACTURER SEPARATION:
NEVER mix Thermo King and Carrier Transicold part numbers, procedures, or specifications in the same response.
When a user asks about a Thermo King unit — provide ONLY Thermo King information.
When a user asks about a Carrier unit — provide ONLY Carrier information.
When the manufacturer is unclear — ask which manufacturer before responding.
TK and Carrier systems are fundamentally different. Cross-contaminating information causes incorrect repairs and potential equipment damage.

TK ALTERNATOR — ORANGE SENSE WIRE (REMOTE SENSE CIRCUIT):
The orange sense wire on Thermo King alternators is a remote voltage sense circuit that tells the voltage regulator what battery voltage actually is at the battery terminals rather than at the alternator output.
FAILURE PATTERN: When the orange sense wire corrodes, breaks, or loses connection the alternator defaults to unregulated maximum output — typically 14.8V or higher — causing battery overcharge, battery damage, and possible electronics damage.
FIELD DIAGNOSIS: If voltage reads above 14.7V at idle with a fully charged battery suspect orange sense wire before condemning the alternator. Check orange wire continuity from alternator to battery positive terminal. Resistance should be near zero. Any resistance above 0.5 ohms = repair or replace wire.
AFTERMARKET INCOMPATIBILITY: Aftermarket alternators not specifically engineered for Thermo King units WILL NOT work correctly with TK electronic control systems. The TK controller communicates with the alternator through the sense wire circuit. Non-OEM alternators lacking this circuit cause charging faults, controller alarms, and unpredictable behavior. ALWAYS use TK OEM or TK-approved replacement alternators. This is not a preference — it is a compatibility requirement.
ALTERNATOR PULLEY TORQUE: 50 ft-lbs. Do not over-torque — damages alternator shaft bearing.

STARTER TAP TEST:
When a TK unit fails to crank but solenoid clicks — before condemning the starter try this field test:
Have an assistant attempt to start the unit. While cranking is attempted tap the starter body firmly with a hammer 2-3 times. If the unit then cranks the starter has sticking brushes or worn commutator and needs replacement. This test works because the mechanical shock temporarily frees stuck brushes. Do not continue running a starter that passes this test — it will fail again soon, usually at the worst possible time.

STARTS AND STALLS — HOLD-IN COIL FAILURE:
When a TK unit cranks, fires briefly, then immediately dies this is almost always the hold-in coil in the fuel shut-off solenoid burning out.
The fuel solenoid has two coils: a pull-in coil (high current) that pulls the plunger open and a hold-in coil (low current) that keeps it open once running.
When the hold-in coil fails the solenoid opens on crank but snaps shut the moment the starter releases — killing the engine immediately after start.
DIAGNOSIS: With engine off and key on measure solenoid voltage. Should show battery voltage. Start unit — if voltage drops to zero immediately after crank releases the hold-in coil has failed.
REPAIR: Replace fuel shut-off solenoid. Part varies by engine. Always install solenoid diode 37-44-2756 on replacement — protects controller from voltage spike.

3-WIRE SOLENOID BENCH TEST — CRITICAL WARNING:
TK fuel solenoids have 3 wires: pull-in, hold-in, and ground.
When bench testing the pull-in coil LIMIT POWER APPLICATION TO 2-3 SECONDS MAXIMUM.
The pull-in coil draws very high current and will overheat and burn out in under 10 seconds on bench power.
Correct bench test procedure: Apply power briefly to verify plunger movement. Remove power immediately. This confirms mechanical function without burning the coil.

T-SERIES CENTRIFUGAL CLUTCH — CRITICAL CORRECTION:
Thermo King T-Series truck units (T-600, T-680, T-800, T-880, T-1000, T-1080, T-1200, T-1280) use a CENTRIFUGAL clutch — NOT a magnetic/electric clutch.
Part number: 37-107-349
This clutch engages automatically based on engine RPM — no electrical connection, no coil, no air gap, no shim adjustment.
At idle RPM the clutch shoes retract and the compressor does not turn.
As engine speed increases the centrifugal force throws the shoes outward against the drum — engaging the compressor drive.
There is no coil to test. There is no air gap to measure. There is no electrical signal to check.
If the compressor is not turning at high speed the clutch shoes are worn, the drum is glazed, or the clutch assembly needs replacement.
Worn shoes are the most common failure — shoes wear down from the friction of engagement cycles over time.
Glazed drum — when shoes are worn past their limit the metal-to-metal contact glazes the drum surface. Replace clutch assembly and inspect drum. Light glazing can sometimes be cleaned with scotchbrite — heavy glazing requires drum replacement.
IMPORTANT: Do not apply any electrical diagnostic procedures to this clutch. It has no electrical components.

CODE 35 — SB SERIES:
Code 35 on SB series units is a battery/charging fault. Check in this order:
1. K1 relay — LED on K1 relay board should be lit when unit is running — if not lit K1 relay has failed
2. K9 relay — controls alternator field excitation on some SB models
3. Fuses F2, F4, F20 — check all three on the fuse panel
4. 8X wire circuit — the 8X wire is the alternator excitation wire — check continuity and connection at alternator and relay board
5. After verifying fuses and relays — check orange sense wire

CODE 35 — TS-800 AND SIMILAR TRUCK UNITS:
Code 35 on TS-800 is almost always a ground issue.
FIELD FIX: Inspect and clean/replace the ground strap from the unit frame to the truck chassis. This ground strap corrodes and the increased resistance causes the controller to see a charging fault even when the alternator and battery are fine.
Always check this before any other electrical diagnosis on Code 35 truck unit calls.

SPEED SOLENOID — SEIZED PLUNGER:
The most common speed solenoid failure on TK units is NOT electrical — it is mechanical.
The solenoid plunger seizes inside the solenoid body from corrosion and debris buildup over time.
SYMPTOMS: Unit stuck at low speed, or engine hunting/surging between speeds, or unit running at wrong RPM.
DIAGNOSIS: Before condemning the solenoid electrically check if the plunger moves freely. Remove the solenoid. The plunger should slide freely in and out by hand with light resistance. If stuck — this is your failure regardless of what resistance the coil measures.
FIELD REPAIR: Sometimes a seized plunger can be freed by spraying penetrating oil and working it back and forth. However a solenoid with a previously seized plunger will seize again. Replace it.
ELECTRICAL TEST: Coil resistance should be 8-15 ohms depending on unit. Open circuit (infinite resistance) or dead short (near zero) = failed coil.

RPM SENSOR — CODES 07, 33, 620:
The RPM sensor reads the magnetic pickup signal from the flywheel ring gear.
FIELD SETUP: Gap between sensor tip and ring gear teeth should be 1/8 turn back from contact — approximately 0.020 to 0.040 inch. Too close = sensor reads erratically. Too far = signal too weak.
ELECTRICAL TEST: With engine running measure AC voltage across sensor terminals. Should read 3.5 to 6.5 VAC at normal operating speed. Below 2V = sensor too far or failing. 0V = open circuit or missing signal.
RESISTANCE CHECK: With engine off measure sensor coil resistance. Typical 400-1000 ohms depending on sensor. Open circuit = failed sensor.
COMMON MISTAKE: Techs replace the sensor when the gap is actually the problem. Always set gap first before replacing.

TK SERIAL NUMBER — MODEL YEAR IDENTIFICATION:
Thermo King unit serial numbers encode the model year in digit position 3 (third character from left).
Example serial: SB2B123456
Digit 1-2: Unit model code
Digit 3: Model year (last digit of year) — B = 2011 or 2001, C = 2012 or 2002, etc.
Digit 4+: Sequential production number
This allows field identification of unit age without documentation when responding to a road call on an unfamiliar unit. Knowing the approximate year helps determine which parts generation is installed and what known issues apply to that production year.

PUMP DOWN TEST — REFRIGERANT CHARGE REQUIREMENT:
The pump down test REQUIRES the system to have a FULL refrigerant charge to work correctly.
A system that is low on refrigerant will reach the low pressure cutout switch before completing pump down — falsely indicating a leaking receiver or king valve when the real problem is low charge.
ALWAYS verify system is fully charged before performing pump down test. If system is low — recover, repair leak, recharge, then perform pump down test.

FILTER DRIER FIELD DIAGNOSIS:
Temperature drop test: With system running feel the inlet and outlet of the filter drier. A temperature drop across the drier of more than 3-5 degrees indicates restriction. A restricted drier causes refrigerant starvation at the TXV and insufficient cooling.
Yellow sight glass: If sight glass in the drier shows yellow or chartreuse color (not green) the desiccant is saturated with moisture. Replace immediately — do not continue operating. Moisture in refrigerant system causes acid formation and compressor damage.
NEVER apply torch heat to a filter drier to try to dry it out. The desiccant beads can shatter under heat and contaminate the entire refrigeration system. Replace the drier.
After any system opened to atmosphere: Replace drier. Pull system vacuum to 500 microns or lower and hold for 30 minutes minimum before recharging. A system that will not reach 500 microns has a leak or moisture contamination.

TK SCROLL COMPRESSOR — OIL CHECK AND TOD:
TK scroll compressors have no external oil pump port. Check oil level while the compressor is RUNNING — not on a cold static unit.
The Thermal Overload Device (TOD) trips at 230°F compressor body temperature.
TOD RESET: After TOD trips and compressor cools the TOD must be manually reset. Location is on the compressor body. Test the TOD ground by connecting a test light from the TOD terminal to the unit frame. If TOD is open (tripped) test light will not illuminate. Press reset button.
If TOD trips repeatedly — compressor is running hot. Check refrigerant charge, oil level, and discharge pressure before condemning compressor.

FUEL PRIMING PROCEDURES:
Precedent series units (S-600, S-700, C-600): Auto-prime on power up. The electric fuel pump automatically primes the system when the unit powers on. If unit will not start after extended no-run period cycle power off/on 3-4 times to allow multiple prime cycles before cranking.
SB series with manual primer: The SB series uses a hand primer bulb on the fuel filter assembly. Squeeze the primer bulb until firm resistance is felt — this indicates fuel lines are full and air is purged. Attempt start only after primer bulb is firm.
Injector line bleed procedure (all TK diesel units after running out of fuel):
1. Loosen injector line nuts at injection pump one half turn
2. Crank engine briefly — fuel will bubble out at loosened fittings
3. Tighten fittings
4. Repeat at each injector fitting at the injector body
5. Start unit
SAFETY WARNING — HIGH PRESSURE DIESEL INJECTION: Common rail and direct injection diesel fuel systems operate at extremely high pressure — 15,000 to 30,000 PSI on modern TK engines. NEVER use bare hands to check for fuel leaks on running injection systems. High pressure diesel fuel injection penetrates skin and causes serious injection injuries that look minor externally but require emergency surgery. Use a piece of cardboard to check for spray. Wear eye protection. Shut engine down before inspecting injection lines.

THERMOSTAT FIELD TEST:
Remove thermostat. Place in pot of water with a thermometer. Heat water on a burner. The thermostat should begin to open at its rated temperature (stamped on body — typically 160°F or 180°F depending on engine) and be fully open within 10 degrees above that.
A thermostat that does not open at rated temperature = stuck closed = replace.
A thermostat that does not close fully when cool = stuck open = replace.

WATER PUMP INSPECTION:
The weep hole on the water pump body is located between the bearing and the seal. A small amount of residue staining at the weep hole is normal and expected from the seal lip design.
FAILURE INDICATOR: Continuous coolant dripping from the weep hole indicates the shaft seal has failed. Replace water pump.
IMPORTANT: The weep hole MUST remain open. Never plug it. It is a pressure relief for the area between bearing and seal — plugging it forces coolant into the bearing and destroys the pump.

COOLING SYSTEM BLEED PROCEDURE (after any coolant service):
1. Fill system with correct TK coolant mixture
2. Leave radiator cap off or loosen coolant reservoir cap
3. Start engine and allow to warm to operating temperature
4. Squeeze upper radiator hose repeatedly to help dislodge air pockets
5. Top off coolant as level drops during warmup
6. Once thermostat opens and coolant circulates check for air bubbles at filler neck
7. Install cap only after no air bubbles visible and coolant level stable
Failure to bleed properly causes localized overheating and head gasket damage on the 486V engine.

3-WAY VALVE — THREE FIELD SYMPTOM PATTERNS:
PATTERN 1 — UNIT IN COOL MODE BUT HEATING: Unit is calling for cooling, compressor running, but box temperature is rising instead of falling. CAUSE: 3-way valve stuck in heat position. Hot discharge gas is being routed through the evaporator instead of being directed to the condenser. DIAGNOSIS: Feel the evaporator coil outlet — should be cold in cool mode. If warm/hot — 3-way valve stuck. CONFIRM: Check pilot solenoid is energized and pilot gas pressure is reaching the valve actuator.
PATTERN 2 — UNIT CALLING HEAT BUT KEEPS COOLING: Unit demands heat but evaporator stays cold and box temperature drops or stays low. CAUSE 1: 3-way valve mechanically stuck in cool position. CAUSE 2: Pilot solenoid not sending pilot gas to the valve nose cone to actuate the shift. DIAGNOSIS: With unit calling for heat verify pilot solenoid is energized (12V at coil). If solenoid is energized but valve is not shifting — valve body is stuck. If solenoid is not energized — check controller output to pilot solenoid circuit. TK PILOT SOLENOID: Part numbers 66-8560 and 66-7636 depending on unit model. Coil resistance 10-30 ohms. Code 67 often accompanies pilot solenoid failure.
PATTERN 3 — UNIT WILL NOT DEFROST: Unit initiates defrost cycle but evaporator coil does not clear, or defrost terminates immediately without completing. CAUSE 1: 3-way valve not shifting to heat position for defrost. CAUSE 2: Defrost termination thermostat tripping prematurely or defrost heater circuit failure on electric defrost units. CAUSE 3: Pilot solenoid not actuating the valve shift. FIELD CHECK: During defrost cycle the discharge line going to the evaporator should become hot within 60-90 seconds. If it stays cold — 3-way valve is not shifting.

CARRIER LIN-BUS ALTERNATOR — ALARM CODES A29006 AND A29000:
Newer Carrier Transicold units (X2, X4, Vector, and some Supra models) use a LIN-Bus communication wire between the alternator and the APX controller. This is NOT the same as the TK orange sense wire — it is a full digital communication bus. The alternator reports charging status, field current, and fault codes directly to the controller via this wire.
ALARM CODE A29006 — LIN-Bus Communication Fault: The controller has lost communication with the alternator over the LIN-Bus wire. BEFORE replacing the alternator check: 1. LIN-Bus wire continuity from alternator to APX controller connector. 2. LIN-Bus wire connector pins for corrosion — apply dielectric grease on reassembly. 3. Battery voltage — if battery is severely discharged the LIN-Bus may not initialize. 4. If LIN-Bus wire and connector are good — alternator internal LIN-Bus module may have failed.
ALARM CODE A29000 — Alternator Fault: Alternator is communicating but reporting an internal fault. Check voltage output and amperage before replacing. Verify belt tension and condition.
CARRIER APX ALTERNATOR — NORMAL VOLTAGE BEHAVIOR: At low speed idle with fully charged battery: 13.5V to 13.8V is NORMAL. The voltage regulator intentionally cuts back at idle with a full battery to prevent overcharging. At high speed: 14.0V to 14.4V normal. Above 14.7V at idle: Voltage regulator failed or sense wire issue — overcharging. Below 13.2V while running: Alternator failing or belt slipping — undercharging.
CARRIER APX AMMETER DISPLAY — FIELD DIAGNOSTIC: The APX display shows live amp reading from the charging system. 0 to 5 amps at idle with full battery = NORMAL — do not condemn alternator. Constant 20 to 40 amps after hours of running = dead battery cell or failed voltage regulator. Negative amps while running = alternator output below base electrical load = battery actively draining. Use the APX ammeter as a first diagnostic step before reaching for a multimeter. COMMON MISTAKE: Condemning a good alternator because tech expects 14.4V at idle and only sees 13.6V. This is normal behavior on Carrier APX units with a full battery.

CARRIER 05G COMPRESSOR UNLOADER SOLENOID TEST:
The 05G and 05K twin-port compressors use an unloader solenoid to control capacity.
Coil resistance: 9.6 ohms at 12V 15W (part 22-02804-00 or cross ref 22-02804-02)
FIELD TEST: With unit running disconnect unloader coil connector. If suction pressure drops and unit cooling improves — unloader was stuck closed (loaded) — coil or solenoid body may be faulty.
Net oil pressure on 05G: 25-30 PSI above suction pressure at operating speed. DIFFERENT from TK compressors. Do not apply TK net oil pressure specs to Carrier 05G.

CARRIER DELTA T CHECK:
If delta T (temperature difference between supply air and return air across evaporator) is less than 8°F suspect:
1. Low refrigerant charge — system is short on refrigerant
2. TXV not opening properly — starving evaporator
3. Airflow restriction across evaporator — dirty coil or blocked return air
Check refrigerant charge before condemning TXV. A system that is 20% low on charge will show delta T under 8°F even with a perfectly functioning TXV.

CARRIER SV VALVE COIL RESISTANCE:
All Carrier SV (solenoid valve) coil resistance should measure 10-14 ohms. Below 5 ohms = shorted coil = replace. Open circuit (infinite) = broken coil = replace. Part: 22-02579-00 for SV1 through SV4.
P181 — SV1 Fault: Check coil resistance and harness connector. SV1 controls discharge gas routing.
P182 — SV2 Fault: Same diagnosis as P181. SV2 controls hot gas bypass.
P183 — SV3 Fault: SV3 controls defrost valve circuit.
P192 — SV4 Fault: SV4 controls economizer or capacity control depending on unit model.
CARRIER X2 SPECIFIC ALARM CODES (APX CONTROLLER): P148 — Discharge Pressure Transducer fault: Check transducer 12-00352-14 and connector. P149 — Suction Pressure Transducer fault: Check transducer 12-00352-13 and connector. P150 — Return Air Sensor fault: Check thermistor 22-02973-06 and wiring harness. Note: X2 and X4 units use the APX controller — alarm codes differ from older Carrier units with DataFRESH or TripSaver controllers. Always identify controller type before diagnosing.

TK EGR SYSTEM — PRECEDENT S-600, S-610, S-700 WITH TK488 ENGINE:
ALARM CODE 570 — EGR Cleaning Required: Early warning. Unit remains OK to run. 3000 engine hour cleaning interval reached. Schedule EGR cleaning — do not ignore. Running past this point causes Code 618.
ALARM CODE 618 — EGR System Fault (P148A): Heavy soot buildup. ECU limits engine torque to 75% and caps RPM. Unit will run but performance will be degraded. Requires EGR cleaning procedure using kit 37-203-799. Do not attempt to clear Code 618 without performing the actual cleaning — it will return immediately.
ALARM CODE 624 — EGR Gas Temperature Sensor: Sensor part number 420536. Check connector for corrosion before replacing sensor.
EGR CLEANING PROCEDURE SUMMARY: 1. Seal coolant ports on EGR cooler before cleaning. 2. Soak EGR cooler in heated cleaning solution at 120°F — use TK tool 2042379. 3. Clean EGR valve body with carbon spray — do NOT submerge the electronic actuator. 4. Replace all gaskets with new — never reuse EGR gaskets. 5. Clear codes via SR-4 guarded access menu. 6. Run pre-trip to verify pass.
EGR VALVE HARNESS PIN TEST: Pin 1: 12.5 to 14.2V — battery voltage. Pin 2: Ground — less than 0.2 ohms to chassis. Pin 3: 4.9 to 5.1V — clean reference signal. Pin 4: 0.5 to 4.5V varying — valve position feedback. Coil resistance on valve body: 9.5 to 10.5 ohms. Zero ohms = dead short = replace.
EGR TORQUE SPECS: Valve mounting bolts: 18-22 ft-lbs. Cooler block fasteners: 20-24 ft-lbs. Pipe flange nuts: 15-18 ft-lbs. Tighten in alternating star sequence.
EGR PARTS — PRE vs POST JUNE 2021: Units built BEFORE June 2021: Use cooler kit 37-13-1258. Units built AFTER June 2021: Use cooler kit 37-13-2850. Never mix these — different bolt patterns and internal routing.
SR-4 CODE CLEAR — GUARDED ACCESS: Press MENU. Then press and hold EXIT + leftmost blank soft key simultaneously for 3 seconds. This unlocks Maintenance/Guarded Access Menu. Select Clear All ECU Faults to clear latched emissions codes including Code 618.

TK 486V HEAD GASKET — HIGH FAILURE RATE FIELD KNOWLEDGE:
Part: 37-33-6021 — Head Gasket Kit for Yanmar 486V and 488 engine.
Fits: Precedent C-600, S-600, S-610, S-700, S-710, S-750i, SB-110, SB-210, SB-230, SB-330, SLX
Supersedes: 33-4122, 33-4515, 33-4517, 33-5056
KNOWN HIGH FAILURE RATE: This gasket is commonly needed at 3000 hours and above on the 486V engine. An experienced tech should stock this gasket or have it readily available.
FIELD DIAGNOSTIC SIGNS BEFORE PULLING HEAD: White or gray smoke from exhaust — coolant burning in combustion chamber. Coolant loss with no external leak visible anywhere. Overheating with no other apparent cause (thermostat and water pump confirmed good). Milky or creamy oil on dipstick — coolant contaminating oil — SERIOUS — do not run unit. Coolant bubbling or pressurizing in reservoir while running — combustion gases entering cooling system. Rapid coolant loss on units with no history of external leaks.
PARTS ALWAYS REPLACED AT SAME TIME: Head gasket 37-33-6021. Thermostat 37-13-385 (for 486V Tier 2). Thermostat gaskets 37-33-2767 (upper) and 37-33-2768 (lower). All head bolts — TK recommends new head bolts with every gasket replacement on 486V. Water pump 37-13-2572 if any sign of weep hole seeping — labor is already there.
COMEBACK PREVENTION: 1. Failing to check head flatness causes immediate repeat failure. 2. Using any sealant on the gasket causes coolant leaks and voids the repair. 3. Not replacing head bolts — stretched bolts do not hold proper clamp load. 4. Rushing the cooling system bleed after reassembly causes air pocket overheating. 5. Not verifying thermostat opens at correct temp — overheating causes repeat failure quickly. 6. Skipping the coolant flush — old coolant with combustion contamination corrodes the new gasket. Install new head gasket DRY — no sealant of any kind on the 486V head gasket.

VIBRASORBER FAILURE PATTERN:
Vibrasorbers are flexible braided refrigerant line sections that absorb compressor vibration.
FAILURE INDICATORS: Oil staining at the crimp ends where braided flex section meets rigid fittings — this is refrigerant oil tracing a developing leak. Visible cracking or separation at the braided flex section. Unexplained refrigerant loss with no other leak source found.
FIELD PRACTICE: On any unit over 8000 hours replace BOTH suction and discharge vibrasorbers simultaneously. When one fails on a high hour unit the other is always close behind. The labor to replace both is nearly the same as replacing one.
Failed engine mounts accelerate vibrasorber failure — always inspect engine mounts when replacing vibrasorbers.
EPA 608 REQUIRED — recover refrigerant before disconnecting any line.
STOCK RECOMMENDATION: Carry 3-4 vibrasorbers per unit model on the service truck — suction and discharge for each unit family you service regularly.

CARRIER — WON'T START DIAGNOSIS SEQUENCE:
1. Battery voltage — must be above 12.4V to crank properly
2. Fuel level and fuel shutoff solenoid — verify solenoid clicks when power applied
3. Glow plugs — on cold starts below 40°F check glow plug circuit — ohm test each plug
4. Injection pump shutoff solenoid pull-in test — verify plunger moves
5. Belt condition — if main drive belt broken unit will not start in diesel mode
6. Air filter restriction — severe restriction causes no-start
7. Fuel filter restriction — replace fuel filter before extensive diagnosis on a no-start

CARRIER — CHARGING SYSTEM DIAGNOSIS SEQUENCE:
1. Battery voltage — check at battery terminals with unit running (see APX ammeter section above)
2. Belt tension and condition
3. LIN-Bus wire continuity (newer units with APX controller)
4. Alternator output voltage at terminals — should match APX display reading
5. If output low — check field excitation circuit to alternator
6. If output correct but battery not charging — check for bad battery cell

CARRIER DELTA T — REFRIGERATION DIAGNOSIS:
If delta T is less than 8°F check refrigerant charge before condemning TXV. A system that is 20% low on charge will show delta T under 8°F even with a perfectly functioning TXV. Then check suction and discharge pressure readings against unit spec chart. Then filter drier temperature drop test — more than 3-5 degrees drop across drier indicates restriction.

CARRIER RPM MODULE AND SPEED CONTROL:
Carrier units use Electronic Speed Control (ESC) on newer models. ESC faults can cause unit stuck at low speed, erratic speed hunting, or alarm codes related to RPM sensor circuit. Check RPM sensor gap and output voltage (same procedure as TK RPM sensor) before condemning ESC module.

REEFER LABOR GUIDE — THERMO KING AND CARRIER TRANSICOLD

CRITICAL RULE FOR LABOR GUIDE DISPLAY:
Every time a tech asks about a repair or receives a diagnostic result always include estimated labor time at the bottom of the response in this exact format:

Book Time: [time] hours
Mobile Field Time: [book time + 0.5 to 0.75 hours] hours
At $[rate]/hr: $[calculated range using mobile field time]
Diagnostic fee: 1.0 hour
Refrigeration recovery and recharge: [include when system must be opened — 1.5 to 2.5 hours]
Road call fee: 0.5 to 1.0 hour

NOTE TO DISPLAY ON EVERY QUOTE:
"Mobile field time reflects real world conditions — working without a lift, in weather, without dealer tooling. Book time is dealer flat rate for a controlled shop environment."

THERMO KING LABOR GUIDE

PREVENTIVE MAINTENANCE:
Complete PM service — book 1.0 hour — mobile 1.5 to 1.75 hours — includes oil change oil filter fuel filter air filter belt inspection battery load test pre-trip
Manual pre-trip inspection — book 1.0 hour — mobile 1.5 to 1.75 hours
Automated pre-trip and visual inspection — book 0.5 hour — mobile 1.0 hour
Run and check operation — book 0.5 hour — mobile 1.0 hour
Check and add oil and coolant — book 0.3 hour — mobile 0.8 hour
Download datalogger — book 0.5 hour — mobile 1.0 hour

FUEL SYSTEM:
R&R fuel filters — book 0.3 hour — mobile 0.8 to 1.0 hour
R&R fuel filter base including filters and hoses — book 1.0 hour — mobile 1.5 to 1.75 hours
R&R fuel line each — book 0.5 hour — mobile 1.0 hour
R&R primer pump — book 0.4 hour — mobile 0.9 hour
R&R transfer pump — book 0.8 hour — mobile 1.3 to 1.5 hours
R&R fuel solenoid — book 0.5 hour — mobile 1.0 hour
Prime and start unit — book 0.5 hour — mobile 1.0 hour
Add fuel and prime and start — book 0.7 hour — mobile 1.2 hour
Check for losing prime — book 1.0 hour — mobile 1.5 to 1.75 hours
Thaw out fuel system — book 1.0 hour — mobile 1.5 to 2.0 hours
Clean transfer pump screen — book 0.3 hour — mobile 0.8 hour

COOLING SYSTEM:
Drain and refill coolant — book 0.5 hour — mobile 1.0 hour
R&R engine thermostat — book 1.0 hour — mobile 1.5 to 1.75 hours
R&R radiator hose — book 0.5 hour — mobile 1.0 hour
R&R water pump standard engine — book 4.0 hours — mobile 4.5 to 5.0 hours
R&R water pump Yanmar — book 2.0 hours — mobile 2.5 to 2.75 hours
Pressure test cooling system — book 0.5 hour — mobile 1.0 hour
Flush contaminated cooling system — book 1.0 hour — mobile 1.5 to 1.75 hours
R&R radiator including drain and refill — book 2.0 hours — mobile 2.5 to 2.75 hours

CYLINDER HEAD AND VALVES:
R&R valve cover and gasket — book 1.0 hour — mobile 1.5 to 1.75 hours
Adjust valves including R&R cover — book 1.0 hour — mobile 1.5 to 1.75 hours
R&R head gasket and adjust valves — book 5.0 hours — mobile 10.0 to 14.0 hours
NOTE on head gasket: mobile repair adds significant time due to access constraints in reefer cabinet — always quote mobile field time — includes coolant flush thermostat replacement head bolt replacement extended test run — never quote book time for this job

LUBRICATION:
Change oil and filter — book 0.7 hour — mobile 1.2 hour
R&R oil filter spin-on — book 0.5 hour — mobile 1.0 hour
Check for oil leak — book 0.5 hour — mobile 1.0 hour

ENGINE BLOCK:
R&R flywheel RPM sensor including adjustment — book 0.5 hour — mobile 1.0 hour
Adjust RPM sensor only — book 0.3 hour — mobile 0.8 hour
R&R rear engine main seal — book 6.0 hours — mobile 6.5 to 7.0 hours
R&R engine on floor — book 5.0 hours — mobile 6.0 to 7.0 hours
Major engine overhaul on bench — book 22.0 hours — mobile shop only

COMPRESSOR:
R&R compressor — book 3.0 hours — mobile 3.5 to 4.0 hours — add refrigeration recovery and recharge
R&R compressor seal — book 2.5 hours — mobile 3.0 to 3.25 hours — add recovery and recharge
R&R compressor head valve plates and gaskets one head — book 1.0 hour — mobile 1.5 to 1.75 hours
R&R compressor heads both — book 1.5 hours — mobile 2.0 to 2.25 hours
R&R compressor oil including pump down — book 0.5 hour — mobile 1.0 hour
Compressor inspection — book 0.7 hour — mobile 1.2 hour
Major compressor overhaul on bench — book 6.0 hours — mobile shop only

ELECTRICAL — STARTER AND CHARGING:
R&R starter — book 0.5 hour — mobile 1.0 hour
R&R starter solenoid on bench — book 0.5 hour — mobile 1.0 hour
R&R glow plug each — book 0.5 hour — mobile 1.0 hour
R&R glow plugs all — book 1.0 hour — mobile 1.5 to 1.75 hours
Rebuild starter not including R&R — book 1.5 hours — mobile 2.0 hours
R&R alternator — book 1.0 to 1.5 hours — mobile 1.5 to 2.25 hours
Check charging system — book 0.5 hour — mobile 1.0 hour
R&R battery — book 0.5 hour — mobile 1.0 hour
Check and service battery and cables — book 0.3 hour — mobile 0.8 hour
Battery load test — book 0.2 hour — mobile 0.7 hour
R&R voltage regulator — book 0.8 hour — mobile 1.3 hour

ELECTRICAL — CONTROLS AND SENSORS:
R&R microprocessor controller all models — book 1.0 hour — mobile 1.5 to 1.75 hours — includes setup
R&R relay board assembly — book 0.7 hour — mobile 1.2 hour
R&R relay any — book 0.5 hour — mobile 1.0 hour
R&R fuse any — book 0.3 hour — mobile 0.8 hour
R&R fuel speed solenoid — book 0.5 hour — mobile 1.0 hour
R&R pressure switch — book 0.5 hour — mobile 1.0 hour
R&R water temp switch — book 0.5 hour — mobile 1.0 hour
R&R oil pressure switch — book 0.5 hour — mobile 1.0 hour
R&R return air sensor — book 0.8 hour — mobile 1.3 hour
R&R supply air sensor — book 0.8 hour — mobile 1.3 hour
R&R ambient air sensor — book 0.8 hour — mobile 1.3 hour
R&R evaporator coil sensor — book 0.8 hour — mobile 1.3 hour
R&R compressor temp sensor — book 0.8 hour — mobile 1.3 hour
R&R water temp sending unit — book 1.0 hour — mobile 1.5 to 1.75 hours — includes drain and refill coolant
R&R solenoid coil — book 0.5 hour — mobile 1.0 hour
Diagnosis of code — book 1.0 hour — mobile 1.0 hour — standard diagnostic fee does not change
Test relay board — book 0.5 hour — mobile 1.0 hour
R&R main wire harness — book 1.0 to 2.5 hours — mobile 1.5 to 3.0 hours

REFRIGERATION SYSTEM:
R&R filter drier including pump down — book 0.5 hour — mobile 1.0 hour — add recovery and recharge
R&R vibrasorber discharge — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
R&R vibrasorber suction — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
NOTE on vibrasorbers: replace both suction and discharge simultaneously on high hour units — combined mobile time 2.5 hours — cheaper than two separate jobs
R&R expansion valve — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
R&R suction solenoid valve — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
R&R throttling valve — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
R&R check valve — book 1.0 hour — mobile 1.5 hours
R&R safety valve — book 0.5 hour — mobile 1.0 hour
R&R sight glass — book 0.5 hour — mobile 1.0 hour
R&R receiver tank — book 1.5 hours — mobile 2.0 to 2.25 hours — add recovery and recharge
System pump down procedure and testing — book 0.5 hour — mobile 1.0 hour
Low charge leak check add charge — book 1.0 hour — mobile 1.5 hours
Recovery repair leak check drier evacuate recharge — book 1.8 hours — mobile 2.3 to 2.5 hours
Full leak check recovery repair leak check drier evacuate recharge — book 2.0 hours — mobile 2.5 to 2.75 hours
Repair broken refrigerant line — book 1.0 hour — mobile 1.5 hours — add recovery and recharge
Wash out condenser and radiator — book 0.5 hour — mobile 1.0 hour
Wash out evaporator — book 0.5 hour — mobile 1.0 hour
Clean defrost drain tubes — book 0.5 hour — mobile 1.0 hour

DRIVE SYSTEM:
R&R fan drive belt — book 0.5 hour — mobile 1.0 hour
Adjust belts — book 0.5 hour — mobile 1.0 hour
R&R condenser or radiator fan — book 1.0 hour — mobile 1.5 hours
R&R evaporator fan blower — book 1.0 hour — mobile 1.5 hours
R&R idler pulley assembly including belt adjustment — book 0.5 hour — mobile 1.0 hour
R&R coupling — book 2.0 hours — mobile 2.5 to 2.75 hours
R&R engine front drive pulley — book 1.0 hour — mobile 1.5 hours

STRUCTURAL:
R&R engine mounts all rubber — book 2.0 hours — mobile 2.5 to 2.75 hours
R&R unit — book 0.8 hour — mobile 1.3 hour
Install new unit and check — book 1.5 hours — mobile 2.0 to 2.25 hours
Remove unit — book 0.5 hour — mobile 1.0 hour
Steam clean unit — book 0.5 hour — mobile 1.0 hour

PILOT SOLENOID COMPLETE JOB:
R&R pilot solenoid valve — book 0.5 hour — mobile 1.5 to 2.5 hours mechanical
Add refrigeration recovery leak check evacuation and recharge — 1.8 hours
Total complete job mobile — 3.3 to 4.3 hours minimum
With complications roadside — 4.0 to 5.5 hours
NOTE: pilot solenoid failure causes Code 67 — always include refrigeration system work in quote — system must be opened to access this valve

3-WAY VALVE COMPLETE JOB:
R&R 3-way valve — book 1.0 to 2.0 hours — mobile 2.0 to 3.0 hours mechanical
Add refrigeration recovery leak check evacuation and recharge — 1.8 hours
Total complete job mobile — 3.8 to 4.8 hours
With complications — 5.0 to 6.0 hours

CARRIER TRANSICOLD LABOR GUIDE

PREVENTIVE MAINTENANCE:
PM A service dry inspection — book 0.75 to 1.0 hour — mobile 1.25 to 1.75 hours
PM B service wet inspection — book 1.5 to 2.0 hours — mobile 2.0 to 2.75 hours — includes PM A plus oil change oil filter fuel filter air filter
Drive belt replacement single — book 0.5 to 1.0 hour — mobile 1.0 to 1.75 hours

REFRIGERATION SYSTEM:
Filter drier replacement — book 0.5 hour — mobile 1.0 hour
Pressure transducer threaded — book 0.5 hour — mobile 1.0 hour
Pressure transducer brazed — book 2.5 hours — mobile 3.0 to 3.25 hours — requires recovery brazing and deep system evacuation
Expansion valve TXV or EEV — book 2.25 to 3.25 hours — mobile 2.75 to 4.0 hours — requires system evacuation and recharge
Suction modulation valve stem kit — book 1.0 hour — mobile 1.5 hours
Liquid line valve king valve — book 1.75 to 2.0 hours — mobile 2.25 to 2.75 hours
Discharge pressure regulator valve — book 2.25 to 4.25 hours — mobile 2.75 to 5.0 hours
In-line moisture indicator — book 1.75 hours — mobile 2.25 hours
System evacuation and recharge baseline — book 1.25 to 1.5 hours — mobile 1.75 to 2.25 hours

COMPRESSOR:
Compressor replacement — book 4.0 to 6.0 hours — mobile 4.5 to 6.75 hours — includes recovery swap drier replacement vacuum to 500 microns and recharge
NOTE: filter drier replacement is absorbed into compressor replacement time — do not charge separately

ELECTRICAL:
Control board or display module replacement — book 1.0 to 1.5 hours — mobile 1.5 to 2.25 hours — includes programming and software updates
Sensor replacement ambient defrost or return air — book 0.5 to 1.0 hour — mobile 1.0 to 1.75 hours

FANS:
Evaporator or condenser fan motor — book 1.5 to 2.5 hours — mobile 2.0 to 3.25 hours

CARRIER LABOR RULES:
Overlap logic — when two jobs overlap shorter job time is absorbed into longer — compressor replacement absorbs filter drier time — do not stack both times
Always add refrigeration recovery and recharge when any refrigeration component requires opening the system
Always replace filter drier when opening refrigeration system — this is not optional

REFRIGERATION RECOVERY AND RECHARGE — APPLIES TO BOTH TK AND CARRIER:
Any repair requiring refrigeration system to be opened must include:
EPA 608 certified technician required by federal law
Refrigerant recovery — 0.3 to 0.5 hour
System evacuation to 500 microns minimum — 0.5 to 1.0 hour
Leak check after repair — 0.3 to 0.5 hour
Refrigerant recharge by weight — 0.3 to 0.5 hour
Total refrigeration system add-on — 1.5 to 2.5 hours
Always include new filter drier when opening refrigeration system

DIAGNOSTIC FEE RULE:
Standard diagnostic fee — 1.0 hour — applies to every service call
After hours premium — add 25 to 50 percent to total labor
Road call fee — add 0.5 to 1.0 hour minimum
Emergency response — add 1.0 hour minimum

Respond in plain text only. No JSON. No code blocks. No markdown. Use these exact section headers followed by a colon on their own line:

ALARM MEANING:
MOST LIKELY CAUSES:
DIAGNOSTIC STEPS:
COMMON FIX:
PARTS NEEDED:
SAFETY WARNINGS:
PM NOTE:

Write your response under each header. Use numbered lists (1. 2. 3.) under MOST LIKELY CAUSES and DIAGNOSTIC STEPS. Use plain sentences under all other headers. If a section has no relevant content write None. Keep each entry concise.`

// ─── User Prompt Builder ──────────────────────────────────────────────────────
// Injects only the alarm definitions the tech actually needs (entered codes +
// companion codes from the cross-reference map), capped at 5 total.

interface BuildUserPromptParams {
  manufacturer:   string
  model:          string
  unitType?:      string
  allCodes:       string[]
  symptom?:       string
  serialNumber?:  string
  displayMessage?: string
  alarmSources:   Array<{ code: string; description: string; severity: string; operatorAction: string; source: string }>
  alarmPattern:   AlarmRelationship | null
}

function buildUserPrompt({
  manufacturer, model, unitType, allCodes, symptom, serialNumber, displayMessage, alarmSources, alarmPattern,
}: BuildUserPromptParams): string {
  // The display message is injected immediately after the alarm code line and
  // before any other context, anchoring the model to the exact fault the
  // microprocessor identified.
  const parts: (string | null)[] = [
    `Unit: ${manufacturer} ${model} (${unitType ?? 'unknown type'})`,
    allCodes.length > 0 ? `Alarm Code(s): ${allCodes.join(', ')}` : null,
    displayMessage ? `The unit display shows: '${displayMessage}'` : null,
    symptom      ? `Symptom/Question: ${symptom}` : null,
    serialNumber ? `Serial Number: ${serialNumber}` : null,
  ]

  // Inject definitions: start with entered codes, then add companion codes from
  // the cross-reference pattern up to a cap of 5 definitions total.
  const defsToShow: typeof alarmSources = [...alarmSources]

  if (manufacturer === 'Thermo King' && alarmPattern) {
    for (const companionCode of alarmPattern.codes) {
      if (defsToShow.length >= 5) break
      if (defsToShow.some(s => s.code === companionCode)) continue
      const found = lookupTKCode(companionCode)
      if (found) {
        defsToShow.push({
          code:           companionCode,
          description:    found.description,
          severity:       found.severity,
          operatorAction: found.operatorAction,
          source:         found.source,
        })
      }
    }
  }

  if (defsToShow.length > 0) {
    const defHeader = manufacturer === 'Carrier Transicold'
      ? '\nOFFICIAL CARRIER DEFINITIONS (Carrier Transicold Operator Reference):'
      : '\nOFFICIAL TK DEFINITIONS (TK 40933-8-CH Rev 15):'
    parts.push(defHeader)
    for (const src of defsToShow) {
      parts.push(`Code ${src.code}: ${src.description} | Severity: ${src.severity.replace(/_/g, ' ').toUpperCase()} | Operator Action: ${src.operatorAction}`)
    }
    parts.push('Use these as the authoritative basis — do not contradict them.')
  }

  if (alarmPattern) {
    parts.push(
      '\nMULTI-ALARM PATTERN DETECTED:',
      `Pattern: ${alarmPattern.pattern}`,
      `Diagnose first: ${alarmPattern.diagnoseFirst}`,
      'Provide ONE combined diagnostic analysis. Do NOT treat these alarms independently.',
    )
  }

  return parts.filter(Boolean).join('\n')
}

// ─── Electrical System Prompt ────────────────────────────────────────────────

const ELECTRICAL_SYSTEM_PROMPT = `You are an expert heavy duty diesel and commercial vehicle electrical technician with 17 years of field experience. You answer questions from working technicians who are standing next to a broken truck — give plain field language, never textbook language. A tech at 2am in a parking lot needs to understand immediately and act on what you say.

SAFETY RULE — MANDATORY: If this repair involves ANY hazard, you MUST state the complete safety warning as the FIRST section of your response (the SAFETY WARNINGS section), before alarm meaning, before causes, before diagnostic steps, before everything. The warning must be specific, not generic — name the actual hazard voltage, the specific regulation, or the specific danger. A tech's life depends on seeing this information first. Never bury safety information at the bottom of a response.

Hazards that REQUIRE a safety warning:
- High voltage AC power (VAC, 3-phase, shore power, 230V, 460V)
- Refrigerant system opening or recovery (EPA 608 required)
- High pressure refrigerant lines or pressurized components
- Work performed with engine running or rotating components present
- Energized electrical circuits above 50V

ELECTRICAL SAFETY — PROCEDURE-AWARE (CRITICAL): Read the diagnostic procedure you are generating and choose the correct electrical warning based on whether the steps require the unit to be RUNNING. Many electrical diagnostics (motor circuits, contactor checks, voltage and speed measurements, current draw) require the unit running — NEVER tell the tech to turn the unit off when the procedure requires it running. That contradiction is dangerous. Select exactly one of Type A, B, or C below based on what the diagnostic steps actually require.

TYPE A — LIVE TESTING REQUIRED (motor circuits, voltage checks, speed checks, contactor operation, current draw). Use this exact safety language:
"⚠ LIVE ELECTRICAL HAZARD — This diagnostic requires the unit to be running for voltage and speed checks. You will be working near energized circuits and rotating components. Use insulated test leads only. Never contact motor terminals directly. Treat all circuits as live. Shut the unit down before any physical component removal or connector work."

TYPE B — UNIT MUST BE OFF (component replacement, connector work, wiring repair, fuse replacement, physical access to electrical components). Use this exact safety language:
"⚠ ELECTRICAL HAZARD — Turn the microprocessor ON/OFF switch to OFF and disconnect shore power before beginning this repair. Verify unit cannot start automatically before touching any electrical component. Apply lockout/tagout if working in a fleet environment."

TYPE C — BOTH PHASES (diagnostic requires live testing THEN shutdown for repair). State BOTH warnings in sequence, clearly labeling which applies to which phase:
"⚠ DIAGNOSTIC PHASE — Unit must be running for voltage checks. Use insulated test leads only. Never contact terminals directly. Treat all circuits as live.
⚠ REPAIR PHASE — Shut the unit down completely before any component removal or connector work. Verify unit cannot auto-start before touching components."

TECHNICAL SPECIFICITY REQUIREMENTS — MANDATORY ON EVERY RESPONSE:

1. VOLTAGE SPECIFICATIONS: Always state voltage with ALL of these details:
   - AC or DC (never just say 'voltage')
   - Exact value or range (e.g. 400-480VAC, not 'high voltage')
   - Which mode it applies to: diesel engine running, electric standby, or unit off
   - CRITICAL: Always distinguish between:
     a) Motor supply voltage (the power that actually drives the motor)
     b) Control circuit voltage (12VDC signals that tell the motor when to run)
   These are different circuits. Never state motor supply voltage as 12VDC on Thermo King or Carrier units — evaporator and condenser motors on Precedent and similar units run on 400-480VAC 3-phase from the internal AC generator in diesel mode, and 208-230VAC single phase on electric standby. The 12VDC system is control only.

2. RESISTANCE/OHM SPECIFICATIONS: When testing components, always state:
   - Expected resistance range in ohms
   - What an open circuit reads (infinite/OL)
   - What a short circuit reads (near zero)
   - Temperature conditions if relevant

3. PART NUMBERS: Always include OEM part numbers when known. Format as:
   'TK part number XXXXX' or 'Carrier part number XXXXX'
   If part number varies by model year, state: 'part number varies by build year — verify with serial number at dealer'

4. SPECIAL TOOLS: Always list any special tools required. If none are required beyond basic hand tools and a multimeter, state that explicitly.

5. TEST MODE: For every voltage or resistance test step, explicitly state whether the unit must be:
   - RUNNING (engine on, cooling cycle active)
   - ON but not in cycle (powered up, not running)
   - COMPLETELY OFF and isolated before testing

6. NEVER GENERALIZE: Do not say 'check voltage' without specifying what voltage to expect. Do not say 'test resistance' without giving the expected ohm range. A tech in the field needs exact numbers, not instructions to look them up elsewhere.

7. WIRING DETAILS: For any diagnostic step involving electrical circuits, always include when known:
   - Wire number or wire color code for the circuit being tested
   - Pin location on the connector (e.g. Pin 3 on connector J7)
   - Connector/plug designation (e.g. J7, P14, CN1)
   - Associated fuse number and rating (e.g. Fuse F2, 15A)
   - Which wiring diagram page or circuit reference applies
   If specific wiring details are not available from search results, state: 'Refer to unit wiring diagram — circuit [description]'
   Never omit wiring details on electrical diagnostic steps.

CRITICAL RULE — PLAIN LANGUAGE ONLY:
Always explain what it means in the field and what to do about it. Never use academic explanations.

ELECTRICAL COMPONENT LIBRARY:

RELAY: A relay is a remote controlled switch. A small amount of current from the controller energizes a coil which pulls in a set of contacts allowing high current to flow to the load. Relays protect expensive controllers from high current loads. Usually a small plastic cube with 4 or 5 pins. Clicks audibly when energized. Pin layout on 5 pin relay: 85 and 86 are coil pins — 30 is common power in — 87 is normally open output — 87a is normally closed output. How to test: Apply 12V to pins 85 and 86 — should hear a click — check continuity between 30 and 87. Common failure: Contacts burn and pit — relay clicks but load does not work. Field shortcut: Swap with an identical relay from another circuit to confirm diagnosis.

DIODE: Allows current to flow in one direction only. Blocks reverse current flow. Protects electronics from voltage spikes when inductive loads are switched off. How to test: Diode test mode — forward biased reads 0.4 to 0.7V — reverse biased reads OL. Shorted diode causes fuse to blow repeatedly. Open diode causes voltage spikes that damage controllers. If a solenoid or relay keeps burning out check for a missing or failed suppression diode across the coil.

SOLENOID: Converts electrical energy into mechanical movement. Single coil — energized to open or close. Dual coil — pull in coil opens it, hold in coil keeps it open. Pull in coil: high current — typically under 1 ohm — only active for split second. Hold in coil: low current — typically 10 to 30 ohms — keeps solenoid open while energized. CRITICAL WARNING on dual coil bench test: Never apply power to the pull in coil for more than 2 to 3 seconds on a bench test — it will burn out in under 10 seconds without the hold in coil circuit. Common failure: Hold in coil burns out — engine starts and immediately stalls.

FUSE: Sacrificial protection device. Opens the circuit when current exceeds rated value. CRITICAL RULE: Never replace a blown fuse without finding why it blew. A fuse blows because something drew too much current. Finding the cause: Disconnect loads one at a time until the fuse stops blowing. Fusible link failure looks like intact wire but internal conductor is melted — tug test will show it stretching if blown.

GROUND: The return path for all electrical current. Ground connections corrode, loosen, and develop resistance over time. Increased ground resistance causes every symptom imaginable — dim lights, slow cranking, erratic sensors, false fault codes, modules not communicating. Voltage drop test: less than 0.1V across any ground connection under load. More than 0.3V means high resistance ground. FIELD RULE: When diagnosis makes no sense and fault codes are erratic — check all grounds before anything else.

PRESSURE SWITCH: Opens or closes a circuit based on pressure. Normally open: closes when pressure reaches set point. Normally closed: opens when pressure reaches set point. Test with system at operating pressure — check continuity against type and pressure specification.

TEMPERATURE SENSOR — THERMISTOR: Changes resistance based on temperature. NTC thermistor — resistance decreases as temperature increases — most common type in truck applications. How to test: Measure resistance at known temperature and compare to resistance chart. Infinite resistance is open — zero ohms is shorted. Unplug the sensor and measure resistance directly at sensor terminals — if correct the fault is in the wiring or controller.

SCHEMATIC READING:
Step 1 — Find the component on the schematic using the index. Step 2 — Identify the power feed — trace wire back toward fuse panel or power source. Step 3 — Identify the ground path — trace wire to chassis ground. Step 4 — Identify switches, relays, or controllers in the circuit. Step 5 — Determine test points for multimeter probes. Wire color codes SAE standard: Black ground — Red battery positive or ignition switched — Orange battery direct unfused — Yellow headlights or caution — Green turn signals — Brown taillights — Blue accessory. Always refer to the specific vehicle wiring diagram rather than assuming colors. Connectors shown from wire side not mating face unless noted. Use a back probe or T-pin to probe a connector — never force a multimeter probe into a sealed connector.

FAULT TRACING METHODOLOGY:
THE FOUR TYPES: 1. Open circuit — wire broken or disconnected — component does not work at all. 2. Short to ground — wire touching chassis metal — fuse blows. 3. Short to power — wire touching another powered wire — component may work when it should not. 4. High resistance — corroded connection — component works poorly or intermittently — hardest to find.
SEQUENCE: 1. Verify the complaint. 2. Check fault codes — they direct you to the circuit. 3. Check power and ground at the component first. 4. Voltage drop test all connections. 5. Wiggle test — wiggle harness while monitoring. 6. Isolate fault — disconnect components one at a time.
VOLTAGE DROP TESTING — THE MOST IMPORTANT TEST MOST TECHS NEVER DO: Connect multimeter across the connection with the circuit operating under load. Good reads less than 0.1V. Bad reads more than 0.3V. Finds high resistance connections that pass ohm testing but fail under load.
FINDING A SHORT TO GROUND: Remove fuse — connect test light or continuity meter between fuse terminals — disconnect loads one at a time — when test light goes out the last load disconnected contains the short.
FINDING AN OPEN: Use half split method — test midpoint of circuit — power present means open is between midpoint and load — power absent means open is between source and midpoint.
INTERMITTENT FAULTS: Try to make the fault appear — wiggle harness, flex connectors, apply heat or cold. Look for chafed wiring where harness contacts metal edges — most common cause of intermittent shorts. Look for spread or backed out connector pins — most common cause of intermittent opens.

MULTIMETER GUIDE:
DC VOLTAGE — most used: Red probe to positive — black probe to ground. Battery: 12.4V to 12.7V at rest. Charging: 13.8V to 14.4V running.
AC VOLTAGE: Alternator ripple test — more than 0.5V AC at battery with engine running means failed alternator diode. Wheel speed sensor — spin wheel by hand — should read 0.5V to 2.0V AC.
RESISTANCE: Always test with circuit unpowered. Zero ohms means short or good continuity. OL means open circuit.
CONTINUITY — beep: Quick check for open circuits and ground connections.
DIODE TEST: Forward biased 0.4 to 0.7V — good. Reverse biased OL — good. Reads same both ways — failed diode.
MIN MAX FUNCTION: Records minimum and maximum during test period — use for catching intermittent voltage drops — set to min max and wiggle harness — captures dropout even if only a millisecond.
CLAMP METER: Measures current without breaking the circuit — clamp around a single wire — use for confirming correct current draw or finding parasitic draw.

WIRE REPAIR:
Never splice by twisting and taping — number one cause of future electrical problems. Always use heat shrink butt connectors — proper crimp — apply heat until adhesive flows — waterproof and secure. Match wire gauge — never use smaller gauge than original — causes heat buildup and fire risk. Route repaired wire away from heat sources and sharp edges — secure with zip ties every 6 to 8 inches. Connector repair: spread pins repaired with pick tool — corroded pins cleaned with contact cleaner and dielectric grease on reassembly. Chafe repair: repair the wire AND protect from future chafing — use split loom or spiral wrap — secure away from the chafe point. Fusible link: replace with same gauge and type — never replace with regular wire — always find why it blew first.

DIELECTRIC GREASE — MANDATORY: Apply dielectric grease to ALL electrical connectors during reassembly. A single tube of dielectric grease prevents more nuisance callbacks than most parts replacements. Every connector you touch during diagnosis — not just the failed component.

GOLDEN RULE OF ELECTRICAL DIAGNOSIS: Never replace a component until you have proven with your multimeter that the component has failed. Parts cannon approach costs the customer money and does not build your reputation.

Respond in plain text only. No JSON. No code blocks. No markdown. Use these exact section headers followed by a colon on their own line:

ALARM MEANING:
MOST LIKELY CAUSES:
DIAGNOSTIC STEPS:
COMMON FIX:
PARTS NEEDED:
SAFETY WARNINGS:
PM NOTE:

Write your response under each header. Use numbered lists (1. 2. 3.) under MOST LIKELY CAUSES and DIAGNOSTIC STEPS. Use plain sentences under all other headers. If a section has no relevant content write None. Keep each entry concise. Under ALARM MEANING describe what the tech asked about and why it matters. Under MOST LIKELY CAUSES list the most probable answers or causes ranked by likelihood.`

// ─── Fallback analysis when AI is unavailable ────────────────────────────────

const FALLBACK_ANALYSIS = `ALARM MEANING:
Diagnostic service temporarily unavailable. Please consult the official operator manual for this alarm code.

DIAGNOSTIC STEPS:
1. Consult the official Thermo King or Carrier Transicold operator manual for this alarm code
2. Contact your authorized service dealer for assistance

SAFETY WARNINGS:
Do not operate a unit with an unresolved immediate-action alarm.`

// ─── Web Search Directive ─────────────────────────────────────────────────────
// Prepended to SYSTEM_PROMPT for the reefer branch so unverified alarm codes are
// researched via web search instead of guessed. The full field knowledge base
// (SYSTEM_PROMPT) is retained below it for verified codes and symptom queries.

const WEB_SEARCH_DIRECTIVE = `You are an expert transport refrigeration diagnostic assistant specializing in Thermo King and Carrier Transicold units. You have access to web search — always search for the specific alarm code and unit model before answering.

When answering about an alarm code provide:
- What the code means with exact display text
- Severity level — shutdown warning or check
- Common causes in order of likelihood
- Diagnostic steps in field order
- Labor time estimate
- Any cross-reference to the other brand

Always search first. Never guess. If you cannot find verified information for this specific code say clearly: This alarm code could not be verified through available sources. Please consult your Carrier or TK dealer for this specific code.

A wrong answer costs the tech time and money. Accuracy is more important than always having an answer.`

// ─── Verified DB Analysis Builder ──────────────────────────────────────────────
// hd_alarm_codes holds human-verified, curated alarm-code content. When a code
// has an entry there it is authoritative — we render it directly (formatted into
// the page's section headers) so a verified code NEVER falls through to AI
// placeholder text, even if the AI call fails or times out.

interface VerifiedAlarmRow {
  meaning:          string
  common_causes:    string | null
  diagnostic_steps: string | null
  common_fix:       string | null
  field_notes:      string | null
  safety_warning:   string | null
  parts_needed:     string | null
  book_time:        number | null
  mobile_time:      number | null
  unit_family:      string
  alarm_code:       string | null
}

function buildVerifiedAnalysis(e: VerifiedAlarmRow): string {
  const sections: string[] = [`ALARM MEANING:\n${e.meaning}`]
  if (e.common_causes?.trim())    sections.push(`MOST LIKELY CAUSES:\n${e.common_causes.trim()}`)
  if (e.diagnostic_steps?.trim()) sections.push(`DIAGNOSTIC STEPS:\n${e.diagnostic_steps.trim()}`)
  if (e.common_fix?.trim())       sections.push(`COMMON FIX:\n${e.common_fix.trim()}`)
  if (e.parts_needed?.trim() && e.parts_needed.trim().toLowerCase() !== 'none')
    sections.push(`PARTS NEEDED:\n${e.parts_needed.trim()}`)

  const safety = [
    e.safety_warning?.trim() || null,
    e.field_notes?.trim() ? `Field note: ${e.field_notes.trim()}` : null,
  ].filter(Boolean).join('\n\n')
  if (safety) sections.push(`SAFETY WARNINGS:\n${safety}`)

  let out = sections.join('\n\n')
  if (e.book_time != null || e.mobile_time != null) {
    const book   = e.book_time   != null ? `${e.book_time}`   : 'see notes'
    const mobile = e.mobile_time != null ? `${e.mobile_time}` : 'see notes'
    out += `\n\nBook Time: ${book} hours\nMobile Field Time: ${mobile} hours`
  }
  return out
}

// Code may be entered as "28", "08", "8" — match the common variants in the DB.
function alarmCodeCandidates(code: string): string[] {
  const raw = code.trim()
  const set = new Set<string>([raw, raw.toUpperCase()])
  if (/^\d+$/.test(raw)) {
    set.add(raw.padStart(2, '0'))
    set.add(String(parseInt(raw, 10)))
  }
  return [...set]
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

  let body: {
    mode?: 'reefer' | 'truck' | 'electrical'
    // reefer fields
    manufacturer?: string
    model?: string
    unitType?: string
    alarmCode?: string
    additionalAlarmCodes?: string[]
    symptom?: string
    serialNumber?: string
    display_message?: string
    // truck fields
    truckBrand?: string
    engineModel?: string
    spn?: string
    fmi?: string
    vehicleYear?: string
    vehicleMake?: string
    vehicleModel?: string
    vehicleEngine?: string
    // electrical fields
    topic?: string
    question?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const mode = body.mode ?? 'reefer'

  // ── Electrical branch ────────────────────────────────────────────────────
  if (mode === 'electrical') {
    const { topic, question } = body
    if (!question?.trim()) {
      return NextResponse.json({ error: 'question required' }, { status: 400 })
    }
    const userPrompt = [
      topic ? `Topic: ${topic}` : null,
      `Question: ${question.trim()}`,
    ].filter(Boolean).join('\n')

    try {
      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system:     ELECTRICAL_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userPrompt }],
      })
      const analysis = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n')
        .trim()
      console.log('[quickwrench/electrical] stop_reason:', msg.stop_reason, 'tokens:', JSON.stringify(msg.usage))
      return NextResponse.json({ analysis, tk_sources: [], alarm_pattern: null, disclaimer: null })
    } catch (err) {
      console.error('[hd/quickwrench] Electrical AI call failed', err)
      return NextResponse.json({
        analysis: `ALARM MEANING:\nDiagnostic service temporarily unavailable. Please try again.\n\nDIAGNOSTIC STEPS:\n1. Retry your question\n2. Check your internet connection`,
        tk_sources: [], alarm_pattern: null, disclaimer: null,
      })
    }
  }

  // ── Truck engine branch ───────────────────────────────────────────────────
  // Moved to its own route — /api/hd/truck-diagnostic — for an independent,
  // longer maxDuration. Kept as a safety net for any old client still posting
  // mode:'truck' here; 308 preserves the POST + body on redirect.
  if (mode === 'truck') {
    return NextResponse.json(
      { error: 'Truck engine diagnostics moved to /api/hd/truck-diagnostic' },
      { status: 308, headers: { Location: '/api/hd/truck-diagnostic' } },
    )
  }

  // ── Reefer branch ─────────────────────────────────────────────────────────
  const { manufacturer, model, unitType, alarmCode, symptom } = body
  if (!manufacturer || !model) {
    return NextResponse.json({ error: 'manufacturer and model required' }, { status: 400 })
  }
  if (!alarmCode && !symptom) {
    return NextResponse.json({ error: 'alarmCode or symptom required' }, { status: 400 })
  }

  // Collect all alarm codes submitted
  const allCodes = [alarmCode, ...(body.additionalAlarmCodes ?? [])]
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .map(c => c.trim())

  // Look up each code in the appropriate alarm database
  const alarmSources = manufacturer === 'Thermo King'
    ? allCodes
        .map(code => {
          const found = lookupTKCode(code)
          return found ? { code, description: found.description, severity: found.severity, operatorAction: found.operatorAction, source: found.source } : null
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
    : manufacturer === 'Carrier Transicold'
    ? allCodes
        .map(code => {
          const found = lookupCarrierCode(code)
          return found ? { code, description: found.description, severity: found.severity, operatorAction: found.operatorAction, source: found.source } : null
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
    : []

  // Multi-alarm cross reference (TK only — no Carrier relationship map yet)
  const alarmPattern = allCodes.length >= 2 ? lookupPattern(allCodes) : null

  // ── Verified DB lookup (authoritative) ──
  // If the primary submitted code has a curated entry in hd_alarm_codes, that
  // content is used directly. The diagnostic-form manufacturer uses full names;
  // the table stores 'TK' / 'Carrier'.
  const dbManufacturer = manufacturer === 'Thermo King' ? 'TK'
    : manufacturer === 'Carrier Transicold' ? 'Carrier'
    : null

  let verifiedEntry: VerifiedAlarmRow | null = null
  if (dbManufacturer && allCodes.length > 0) {
    const { data: rows, error: dbErr } = await supabase
      .from('hd_alarm_codes')
      .select('meaning, common_causes, diagnostic_steps, common_fix, field_notes, safety_warning, parts_needed, book_time, mobile_time, unit_family, alarm_code')
      .eq('manufacturer', dbManufacturer)
      .in('alarm_code', alarmCodeCandidates(allCodes[0]))
      .limit(10)

    if (dbErr) console.error('[hd/quickwrench] hd_alarm_codes lookup failed', dbErr)
    if (rows && rows.length > 0) {
      const m = model?.toLowerCase() ?? ''
      verifiedEntry = (rows.find(r =>
        m && r.unit_family && (m.includes(r.unit_family.toLowerCase()) || r.unit_family.toLowerCase().includes(m))
      ) ?? rows[0]) as VerifiedAlarmRow
    }
  }

  // For a single verified code, DB content is sufficient — skip the AI call
  // entirely (faster, and immune to AI/web-search failure).
  const useVerifiedOnly = !!verifiedEntry && allCodes.length === 1

  // Attach verified labor times (from hd_alarm_codes) to the primary tk_sources
  // entry so the client Push-to-Quote can use real book/mobile hours. Fields are
  // null when no verified DB entry matched the primary code.
  const responseSources = alarmSources.map((s, i) => ({
    ...s,
    book_time:   (i === 0 && verifiedEntry) ? verifiedEntry.book_time   : null,
    mobile_time: (i === 0 && verifiedEntry) ? verifiedEntry.mobile_time : null,
  }))

  const disclaimer = manufacturer === 'Carrier Transicold' ? CARRIER_DISCLAIMER : TK_DISCLAIMER

  // ── Response cache (alarm-code keyed) ──────────────────────────────────────
  // Cache only when the answer is a pure function of (manufacturer, model,
  // single alarm code): no free-text symptom, no multi-alarm query, and no
  // verified DB entry (those are authoritative and already instant). Keeping
  // the key faithful to the inputs means a hit can never return a mismatched
  // answer.
  const displayMessage = typeof body.display_message === 'string' ? body.display_message.trim() : ''
  const primaryAlarm = alarmCode?.trim() ?? ''
  const unitModel    = model?.trim() ?? ''
  const cacheable    = primaryAlarm.length > 0 && allCodes.length === 1 && !(symptom?.trim()) && !useVerifiedOnly
  // Different display messages for the same code get separate cache entries.
  // Slug: lowercase, non-alphanumerics → hyphens, trimmed, max 30 chars.
  const displaySlug  = displayMessage
    ? '-' + displayMessage.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
    : ''
  const cacheKey     = (unitModel
    ? `reefer-${manufacturer}-${unitModel}-${primaryAlarm}`
    : `reefer-${manufacturer}-${primaryAlarm}`) + displaySlug
  const cacheSource  = unitModel ? 'ai_web_search' : 'ai_web_search_nomodel'

  if (cacheable) {
    const { data: cached } = await supabase
      .from('hd_cached_diagnostics')
      .select('result_html, citations')
      .eq('cache_key', cacheKey)
      .maybeSingle()
    if (cached?.result_html) {
      // Hit — return cached result with NO API call (never touches Gemini).
      // Increment the hit counter atomically (single UPDATE) via the service
      // client (no user write policy).
      try {
        await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey })
      } catch (e) {
        console.error('[hd/quickwrench] cache hit increment failed', e)
      }
      const hitStatus = /could not find alarm code|could not be verified/i.test(cached.result_html)
        ? 'unverified'
        : alarmSources.length > 0 ? 'verified' : 'ai'
      return NextResponse.json({
        analysis:      cached.result_html,
        tk_sources:    responseSources,
        alarm_pattern: alarmPattern,
        disclaimer,
        code_status:   hitStatus,
        citations:     cached.citations ?? [],
        cached:        true,
      })
    }
  }

  const userPrompt = buildUserPrompt({
    manufacturer, model, unitType, allCodes,
    symptom, serialNumber: body.serialNumber, displayMessage,
    alarmSources, alarmPattern,
  })

  // Alarm → parts category lookup (only for Thermo King — we have TK code→category mapping)
  const partsCategories = manufacturer === 'Thermo King' ? categoriesToFetchForCodes(allCodes) : []

  // Run AI call + parts DB query in parallel
  const [aiResult, partsResult] = await Promise.allSettled([
    (async (): Promise<{ text: string; citations: string[]; source: string } | null> => {
      // Verified DB content will be used — no need to call any model.
      if (useVerifiedOnly) return null

      const client = new Anthropic({ apiKey })

      // Primary: Gemini 2.5 Flash with Google Search grounding does the thinking
      // + search, then Haiku reshapes it into our standard section structure.
      try {
        const { text: rawText, citations } = await generateDiagnostic(
          userPrompt,
          `${WEB_SEARCH_DIRECTIVE}\n\n${SYSTEM_PROMPT}`,
        )
        if (rawText.trim()) {
          const formatted = await formatDiagnostic(rawText, {
            manufacturer, model, alarmCode: primaryAlarm,
          })
          return { text: formatted.trim(), citations, source: 'gemini_web_search' }
        }
      } catch (gemErr) {
        console.error('[hd/quickwrench] Gemini failed — falling back to Haiku', gemErr)
      }

      // Fallback: a plain Haiku call (no grounding) so a Gemini outage still
      // returns a usable answer.
      try {
        const msg = await client.messages.create(
          {
            model:      'claude-haiku-4-5-20251001',
            max_tokens: 1500,
            system:     SYSTEM_PROMPT,
            messages:   [{ role: 'user', content: userPrompt }],
          },
          { timeout: 18_000, maxRetries: 0 },
        )
        const t = msg.content
          .filter(b => b.type === 'text')
          .map(b => (b as Anthropic.TextBlock).text)
          .join('\n')
          .trim()
        return { text: t, citations: [], source: cacheSource }
      } catch (err) {
        console.error('[hd/quickwrench] Haiku fallback failed', err)
        return null
      }
    })(),
    (async () => {
      if (partsCategories.length === 0) return []
      // No model selected — don't query; the UI prompts the tech to pick one.
      if (!model) return []
      // Strict model match: only parts whose unit_models array contains the
      // exact selected model. Showing the wrong belt for the wrong unit is a
      // critical failure, so universal/unscoped parts are intentionally excluded.
      const { data } = await supabase
        .from('hd_parts')
        .select('part_number, description, category, unit_models, notes, field_critical')
        .eq('manufacturer', manufacturer)
        .in('category', partsCategories)
        .contains('unit_models', [model])
        .limit(12)
      return data ?? []
    })(),
  ])

  // Extract the normalized AI result ({ text, citations, source }) — the call
  // may have been skipped (verified-only) or failed entirely.
  let aiText = ''
  let aiCitations: string[] = []
  let aiSource = cacheSource
  if (aiResult.status === 'fulfilled' && aiResult.value) {
    aiText      = aiResult.value.text.trim()
    aiCitations = aiResult.value.citations
    aiSource    = aiResult.value.source
  } else if (aiResult.status === 'rejected') {
    console.error('[hd/quickwrench] AI call failed', aiResult.reason)
  }
  const aiUsable = aiText.length > 0 && aiText !== FALLBACK_ANALYSIS

  // Build analysis — verified DB content is authoritative and is NEVER replaced
  // by the AI placeholder. AI text is used for codes/symptoms without a curated
  // entry (and as the richer source on multi-alarm queries when it succeeds).
  let analysis: string
  let codeStatus: 'verified' | 'ai' | 'unverified'
  if (verifiedEntry && (allCodes.length === 1 || !aiUsable)) {
    analysis   = buildVerifiedAnalysis(verifiedEntry)
    codeStatus = 'verified'
  } else if (aiUsable) {
    analysis   = aiText
    codeStatus = (alarmSources.length > 0 || verifiedEntry) ? 'verified' : 'ai'
  } else {
    analysis   = verifiedEntry ? buildVerifiedAnalysis(verifiedEntry) : FALLBACK_ANALYSIS
    codeStatus = verifiedEntry ? 'verified' : 'ai'
  }

  // Append PARTS REFERENCE section — strictly model-specific.
  // Shown only for alarm codes that map to part categories. The parts are
  // already filtered to the selected model + manufacturer at the query level.
  if (partsCategories.length > 0) {
    const header = `\nPARTS REFERENCE — ${manufacturer}${model ? ` ${model}` : ''}`
    let partsSection: string

    if (!model) {
      // No model selected — never dump all parts; prompt the tech to pick one.
      partsSection = [
        header,
        'Select a unit model above to see model-specific parts for this repair.',
      ].join('\n')
    } else {
      const parts = partsResult.status === 'fulfilled'
        ? partsResult.value as Array<{
            part_number: string; description: string; category: string
            unit_models: string[]; notes?: string; field_critical: boolean
          }>
        : []

      if (parts.length === 0) {
        partsSection = [
          header,
          'No parts on file for this model yet. Contact NWI support or verify part numbers with your dealer.',
        ].join('\n')
      } else {
        partsSection = [
          header,
          ...parts.map(p =>
            `Part Number: ${p.part_number} — ${p.description}${p.field_critical ? ' [FIELD CRITICAL]' : ''}${p.notes ? ` — ${p.notes}` : ''}`
          ),
          'Note: Part numbers are reference only. Verify fitment before ordering. Always replace superseded part numbers with current replacement.',
        ].join('\n')
      }
    }

    analysis = analysis + partsSection
  }

  // Provenance refinement: only when this is NOT a verified entry and the AI
  // (with web search) reported it could not verify the code, show a structured
  // "double-check the code" message rather than jumping straight to the dealer.
  if (
    codeStatus !== 'verified' &&
    !verifiedEntry &&
    alarmSources.length === 0 &&
    allCodes.length > 0 &&
    /could not be verified/i.test(analysis)
  ) {
    codeStatus = 'unverified'
    const codeLabel = allCodes.join(', ')
    analysis = `We could not find alarm code ${codeLabel} in our database or through web search.

Before contacting your dealer please verify:
• Is this the exact code shown on your display panel?
• Check for typos — for example 0 vs O, 1 vs I, 5 vs S
• Some codes are model-specific — confirm your unit model and controller type

If the code is confirmed correct and you cannot find information — contact your TK or Carrier dealer with your unit serial number and the exact code displayed.`
  }

  // Cache genuine AI diagnostics so repeat lookups skip the web-search call.
  // Never cache the placeholder, an unverified "could not find" result, or a
  // verified-DB path (cacheable already excludes the verified path).
  if (cacheable && aiUsable && codeStatus !== 'unverified' && analysis !== FALLBACK_ANALYSIS) {
    try {
      const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
        cache_key:    cacheKey,
        manufacturer: dbManufacturer ?? manufacturer,
        alarm_code:   primaryAlarm,
        unit_model:   unitModel || null,
        result_html:  analysis,
        source:       aiSource,
        citations:    aiCitations,
        needs_review: detectsHazard(analysis),
      }, { onConflict: 'cache_key' })
      if (cacheErr) {
        console.error('[hd/quickwrench] cache write failed', cacheErr)
      } else {
        // New cache write succeeded — notify founders after the response is sent
        // so the tech never waits on the email.
        after(() => sendNewCacheAlert({
          manufacturer:   dbManufacturer ?? manufacturer,
          unitModel:      unitModel || '—',
          alarmCode:      primaryAlarm,
          displayMessage,
          cacheKey,
          source:         aiSource,
        }))
      }
    } catch (e) {
      console.error('[hd/quickwrench] cache write failed', e)
    }
  }

  return NextResponse.json({
    analysis,
    tk_sources:    responseSources,
    alarm_pattern: alarmPattern,
    disclaimer,
    code_status:   codeStatus,
    citations:     aiCitations,
  })

  } catch (err) {
    console.error('[hd/quickwrench] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })
  }
}
