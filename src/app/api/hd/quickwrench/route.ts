import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
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

export const maxDuration = 45

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
  manufacturer:  string
  model:         string
  unitType?:     string
  allCodes:      string[]
  symptom?:      string
  serialNumber?: string
  alarmSources:  Array<{ code: string; description: string; severity: string; operatorAction: string; source: string }>
  alarmPattern:  AlarmRelationship | null
}

function buildUserPrompt({
  manufacturer, model, unitType, allCodes, symptom, serialNumber, alarmSources, alarmPattern,
}: BuildUserPromptParams): string {
  const parts: (string | null)[] = [
    `Unit: ${manufacturer} ${model} (${unitType ?? 'unknown type'})`,
    allCodes.length > 0 ? `Alarm Code(s): ${allCodes.join(', ')}` : null,
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

// ─── Truck Engine System Prompt ──────────────────────────────────────────────

const TRUCK_DISCLAIMER = "Truck engine diagnostics reference SAE J1939 standard and OEM documentation. Always verify fault codes using OEM diagnostic software — Cummins Insite, Detroit Diesel DiagnosticLink, or Mercedes-Benz Xentry. Fault code definitions and repair procedures vary by engine software version."

const TRUCK_SYSTEM_PROMPT = `You are an expert heavy duty diesel technician with deep knowledge of Cummins, Detroit Diesel, and Mercedes-Benz truck engines. You specialize in fault code diagnostics using J1939 SPN and FMI codes. When a technician provides an SPN and FMI code you identify the exact fault, explain what system is affected and how it failed based on the FMI, provide ranked probable causes from most to least common in real world field conditions, provide step by step diagnostic procedure starting with battery and charging system verification, identify common fixes with estimated repair time, list parts typically needed, and flag any safety or emissions compliance implications. Always start electrical diagnosis with battery load test — static voltage 12.4 to 12.7V minimum, charging voltage 13.8 to 14.4V, CCA minimum 800. For emissions related codes always note if the fault will trigger a derate or shutdown condition and at what threshold. For DPF related codes always note regen requirements and ash cleaning intervals. Never guess — if a specific SPN is not in your training data say so clearly and direct the tech to the OEM diagnostic software.

ELECTRICAL DIAGNOSTIC RULE — applies to every electrical fault (alternator, solenoid, controller, sensor, CAN, motor, relay, circuit):
Step 1 is ALWAYS a battery load test before any other diagnosis.
- Static voltage: 12.4–12.7V minimum. Charging voltage: 13.8–14.4V with engine running.
- CCA: 800 minimum. Below 800 CCA: replace immediately.
- If voltage below 10.5V DC: stop. Confirm or replace battery before proceeding.
- A weak battery causes false electrical faults, CAN errors, sensor faults, solenoid failures — battery replacement often resolves them without further diagnosis.
Always list battery check as the first diagnostic step.

Respond in plain text only. No JSON. No code blocks. No markdown. Use these exact section headers followed by a colon on their own line:

ALARM MEANING:
MOST LIKELY CAUSES:
DIAGNOSTIC STEPS:
COMMON FIX:
PARTS NEEDED:
SAFETY WARNINGS:
PM NOTE:

Write your response under each header. Use numbered lists (1. 2. 3.) under MOST LIKELY CAUSES and DIAGNOSTIC STEPS. Use plain sentences under all other headers. If a section has no relevant content write None. Keep each entry concise.`

const TRUCK_FALLBACK_ANALYSIS = `ALARM MEANING:
Diagnostic service temporarily unavailable. Please consult OEM diagnostic software for this fault code.

DIAGNOSTIC STEPS:
1. Use Cummins Insite, Detroit Diesel DiagnosticLink, or Mercedes-Benz Xentry to read active fault codes
2. Contact your authorized dealer for assistance

SAFETY WARNINGS:
Do not operate a vehicle with an active derate or shutdown fault condition.`

// ─── Fallback analysis when AI is unavailable ────────────────────────────────

const FALLBACK_ANALYSIS = `ALARM MEANING:
Diagnostic service temporarily unavailable. Please consult the official operator manual for this alarm code.

DIAGNOSTIC STEPS:
1. Consult the official Thermo King or Carrier Transicold operator manual for this alarm code
2. Contact your authorized service dealer for assistance

SAFETY WARNINGS:
Do not operate a unit with an unresolved immediate-action alarm.`

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
    mode?: 'reefer' | 'truck'
    // reefer fields
    manufacturer?: string
    model?: string
    unitType?: string
    alarmCode?: string
    additionalAlarmCodes?: string[]
    symptom?: string
    serialNumber?: string
    // truck fields
    truckBrand?: string
    engineModel?: string
    spn?: string
    fmi?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const mode = body.mode ?? 'reefer'

  // ── Truck engine branch ───────────────────────────────────────────────────
  if (mode === 'truck') {
    const { truckBrand, engineModel, spn, fmi, symptom: truckSymptom } = body
    if (!truckBrand || !engineModel) {
      return NextResponse.json({ error: 'truckBrand and engineModel required' }, { status: 400 })
    }
    if (!spn && !fmi && !truckSymptom) {
      return NextResponse.json({ error: 'SPN, FMI, or symptom required' }, { status: 400 })
    }

    const parts: string[] = [`Engine: ${truckBrand} ${engineModel}`]
    if (spn)          parts.push(`SPN (Suspect Parameter Number): ${spn}`)
    if (fmi !== undefined && fmi !== '') parts.push(`FMI (Failure Mode Identifier): ${fmi}`)
    if (truckSymptom) parts.push(`Symptom/Question: ${truckSymptom}`)
    const truckUserPrompt = parts.join('\n')

    try {
      const client = new Anthropic({ apiKey })
      const msg = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1500,
        system:     TRUCK_SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: truckUserPrompt }],
      })
      const analysis = msg.content
        .filter(b => b.type === 'text')
        .map(b => (b as Anthropic.TextBlock).text)
        .join('\n')
        .trim()
      console.log('[quickwrench/truck] stop_reason:', msg.stop_reason, 'tokens:', JSON.stringify(msg.usage))
      return NextResponse.json({ analysis, tk_sources: [], alarm_pattern: null, disclaimer: TRUCK_DISCLAIMER })
    } catch (err) {
      console.error('[hd/quickwrench] Truck AI call failed', err)
      return NextResponse.json({ analysis: TRUCK_FALLBACK_ANALYSIS, tk_sources: [], alarm_pattern: null, disclaimer: TRUCK_DISCLAIMER })
    }
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

  const userPrompt = buildUserPrompt({
    manufacturer, model, unitType, allCodes,
    symptom, serialNumber: body.serialNumber,
    alarmSources, alarmPattern,
  })

  const disclaimer = manufacturer === 'Carrier Transicold' ? CARRIER_DISCLAIMER : TK_DISCLAIMER

  // Alarm → parts category lookup (only for Thermo King — we have TK code→category mapping)
  const partsCategories = manufacturer === 'Thermo King' ? categoriesToFetchForCodes(allCodes) : []

  // Run AI call + parts DB query in parallel
  const [aiResult, partsResult] = await Promise.allSettled([
    (async () => {
      const client = new Anthropic({ apiKey })
      return client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 1500,
        system:     SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      })
    })(),
    (async () => {
      if (partsCategories.length === 0) return []
      const { data } = await supabase
        .from('hd_parts')
        .select('part_number, description, category, unit_models, notes, field_critical')
        .eq('manufacturer', manufacturer)
        .in('category', partsCategories)
        .limit(12)
      return data ?? []
    })(),
  ])

  // Build analysis string
  let analysis: string
  if (aiResult.status === 'fulfilled') {
    const msg = aiResult.value
    analysis = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()
    console.log('[quickwrench] stop_reason:', msg.stop_reason, 'tokens:', JSON.stringify(msg.usage))
  } else {
    console.error('[hd/quickwrench] AI call failed', aiResult.reason)
    analysis = FALLBACK_ANALYSIS
  }

  // Append PARTS REFERENCE section if parts were found
  if (partsResult.status === 'fulfilled') {
    const parts = partsResult.value as Array<{
      part_number: string; description: string; category: string
      unit_models: string[]; notes?: string; field_critical: boolean
    }>

    if (parts.length > 0) {
      const relevantParts = model
        ? parts.filter(p => p.unit_models.length === 0 || p.unit_models.includes(model))
        : parts

      const toShow = relevantParts.length > 0 ? relevantParts : parts.slice(0, 8)

      if (toShow.length > 0) {
        const partsSection = [
          `\nPARTS REFERENCE — ${manufacturer} ${model}`,
          ...toShow.map(p =>
            `Part Number: ${p.part_number} — ${p.description}${p.field_critical ? ' [FIELD CRITICAL]' : ''}${p.notes ? ` — ${p.notes}` : ''}`
          ),
          'Note: Part numbers are reference only. Verify fitment before ordering. Always replace superseded part numbers with current replacement.',
        ].join('\n')

        analysis = analysis + partsSection
      }
    }
  }

  return NextResponse.json({
    analysis,
    tk_sources:    alarmSources,
    alarm_pattern: alarmPattern,
    disclaimer,
  })

  } catch (err) {
    console.error('[hd/quickwrench] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })
  }
}
