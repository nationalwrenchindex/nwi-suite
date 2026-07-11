import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { generateDiagnostic } from '@/lib/gemini/client'

// Gemini + JSON parsing can take >10s; 60s prevents Vercel's default timeout kill.
export const maxDuration = 60

type RouteContext = { params: Promise<{ code: string }> }

// Primary diagnostic AI: Gemini 2.5 Flash with Google Search grounding returns
// structured JSON (same shape the frontend renders as colored severity cards and
// symptom pills). On any Gemini/parse failure we fall back to the Claude Sonnet
// structured call so the tech is never left without an answer.
const GEMINI_JSON_SYSTEM_PROMPT = `You are an expert automotive diagnostic technician. Return ONLY valid JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Return a JSON object with these exact fields:
- code: the DTC code
- name: official code name
- category: system category (e.g. Emissions/Catalyst)
- symptoms: array of symptom strings
- severity: one of 'low', 'moderate', 'high', 'critical'
- severity_description: one sentence on driveability impact
- common_causes: array of cause strings, vehicle-specific, ordered by field frequency
- related_codes: array of related DTC code strings
- diagnostic_order: array of diagnostic step strings with exact specs (voltages, resistances, sensor ranges)
- repair_steps: array of step-by-step repair procedure strings in the order a tech would perform them. These are REPAIR actions (remove, replace, torque, install) NOT diagnostic actions. Always include:
  * Torque specifications where applicable (e.g. 'Torque manifold bolts to 18 ft-lbs in sequence')
  * Special tool requirements per step
  * Safety notes per step (e.g. 'Allow exhaust to cool before handling')
  * Part numbers for components being replaced
  * Whether engine must be cold, warm, or off for each step
Example steps:
  'Allow exhaust system to cool completely — minimum 2 hours after last operation'
  'Spray all manifold bolts with penetrating oil (PB Blaster). Wait 15 minutes.'
  'Remove upstream O2 sensor using O2 sensor socket. Note: sensor may be seized — do not force'
  'Remove 3 manifold-to-pipe flange bolts. Replace if corroded (Dorman 03102)'
  'Install new catalytic converter. Torque flange bolts to 30 ft-lbs. Torque manifold bolts to 18 ft-lbs in star pattern'
  'Install new upstream O2 sensor. Torque to 33 ft-lbs. Apply anti-seize to threads'
  'Clear DTCs. Perform drive cycle to verify repair'
- suggested_repair: field-realistic repair recommendation
- parts_needed: array of parts typically needed for this repair. REQUIRED — never return an empty array. Always include at minimum the primary failed component with OEM part number, and any sensors or gaskets typically replaced during this repair. Format each entry as: 'Part Name — OEM Part# XXXXX (Aftermarket: Brand XXXXX) Est. $XX-$XX'. If exact part numbers vary by build, state the part name and note 'verify part number with VIN at dealer'
- special_tools: string listing tools needed or 'None beyond standard hand tools and multimeter'
- labor_estimate: string with mobile field time estimate
- safety_warnings: string with any safety precautions

TECHNICAL SPECIFICITY — MANDATORY:
All diagnostic steps must include exact voltage specs, resistance values, and sensor output ranges. Include OEM part numbers. Be vehicle-specific — not generic.`

function buildLdUserPrompt(
  code: string, year: string, make: string, model: string, engine: string, displayMessage: string,
): string {
  const vehicle = [year, make, model].filter(Boolean).join(' ') || 'an unspecified vehicle'
  return [
    `Diagnose DTC ${code} on a ${vehicle}`,
    engine         ? `Engine: ${engine}`                : '',
    displayMessage ? `Display shows: ${displayMessage}` : '',
    'Provide vehicle-specific diagnostic procedures, part numbers, and field repair guidance for a mobile mechanic.',
  ].filter(Boolean).join('\n')
}

// ── Structured shape shared by both the Gemini and Claude paths + the frontend ──

interface DTCStructured {
  code?:                 string
  name?:                 string
  category?:             string
  symptoms?:             string[]
  severity?:             string
  severity_description?: string
  common_causes?:        string[]
  related_codes?:        string[]
  diagnostic_order?:     string[]
  repair_steps?:         string[]
  suggested_repair?:     string
  parts_needed?:         string[]
  special_tools?:        string
  labor_estimate?:       string
  safety_warnings?:      string
}

