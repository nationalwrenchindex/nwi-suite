import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import { generateText, isGeminiConfigured } from '@/lib/gemini/client'
import { ABS_GEMINI_SYSTEM_PROMPT } from '@/lib/hd/trailer/abs-gemini-prompt'
import {
  ABS_FAULT_CATEGORIES,
  classifyABSFault,
  resolveABSLabor,
  type ABSLaborEntry,
} from '@/lib/hd/trailer/abs-labor'

// Trailer ABS diagnostic for HD QuickWrench.
//
// This route is different in kind from the reefer and truck diagnostics next to it. A
// wrong answer about a reefer alarm wastes a tech's afternoon. A wrong answer about
// trailer ABS puts a brake system that FMVSS 121 mandates back on the road in a state
// the tech believes is fixed. Every design decision below follows from that:
//
//   - It never guesses. Low model confidence, an unknown ECU generation, or a response
//     it cannot parse all produce a clarification question, not a diagnosis.
//   - It never fabricates to fill a gap. A model outage returns a documented fallback
//     pointing at the manufacturer literature and the ECU decal — not a plausible
//     sounding fault description generated from nothing.
//   - It never invents money. Labor comes from a hand-owned table (./abs-labor), and
//     parts come from the database behind a hard gate (see PARTS SUGGESTIONS below).
//
// Same 60s ceiling as the other AI routes: the shared Gemini client gives up at 55s,
// which has to fit inside the platform's function limit with room to write the log row.
export const maxDuration = 60

// ─── Request / Response contract ──────────────────────────────────────────────

const MANUFACTURERS = ['wabco', 'bendix', 'haldex'] as const
type ABSManufacturer = (typeof MANUFACTURERS)[number]

function isManufacturer(v: unknown): v is ABSManufacturer {
  return typeof v === 'string' && (MANUFACTURERS as readonly string[]).includes(v.trim().toLowerCase())
}

interface ABSPartSuggestion {
  oem_part_number: string | null
  part_function:   string
  part_category:   string
  manufacturer:    string
}

interface ABSDiagnosticResponse {
  fault_description:      string
  diagnostic_steps:       string[]
  specs_to_check:         string[]
  tools_needed:           string[]
  clarification_needed:   boolean
  clarification_question: string | null
  parts_suggestions:      ABSPartSuggestion[]
  labor_estimate:         ABSLaborEntry | null
}

const FEATURE = 'trailer_abs_diagnostic'
const MODEL_ID_FOR_LOG = 'gemini-3.6-flash'   // mirrors src/lib/gemini/client.ts

// ─── Rate limit ───────────────────────────────────────────────────────────────
//
// 10 requests per minute per user, sliding window, held in a Map in this process.
//
// HONEST LIMITATION — READ BEFORE RELYING ON THIS: on serverless this is per-instance,
// not per-user-globally. Each warm lambda has its own Map, so a user spread across N
// concurrent instances gets roughly 10×N per minute, and every cold start resets the
// window to empty. It is therefore a COST GUARDRAIL — it stops a stuck retry loop or an
// impatient double-click from firing fifty 55-second model calls — and NOT a security
// control. It must not be treated as one. A real limit (one a determined caller cannot
// walk around by forcing new instances) has to live in shared state: Postgres, or Redis.
// The usage table this route writes to already records every request per user, so the
// data needed to enforce a durable limit is being collected as of migration 125.
const RATE_LIMIT_MAX       = 10
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_SWEEP_AT  = 5_000   // entries, before an opportunistic prune

const rateLimitHits = new Map<string, number[]>()

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSec: number } {
  const now    = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS

  // The Map only ever grows otherwise — a long-lived instance would accumulate one
  // entry per user who ever called. Sweeping only when it gets large keeps the common
  // path O(1) instead of walking every user on every request.
  if (rateLimitHits.size > RATE_LIMIT_SWEEP_AT) {
    for (const [key, stamps] of rateLimitHits) {
      if (stamps.every(t => t <= cutoff)) rateLimitHits.delete(key)
    }
  }

  const hits = (rateLimitHits.get(userId) ?? []).filter(t => t > cutoff)

  if (hits.length >= RATE_LIMIT_MAX) {
    rateLimitHits.set(userId, hits)
    const oldest = hits[0] ?? now
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000)) }
  }

  hits.push(now)
  rateLimitHits.set(userId, hits)
  return { allowed: true, retryAfterSec: 0 }
}

