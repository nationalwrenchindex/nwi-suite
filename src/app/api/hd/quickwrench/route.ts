import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
import { type TKSeverity, type TKAlarmEntry, TK_ALARM_CODES, TK_DSR_ALARM_CODES, TK_DISCLAIMER } from '@/lib/hd/alarm-codes'

export const maxDuration = 45

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
  tkSources:     Array<{ code: string; description: string; severity: string; operatorAction: string; source: string }>
  alarmPattern:  AlarmRelationship | null
}

function buildUserPrompt({
  manufacturer, model, unitType, allCodes, symptom, serialNumber, tkSources, alarmPattern,
}: BuildUserPromptParams): string {
  const parts: (string | null)[] = [
    `Unit: ${manufacturer} ${model} (${unitType ?? 'unknown type'})`,
    allCodes.length > 0 ? `Alarm Code(s): ${allCodes.join(', ')}` : null,
    symptom      ? `Symptom/Question: ${symptom}` : null,
    serialNumber ? `Serial Number: ${serialNumber}` : null,
  ]

  // Inject definitions: start with entered codes, then add companion codes from
  // the cross-reference pattern up to a cap of 5 definitions total.
  const defsToShow: typeof tkSources = [...tkSources]

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
    parts.push('\nOFFICIAL TK DEFINITIONS (TK 40933-8-CH Rev 15):')
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
    manufacturer?: string
    model?: string
    unitType?: string
    alarmCode?: string
    additionalAlarmCodes?: string[]
    symptom?: string
    serialNumber?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

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

  // Look up each code in TK DB (Thermo King only)
  const tkSources = manufacturer === 'Thermo King'
    ? allCodes
        .map(code => {
          const found = lookupTKCode(code)
          return found ? { code, description: found.description, severity: found.severity, operatorAction: found.operatorAction, source: found.source } : null
        })
        .filter((s): s is NonNullable<typeof s> => s !== null)
    : []

  // Multi-alarm cross reference
  const alarmPattern = allCodes.length >= 2 ? lookupPattern(allCodes) : null

  const userPrompt = buildUserPrompt({
    manufacturer, model, unitType, allCodes,
    symptom, serialNumber: body.serialNumber,
    tkSources, alarmPattern,
  })

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const analysis = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()

    console.log('[quickwrench] stop_reason:', msg.stop_reason, 'tokens:', JSON.stringify(msg.usage))
    console.log('[quickwrench] analysis length:', analysis.length)
    console.log('[quickwrench] analysis:', analysis)

    return NextResponse.json({
      analysis,
      tk_sources:    tkSources,
      alarm_pattern: alarmPattern,
      disclaimer:    TK_DISCLAIMER,
    })
  } catch (err) {
    console.error('[hd/quickwrench] AI call failed', err)
    return NextResponse.json({
      analysis:      FALLBACK_ANALYSIS,
      tk_sources:    tkSources,
      alarm_pattern: alarmPattern,
      disclaimer:    TK_DISCLAIMER,
    })
  }

  } catch (err) {
    console.error('[hd/quickwrench] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 })
  }
}