const asStr    = (v: unknown): string   => (typeof v === 'string' ? v : '')
const asStrArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// Coerce any raw object (loose Gemini JSON or Claude tool output) into the exact
// structured shape, so the frontend never sees a missing array or wrong type.
function normalizeStructured(raw: unknown): DTCStructured {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    code:                 asStr(o.code),
    name:                 asStr(o.name),
    category:             asStr(o.category),
    symptoms:             asStrArr(o.symptoms),
    severity:             asStr(o.severity).toLowerCase(),
    severity_description: asStr(o.severity_description),
    common_causes:        asStrArr(o.common_causes),
    related_codes:        asStrArr(o.related_codes),
    diagnostic_order:     asStrArr(o.diagnostic_order),
    repair_steps:         asStrArr(o.repair_steps),
    suggested_repair:     asStr(o.suggested_repair),
    parts_needed:         asStrArr(o.parts_needed),
    special_tools:        asStr(o.special_tools),
    labor_estimate:       asStr(o.labor_estimate),
    safety_warnings:      asStr(o.safety_warnings),
  }
}

// Gemini returns text; strip any stray markdown fences and parse the {...} body.
function parseJsonLoose(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

// ── Claude Sonnet fallback — structured tool call (same unified shape) ──

const CLAUDE_SYSTEM_PROMPT =
  'You are an experienced automotive diagnostic assistant helping a mobile mechanic in the field. ' +
  'Return ONLY valid JSON — no markdown fences, no backticks, no preamble. First character must be {, last must be }.'

function claudeUserMessage(code: string, vehicleDesc: string, displayMessage: string): string {
  return `For DTC code ${code} on a ${vehicleDesc}${displayMessage ? ` (display shows: ${displayMessage})` : ''}, return the structured DTC analysis. Be specific to the vehicle year/make/model. Order causes most to least likely. Diagnostic steps must include exact voltage specs, resistance values, and sensor output ranges. Include OEM part numbers in parts_needed. Keep tone field-mechanic friendly, not textbook.`
}

const DTC_TOOL = {
  name: 'return_dtc_analysis',
  description: 'Return the structured DTC analysis for the given code and vehicle.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code:                 { type: 'string' },
      name:                 { type: 'string' },
      category:             { type: 'string' },
      symptoms:             { type: 'array', items: { type: 'string' } },
      severity:             { type: 'string', enum: ['low', 'moderate', 'high', 'critical'] },
      severity_description: { type: 'string' },
      common_causes:        { type: 'array', items: { type: 'string' } },
      related_codes:        { type: 'array', items: { type: 'string' } },
      diagnostic_order:     { type: 'array', items: { type: 'string' } },
      repair_steps:         { type: 'array', items: { type: 'string' }, description: 'Step-by-step repair procedure with torque specs' },
      suggested_repair:     { type: 'string' },
      parts_needed:         { type: 'array', items: { type: 'string' } },
      special_tools:        { type: 'string' },
      labor_estimate:       { type: 'string' },
      safety_warnings:      { type: 'string' },
    },
    required: [
      'code', 'name', 'category', 'symptoms', 'severity', 'severity_description',
      'common_causes', 'related_codes', 'diagnostic_order', 'repair_steps', 'suggested_repair',
      'parts_needed', 'special_tools', 'labor_estimate', 'safety_warnings',
    ],
  },
}

async function callClaude(apiKey: string, code: string, vehicleDesc: string, displayMessage: string): Promise<DTCStructured> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:       'claude-sonnet-4-6',
      max_tokens:  1200,
      system:      CLAUDE_SYSTEM_PROMPT,
      tools:       [DTC_TOOL],
      tool_choice: { type: 'tool', name: 'return_dtc_analysis' },
      messages:    [{ role: 'user', content: claudeUserMessage(code, vehicleDesc, displayMessage) }],
    }),
  })
  if (!res.ok) throw new Error(`AI service error: ${await res.text()}`)
  const data  = await res.json()
  const block = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!block) throw new Error('No tool_use block in AI response')
  return normalizeStructured(block.input)
}