// ─── Usage logging ────────────────────────────────────────────────────────────

interface UsageLog {
  userId:    string
  model:     string | null
  latencyMs: number
  success:   boolean
  error:     string | null
}

// Writes one row per request to hd_quickwrench_usage (migration 125) — success AND
// failure, so cost tracking is not biased toward the happy path. A timed-out model call
// was still paid for, and a request that failed every time it was retried is exactly
// the pattern worth seeing.
//
// Uses the service-role client because the table grants SELECT only: the account being
// logged must not be able to write, edit, or delete its own usage record. A logging
// failure is swallowed — telemetry must never be the reason a tech loses a diagnostic.
async function logUsage({ userId, model, latencyMs, success, error }: UsageLog): Promise<void> {
  try {
    const { error: insertErr } = await createServiceClient()
      .from('hd_quickwrench_usage')
      .insert({
        user_id:    userId,
        feature:    FEATURE,
        model,
        // prompt_tokens / completion_tokens left unset: the shared Gemini client returns
        // text only and does not surface usageMetadata. See migration 125 — an estimate
        // written into a cost column reads later as a measurement, so NULL is honest.
        latency_ms: latencyMs,
        success,
        error,
      })
    if (insertErr) console.error('[hd/trailer-abs] usage log insert failed', insertErr)
  } catch (err) {
    console.error('[hd/trailer-abs] usage log threw', err)
  }
}

// ─── Fallback + clarification responses ───────────────────────────────────────

// What to tell the tech to read off the ECU when we will not commit to a diagnosis.
// Nothing here asserts a code meaning or a part number — deliberately. Blink code tables
// differ between ECU generations (see src/lib/hd/trailer/abs-codes.ts, which documents
// the same accuracy policy), so the only safe instruction is "read the decal on the ECU
// in front of you", never "a 1-1 means X".
const ECU_HOUSING_HINT: Record<ABSManufacturer, string> = {
  wabco:  'the ECU/valve assembly part number stamped on the WABCO (ZF) housing, and the TEBS generation printed on the housing decal',
  bendix: 'the Bendix ECU part number and model name on the housing decal, and the blink code chart printed on the ECU or inside its cover',
  haldex: 'the Haldex ECU part number and generation on the housing decal — Gen 4 and Gen 5 read different blink code tables — and the blink code decal on the ECU itself',
}

function safeSteps(manufacturer: ABSManufacturer): string[] {
  return [
    'Do not replace any ABS component based on this screen alone.',
    `Read the blink code decal on the ABS ECU housing and record ${ECU_HOUSING_HINT[manufacturer]}.`,
    'Look the code up in the manufacturer service literature for that exact ECU part number. A chart for a different ECU generation will point you at the wrong wheel end.',
    'Before chasing any component, verify ABS power and ground at the ECU and confirm the ABS circuit through the seven-way connector is intact and free of corrosion.',
    'After any ABS repair: clear codes, cycle power, confirm the trailer ABS lamp completes its self-check and goes out, and road test above 6 mph so the ECU can see all wheel speed signals.',
  ]
}

// The documented fallback. Returned with HTTP 200 — not a 500 — because a stack trace is
// useless to a tech under a trailer and an error page reads as "the app is broken" rather
// than "here is what to do instead". It contains no diagnosis, and it never will.
function fallbackResponse(manufacturer: ABSManufacturer, reason: string): ABSDiagnosticResponse {
  return {
    fault_description:      `The AI diagnostic is unavailable right now (${reason}), so no fault has been identified. Nothing on this screen is a diagnosis — diagnose this fault from the ECU decal and the manufacturer literature.`,
    diagnostic_steps:       safeSteps(manufacturer),
    specs_to_check:         [],
    tools_needed:           [],
    clarification_needed:   true,
    clarification_question: `Once you have read ${ECU_HOUSING_HINT[manufacturer]}, enter the ECU generation and the exact blink code and try again.`,
    parts_suggestions:      [],
    labor_estimate:         null,
  }
}

