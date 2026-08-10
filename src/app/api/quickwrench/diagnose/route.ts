import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { generateDiagnostic } from '@/lib/gemini/client'

// Gemini + JSON parsing can take >10s; 60s prevents Vercel's default timeout kill.
export const maxDuration = 60

// LD diagnostic — accepts an optional DTC code OR a symptom/display description.
// With a code it behaves like the /dtc/[code] route; without one it runs a
// symptom-based diagnosis (code === 'NO-CODE'). Same structured JSON shape, same
// cache table (suite = 'ld'). Gemini-only (Google Search grounded).

const BASE_SYSTEM_PROMPT = `You are an expert automotive diagnostic technician. Return ONLY valid JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

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
- repair_steps: array of step-by-step repair procedure strings in the order a tech would perform them (remove, replace, torque, install) with torque specs, per-step special tools, per-step safety notes, part numbers, and whether the engine must be cold/warm/off
- suggested_repair: field-realistic repair recommendation
- parts_needed: array of parts typically needed. REQUIRED — never empty. Format each as 'Part Name — OEM Part# XXXXX (Aftermarket: Brand XXXXX) Est. $XX-$XX'. If numbers vary by build, note 'verify part number with VIN at dealer'
- special_tools: string listing tools needed or 'None beyond standard hand tools and multimeter'
- labor_estimate: string with mobile field time estimate
- safety_warnings: string with any safety precautions

TECHNICAL SPECIFICITY — MANDATORY:
All diagnostic steps must include exact voltage specs, resistance values, and sensor output ranges. Include OEM part numbers. Be vehicle-specific — not generic.`

const SYMPTOM_SYSTEM_ADDITION = `

When no DTC code is provided, diagnose based on the described symptom. Return the same JSON structure but:
- code: 'NO-CODE'
- name: summarize the symptom in 5 words or less
- Focus diagnostic_order on symptom-based diagnosis steps
- Include most likely DTC codes that could cause this symptom in related_codes[]
- suggested_repair should be especially detailed since there's no code to guide the diagnosis`

function buildCodePrompt(code: string, vehicle: string, engine: string, displayMessage: string): string {
  return [
    `Diagnose DTC ${code} on a ${vehicle}`,
    engine         ? `Engine: ${engine}`                : '',
    displayMessage ? `Display shows: ${displayMessage}` : '',
    'Provide vehicle-specific diagnostic procedures, part numbers, and field repair guidance for a mobile mechanic.',
  ].filter(Boolean).join('\n')
}

function buildSymptomPrompt(symptom: string, vehicle: string, engine: string): string {
  return [
    `Diagnose this symptom on a ${vehicle}: ${symptom}`,
    engine ? `Engine: ${engine}` : '',
    'No DTC code is available. Provide a symptom-based diagnosis, the most likely DTC codes, vehicle-specific diagnostic steps, part numbers, and field repair guidance for a mobile mechanic.',
  ].filter(Boolean).join('\n')
}

// ── Structured shape shared by the Gemini path + the frontend ──

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

function parseJsonLoose(text: string): unknown | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end   = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
}

// ── Cache key — vehicle-specific ──
const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  let body: {
    code?: string; displayMessage?: string; symptom?: string
    year?: string; make?: string; model?: string; engine?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const rawCode = (body.code ?? '').trim().toUpperCase()
  const display = (body.displayMessage ?? '').trim()
  const symptom = (body.symptom ?? '').trim()
  const year    = (body.year   ?? '').trim()
  const make    = (body.make   ?? '').trim()
  const model   = (body.model  ?? '').trim()
  const engine  = (body.engine ?? '').trim()
  const vehicle = [year, make, model].filter(Boolean).join(' ') || 'an unspecified vehicle'

  const hasValidCode = /^[PBCU][0-9]{4}$/.test(rawCode)
  // The symptom text: prefer an explicit symptom, else the display message.
  const issueText = symptom || display

  if (!hasValidCode && !issueText) {
    return NextResponse.json({ error: 'Enter a DTC code or describe the issue.' }, { status: 400 })
  }

  const isCodeMode = hasValidCode
  const cacheKey = isCodeMode
    ? `ld-${slug(rawCode)}-${slug(year)}-${slug(make)}-${slug(model)}`
    : `ld-symptom-${slug(issueText).slice(0, 40)}-${slug(year)}-${slug(make)}-${slug(model)}`

  // ── Cache read ──
  const { data: cached } = await supabase
    .from('hd_cached_diagnostics')
    .select('result_html, citations')
    .eq('cache_key', cacheKey)
    .eq('suite', 'ld')
    .maybeSingle()

  if (cached?.result_html) {
    try {
      const parsed = normalizeStructured(JSON.parse(cached.result_html))
      try { await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey }) } catch (e) {
        console.error('[diagnose] cache hit increment failed', e)
      }
      return NextResponse.json({
        result: { ...parsed, code: isCodeMode ? rawCode : (parsed.code || 'NO-CODE'), citations: cached.citations ?? [] },
        source: 'cache',
        cached: true,
      })
    } catch {
      console.warn('[diagnose] cached entry is not JSON — regenerating')
    }
  }

  // ── Miss — Gemini 2.5 Flash (grounded) → structured JSON ──
  const systemPrompt = isCodeMode ? BASE_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT + SYMPTOM_SYSTEM_ADDITION
  const userPrompt   = isCodeMode
    ? buildCodePrompt(rawCode, vehicle, engine, display)
    : buildSymptomPrompt(issueText, vehicle, engine)

  let structured: DTCStructured | null = null
  let citations: string[] = []
  const source = 'gemini_web_search'

  try {
    const raw    = await generateDiagnostic(userPrompt, systemPrompt)
    const parsed = parseJsonLoose(raw.text)
    if (parsed) {
      structured = normalizeStructured(parsed)
      citations  = raw.citations
    }
  } catch (gemErr) {
    console.error('[diagnose] Gemini failed', gemErr)
  }

  if (!structured || !structured.name) {
    return NextResponse.json({ error: 'AI response could not be generated — please try again' }, { status: 502 })
  }
  structured.code = isCodeMode ? rawCode : 'NO-CODE'

  // ── Cache write — only genuine Gemini results ──
  if (source === 'gemini_web_search') {
    try {
      const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
        cache_key:    cacheKey,
        suite:        'ld',
        manufacturer: make || null,
        alarm_code:   isCodeMode ? rawCode : 'NO-CODE',
        unit_model:   model || null,
        result_html:  JSON.stringify(structured),
        source:       'gemini_web_search',
        citations,
        needs_review: false,
        expires_at:   null,
      }, { onConflict: 'cache_key' })
      if (cacheErr) console.error('[diagnose] cache write failed', cacheErr)
    } catch (e) {
      console.error('[diagnose] cache write threw', e)
    }
  }

  return NextResponse.json({
    result: { ...structured, citations },
    source,
    cached: false,
  })
}