// ── Cache key — vehicle-specific, so P0420 on a Yukon XL ≠ P0420 on a Neon ──

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
function ldCacheKey(code: string, year: string, make: string, model: string): string {
  return `ld-${slug(code)}-${slug(year)}-${slug(make)}-${slug(model)}`
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const { code } = await params
  const normalized = code.trim().toUpperCase()
  if (!/^[PBCU][0-9]{4}$/.test(normalized)) {
    return NextResponse.json({ error: 'Invalid DTC format. Expected e.g. P0420' }, { status: 400 })
  }

  const year    = (req.nextUrl.searchParams.get('year')    ?? '').trim()
  const make    = (req.nextUrl.searchParams.get('make')    ?? '').trim()
  const model   = (req.nextUrl.searchParams.get('model')   ?? '').trim()
  const engine  = (req.nextUrl.searchParams.get('engine')  ?? '').trim()
  const display = (req.nextUrl.searchParams.get('display') ?? '').trim()
  const vehicleDesc = [year, make, model].filter(Boolean).join(' ') || 'an unspecified vehicle'
  const cacheKey    = ldCacheKey(normalized, year, make, model)

  // ── Cache read (RLS-scoped authenticated client; LD entries only) ──
  const { data: cached } = await supabase
    .from('hd_cached_diagnostics')
    .select('result_html, citations')
    .eq('cache_key', cacheKey)
    .eq('suite', 'ld')
    .maybeSingle()

  if (cached?.result_html) {
    // Structured JSON cache hit — restore the object and return with no model call.
    // Legacy text entries (from the earlier text-cache build) won't parse as JSON;
    // fall through and regenerate so the entry self-heals to structured.
    try {
      const parsed = normalizeStructured(JSON.parse(cached.result_html))
      try {
        await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey })
      } catch (e) {
        console.error('[dtc] cache hit increment failed', e)
      }
      return NextResponse.json({
        result: { ...parsed, code: normalized, citations: cached.citations ?? [] },
        source: 'cache',
        cached: true,
      })
    } catch {
      console.warn('[dtc] cached entry is not JSON (legacy text) — regenerating')
    }
  }

  // ── Miss — Gemini 2.5 Flash (grounded) → structured JSON ──
  const userPrompt = buildLdUserPrompt(normalized, year, make, model, engine, display)
  let structured: DTCStructured | null = null
  let citations: string[] = []
  let source = 'gemini_web_search'

  try {
    const raw    = await generateDiagnostic(userPrompt, GEMINI_JSON_SYSTEM_PROMPT)
    const parsed = parseJsonLoose(raw.text)
    if (parsed) {
      structured = normalizeStructured(parsed)
      citations  = raw.citations
    }
  } catch (gemErr) {
    console.error('[dtc] Gemini failed — falling back to Claude Sonnet', gemErr)
  }

  // ── Fallback — existing Claude Sonnet structured call ──
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!structured && apiKey) {
    try {
      structured = await callClaude(apiKey, normalized, vehicleDesc, display)
      source     = 'claude_fallback'
    } catch (err) {
      console.error('[dtc] Claude Sonnet fallback failed', err)
    }
  }

  if (!structured || !structured.name) {
    return NextResponse.json({ error: 'AI response could not be generated — please try again' }, { status: 502 })
  }
  structured.code = normalized

  // ── Cache write — only genuine Gemini results (never a temporary-outage
  // fallback). LD cache is automatic: no email, no founder review, no expiry.
  // Stored as a JSON string so hits restore the exact structured object. ──
  //
  // ONE-TIME CLEANUP (Brock, run manually AFTER promoting — do NOT automate):
  // repair_steps is a new field; existing cached LD entries lack it and won't
  // show a Repair Procedure section. Flush them so they regenerate with the new
  // schema:
  //   DELETE FROM public.hd_cached_diagnostics WHERE suite = 'ld';
  if (source === 'gemini_web_search') {
    try {
      const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
        cache_key:    cacheKey,
        suite:        'ld',
        manufacturer: make || null,
        alarm_code:   normalized,
        unit_model:   model || null,
        result_html:  JSON.stringify(structured),
        source:       'gemini_web_search',
        citations,
        needs_review: false,
        expires_at:   null,
      }, { onConflict: 'cache_key' })
      if (cacheErr) console.error('[dtc] cache write failed', cacheErr)
    } catch (e) {
      console.error('[dtc] cache write threw', e)
    }
  }

  return NextResponse.json({
    result: { ...structured, citations },
    source,
    cached: false,
  })
}