// ─── PARTS SUGGESTIONS ────────────────────────────────────────────────────────
//
// READ THIS BEFORE CHANGING ANYTHING BELOW.
//
// hd_parts_reference (migration 061) contains ~960 rows and every single one of them is
// a REEFER part — Thermo King and Carrier Transicold filters, belts, thermostats,
// solenoids, and refrigeration sensors and valves. It contains ZERO trailer ABS parts:
// searching it for 'modulator', 'abs', or 'ecu' returns nothing.
//
// The category names in that table are a trap. It has 38 rows categorised 'Sensor' and
// 69 categorised 'Valve' — but those are refrigeration discharge/suction pressure
// sensors and refrigeration solenoid valves. Matching an ABS fault on the word "sensor"
// or the word "valve" would put a Thermo King discharge temperature sensor on screen as
// the suggested fix for a wheel speed sensor fault on a brake system. A tech would order
// it. That is worse than showing nothing, which is why the gate below exists.
//
// So the query is written and live, but gated twice:
//   1. It only asks the database for rows whose part_function names something genuinely
//      ABS-related.
//   2. Every returned row must then pass an ABS token test AND fail a reefer token test
//      in code, so a row that squeaks past the SQL wildcard still cannot reach the tech.
//
// Today both gates combined return an empty array on every request, by design. When real
// trailer ABS parts are loaded into hd_parts_reference, this feature lights up on its own
// with no code change. Do not "fix" the empty results by loosening the gate.

// PostgREST or() filter — `*` is the wildcard inside or(), and the tokens are kept to
// single words so no value needs quoting.
const ABS_PART_FUNCTION_FILTER = [
  'part_function.ilike.*abs*',
  'part_function.ilike.*modulator*',
  'part_function.ilike.*anti-lock*',
  'part_function.ilike.*antilock*',
].join(',')

// Word-boundary \babs\b so 'absorber' and 'absolute' cannot match. Everything here names
// a trailer brake-system component, not a refrigeration one.
const ABS_TOKEN    = /\babs\b|anti-?lock|modulator|wheel[\s-]?speed\s+sensor|tone\s+ring|exciter\s+ring/i
// Belt and braces: even a row that matched an ABS token is rejected if it also smells of
// the refrigeration system, which is the only content this table currently holds.
const REEFER_TOKEN = /refriger|reefer|evaporator|condenser|compressor|suction|discharge\s+(?:pressure|temp)|defrost|coolant|thermostat|glow\s+plug|fuel|alternator|belt|oil\s+filter|air\s+filter|thermo\s*king|carrier/i

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

async function fetchABSParts(supabase: SupabaseServerClient): Promise<ABSPartSuggestion[]> {
  try {
    const { data, error } = await supabase
      .from('hd_parts_reference')
      .select('oem_part_number, part_function, part_category, manufacturer')
      .or(ABS_PART_FUNCTION_FILTER)
      .limit(10)

    if (error || !data) return []

    return (data as { oem_part_number: string | null; part_function: string | null; part_category: string | null; manufacturer: string | null }[])
      .filter(row => {
        const fn = row.part_function ?? ''
        return ABS_TOKEN.test(fn) && !REEFER_TOKEN.test(fn)
      })
      .map(row => ({
        oem_part_number: row.oem_part_number ?? null,
        part_function:   row.part_function ?? '',
        part_category:   row.part_category ?? '',
        manufacturer:    row.manufacturer ?? '',
      }))
  } catch (err) {
    // A parts lookup failure must never take down a brake diagnostic. No parts is a
    // perfectly good answer here — it is the answer on every request today.
    console.error('[hd/trailer-abs] parts lookup failed — returning no suggestions', err)
    return []
  }
}

// ─── Model output parsing ─────────────────────────────────────────────────────

interface ParsedModelOutput {
  fault_description:      string
  fault_category:         string | null
  confidence:             'high' | 'medium' | 'low'
  diagnostic_steps:       string[]
  specs_to_check:         string[]
  tools_needed:           string[]
  clarification_needed:   boolean
  clarification_question: string | null
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim())
    .filter(v => v.length > 0)
}

// Pulls the JSON object out of whatever the model returned. Handles a ```json fence and
// leading commentary, because a thinking model sometimes prefixes prose.
//
// Everything here fails CLOSED. If the object cannot be found, cannot be parsed, or does
// not carry the fields required to be a real diagnosis, this returns null and the caller
// falls back to a clarification — it never salvages half an object into a diagnosis.
function parseModelOutput(raw: string): ParsedModelOutput | null {
  if (!raw || !raw.trim()) return null

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body   = (fenced?.[1] ?? raw).trim()

  const start = body.indexOf('{')
  const end   = body.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  let obj: unknown
  try {
    obj = JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null

  const o = obj as Record<string, unknown>

  const faultDescription = typeof o.fault_description === 'string' ? o.fault_description.trim() : ''
  const steps            = toStringArray(o.diagnostic_steps)

  const rawConfidence = typeof o.confidence === 'string' ? o.confidence.trim().toLowerCase() : ''
  // An unrecognised or missing confidence value is treated as 'low', never as 'high'.
  // The safe default on a brake system is to assume the model is unsure.
  const confidence: ParsedModelOutput['confidence'] =
    rawConfidence === 'high' ? 'high' : rawConfidence === 'medium' ? 'medium' : 'low'

  const clarificationQuestion =
    typeof o.clarification_question === 'string' && o.clarification_question.trim().length > 0
      ? o.clarification_question.trim()
      : null

  // A response with no fault description AND no steps is prose or an empty shell, not a
  // structured answer — unless the model is explicitly asking a question, which is a
  // legitimate and welcome outcome.
  const isAskingQuestion = o.clarification_needed === true && clarificationQuestion !== null
  if (!faultDescription && steps.length === 0 && !isAskingQuestion) return null

  return {
    fault_description:      faultDescription,
    fault_category:         typeof o.fault_category === 'string' ? o.fault_category.trim() : null,
    confidence,
    diagnostic_steps:       steps,
    specs_to_check:         toStringArray(o.specs_to_check),
    tools_needed:           toStringArray(o.tools_needed),
    clarification_needed:   o.clarification_needed === true,
    clarification_question: clarificationQuestion,
  }
}

// ─── Prompt ───────────────────────────────────────────────────────────────────
//
// The system prompt (the ABS knowledge base) lives in ./abs-gemini-prompt. The RESPONSE
// FORMAT block below is owned by this route instead, because the JSON shape is this
// route's contract with its caller: the parser above and this block have to change
// together, and they should not be able to drift apart across two files.

function buildUserPrompt(input: {
  manufacturer:          ABSManufacturer
  ecuGeneration:         string
  blinkCode:             string
  symptoms:              string
  clarificationAnswer:   string
}): string {
  const lines = [
    `ABS manufacturer: ${input.manufacturer.toUpperCase()}`,
    `ECU generation (as reported by the technician): ${input.ecuGeneration || 'NOT PROVIDED'}`,
    `Blink code / fault code as flashed: ${input.blinkCode || 'NOT PROVIDED'}`,
    input.symptoms            ? `Symptoms reported: ${input.symptoms}` : null,
    input.clarificationAnswer ? `Technician's answer to your previous clarification question: ${input.clarificationAnswer}` : null,
  ].filter(Boolean).join('\n')

  return `${lines}

RESPONSE FORMAT — RETURN ONE JSON OBJECT AND NOTHING ELSE. No prose before or after it, no markdown fence.

{
  "fault_description": "One paragraph naming the fault. Leave this an empty string if you are asking for clarification instead of diagnosing.",
  "fault_category": "exactly one of ${ABS_FAULT_CATEGORIES.join(' | ')} — or null if the repair is not one of these",
  "confidence": "high | medium | low",
  "diagnostic_steps": ["ordered steps, one per array entry"],
  "specs_to_check": ["each measurable spec with its expected value and units"],
  "tools_needed": ["each tool"],
  "clarification_needed": true or false,
  "clarification_question": "a specific question naming exactly what to read off the ECU housing, or null"
}

RULES THAT OVERRIDE ANY URGE TO BE HELPFUL:
- This is a federally mandated brake system. Answer "I need to know X" rather than producing a likely-sounding diagnosis.
- Blink code tables differ between ECU generations. If the ECU generation is missing, vague, or does not match the code given, set confidence to "low", set clarification_needed to true, and ask a clarification_question that names exactly what is printed on the ECU housing to look for.
- Never state a code meaning you are not certain applies to THIS ECU generation.
- Do not estimate labor hours or name part numbers to buy. Those are handled outside your response.
- "confidence": "high" means you would stake a brake job on it. Use "low" freely.`
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const startedAt = Date.now()

  // Auth + tier gate: same posture as /api/hd/quickwrench — any active HD subscriber.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const userId = user.id

  const limit = checkRateLimit(userId)
  if (!limit.allowed) {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: false, error: 'rate_limited' })
    return NextResponse.json(
      { error: 'Too many requests. Wait a moment and try again.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    )
  }

  let body: {
    manufacturer?:          unknown
    ecu_generation?:        unknown
    blink_code?:            unknown
    symptoms?:              unknown
    clarification_answer?:  unknown
  }
  try {
    body = await req.json()
  } catch {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: false, error: 'invalid_body' })
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Manufacturer is a hard 400 rather than a clarification. WABCO, Bendix, and Haldex
  // are genuinely different systems with different blink code tables, and this route has
  // no safe behaviour for a fourth value — answering about "trailer ABS in general"
  // would be exactly the generic guess the whole design exists to prevent.
  if (!isManufacturer(body.manufacturer)) {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: false, error: 'invalid_manufacturer' })
    return NextResponse.json(
      { error: `manufacturer must be one of: ${MANUFACTURERS.join(', ')}` },
      { status: 400 },
    )
  }
  const manufacturer = String(body.manufacturer).trim().toLowerCase() as ABSManufacturer

  const asText = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const ecuGeneration       = asText(body.ecu_generation)
  const blinkCode           = asText(body.blink_code)
  const symptoms            = asText(body.symptoms)
  const clarificationAnswer = asText(body.clarification_answer)

  if (!blinkCode && !symptoms) {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: false, error: 'no_code_or_symptoms' })
    return NextResponse.json({ error: 'blink_code or symptoms required' }, { status: 400 })
  }

  // Unknown ECU generation is answered here, without spending a model call. It is the
  // single most common way a trailer ABS diagnosis goes wrong: the same flash pattern
  // means different things on Haldex Gen 4 and Gen 5, and on Bendix TABS-6 versus the
  // trailer EC series. There is no confident answer to be had, so we ask instead of
  // paying for a model round trip that could only produce a hedge.
  //
  // A clarification_answer bypasses this: it means the tech has already been asked once
  // and has come back with what they read off the housing.
  const ECU_UNKNOWN = /^(unknown|unsure|not sure|n\/?a|none|\?+|idk)$/i
  if (!clarificationAnswer && (!ecuGeneration || ECU_UNKNOWN.test(ecuGeneration))) {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: true, error: 'ecu_generation_missing' })
    return NextResponse.json<ABSDiagnosticResponse>({
      fault_description:      '',
      diagnostic_steps:       safeSteps(manufacturer),
      specs_to_check:         [],
      tools_needed:           [],
      clarification_needed:   true,
      clarification_question: `Which ECU generation is on this trailer? Read ${ECU_HOUSING_HINT[manufacturer]} and enter it — the same blink code means different things on different generations, so no diagnosis is safe without it.`,
      parts_suggestions:      [],
      labor_estimate:         null,
    })
  }

  // Unconfigured key is a graceful 200 fallback, deliberately unlike /api/hd/quickwrench
  // which returns 503. That route's client renders an error state; this one is a brake
  // diagnostic, and the useful thing to hand a tech whose AI is unavailable is the
  // procedure that does not need AI — read the decal, pull the literature.
  if (!isGeminiConfigured()) {
    await logUsage({ userId, model: null, latencyMs: Date.now() - startedAt, success: false, error: 'gemini_unconfigured' })
    return NextResponse.json(fallbackResponse(manufacturer, 'AI service not configured'))
  }

  // generateText, not generateDiagnostic — i.e. NO Google Search grounding, on purpose.
  // Two reasons. First, the same reason src/lib/gemini/formatter.ts skips it: grounding
  // is wrong when the output must be a strict JSON object, because the model starts
  // narrating sources instead. Second and more important, grounding on a trailer ABS
  // blink code would pull in whichever ABS code chart a search engine surfaces, and the
  // documented failure mode of this whole subject is a chart for the WRONG ECU
  // generation being applied confidently to the ECU in front of the tech.
  //
  // No maxOutputTokens cap: gemini-3.6-flash is a thinking model and a small cap gets
  // consumed by reasoning tokens, returning empty visible output.
  let rawOutput = ''
  try {
    rawOutput = await generateText(
      buildUserPrompt({ manufacturer, ecuGeneration, blinkCode, symptoms, clarificationAnswer }),
      ABS_GEMINI_SYSTEM_PROMPT,
    )
  } catch (err) {
    console.error('[hd/trailer-abs] Gemini call failed', err)
    await logUsage({ userId, model: MODEL_ID_FOR_LOG, latencyMs: Date.now() - startedAt, success: false, error: 'gemini_error' })
    return NextResponse.json(fallbackResponse(manufacturer, 'the AI service did not respond'))
  }

  const parsed = parseModelOutput(rawOutput)

  // Prose, malformed JSON, or a shell with no content. We do NOT try to read a diagnosis
  // out of unstructured text — a half-understood sentence about a brake fault is the
  // exact thing this route must not emit.
  if (!parsed) {
    console.error('[hd/trailer-abs] unparseable model output', rawOutput.slice(0, 400))
    await logUsage({ userId, model: MODEL_ID_FOR_LOG, latencyMs: Date.now() - startedAt, success: false, error: 'unparseable_response' })
    return NextResponse.json(fallbackResponse(manufacturer, 'the AI response could not be read'))
  }

  // CONFIDENCE LADDER — the route decides what gets committed to, not the model.
  //   low     → no fault description at all. Clarification only, plus the safe steps.
  //   medium  → verification steps are shown (checking a wheel end hurts nobody) but the
  //             answer is still flagged as needing confirmation and carries no estimate.
  //   high    → committed diagnosis, and only here does a labor estimate appear.
  // The model's own clarification_needed flag can raise the bar but never lower it.
  const committed = parsed.confidence === 'high' && !parsed.clarification_needed
  const clarificationNeeded = !committed

  const defaultQuestion = `To confirm this before you touch the brakes, read ${ECU_HOUSING_HINT[manufacturer]} and tell me what it says.`

  // Labor is looked up from the deterministic table keyed on the model's category, with
  // a keyword classification of its own text as the fallback. The model never supplies
  // hours. And no estimate is attached to an uncommitted diagnosis — an hours figure on
  // an unconfirmed fault is a number that ends up quoted to a customer.
  const labor: ABSLaborEntry | null = committed
    ? (resolveABSLabor(parsed.fault_category) ?? classifyABSFaultToLabor(parsed.fault_description, parsed.diagnostic_steps))
    : null

  const parts = await fetchABSParts(supabase)

  await logUsage({ userId, model: MODEL_ID_FOR_LOG, latencyMs: Date.now() - startedAt, success: true, error: null })

  return NextResponse.json<ABSDiagnosticResponse>({
    fault_description: parsed.confidence === 'low'
      ? ''
      : parsed.fault_description,
    diagnostic_steps: parsed.confidence === 'low'
      ? (parsed.diagnostic_steps.length > 0 ? parsed.diagnostic_steps : safeSteps(manufacturer))
      : parsed.diagnostic_steps,
    specs_to_check:         parsed.specs_to_check,
    tools_needed:           parsed.tools_needed,
    clarification_needed:   clarificationNeeded,
    clarification_question: clarificationNeeded
      ? (parsed.clarification_question ?? defaultQuestion)
      : null,
    parts_suggestions:      parts,
    labor_estimate:         labor,
  })
}

// Keyword fallback for the labor lookup, run over the model's own words when it did not
// return a usable fault_category. Still deterministic — the table owns the hours.
function classifyABSFaultToLabor(faultDescription: string, steps: string[]): ABSLaborEntry | null {
  return resolveABSLabor(classifyABSFault([faultDescription, ...steps].join(' ')))
}
