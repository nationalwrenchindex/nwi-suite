import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import { generateDiagnostic } from '@/lib/gemini/client'
import { formatDiagnostic } from '@/lib/gemini/formatter'

// Gemini + Haiku formatting can take >10s; 60s prevents Vercel's default timeout kill.
export const maxDuration = 60

type RouteContext = { params: Promise<{ code: string }> }

// Primary diagnostic AI: Gemini 2.5 Flash with Google Search grounding does the
// thinking + search; Haiku (formatDiagnostic) reshapes it into our section
// structure. On any Gemini failure we fall back to the Claude Sonnet call so the
// tech is never left without an answer.
const LD_SYSTEM_PROMPT = `You are an expert automotive diagnostic technician helping a mobile mechanic in the field. You have deep knowledge of OBD-II fault codes, vehicle-specific repair procedures, and real-world field diagnostics.

TECHNICAL SPECIFICITY REQUIREMENTS — MANDATORY:
1. Always state the exact DTC code meaning for this specific vehicle (year/make/model/engine) — not generic
2. List most likely causes in order of field frequency for this specific vehicle
3. Diagnostic steps must include exact voltage specs, resistance values, and sensor output ranges where applicable
4. Always include OEM part numbers where known
5. Always specify special tools required (or state none needed)
6. Safety warnings for any step involving live circuits, fuel systems, or pressurized components
7. Labor time estimate for mobile field repair

FORMAT YOUR RESPONSE IN THESE EXACT SECTIONS:
CODE MEANING:
SYMPTOMS:
SEVERITY:
MOST LIKELY CAUSES:
DIAGNOSTIC STEPS:
COMMON FIX:
PARTS NEEDED:
SPECIAL TOOLS:
SAFETY WARNINGS:
LABOR ESTIMATE:
RELATED CODES:`

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

// ── Claude Sonnet fallback (structured tool call, flattened to section text) ──

const CLAUDE_SYSTEM_PROMPT =
  'You are an experienced automotive diagnostic assistant helping a mobile mechanic in the field. ' +
  'Return ONLY valid JSON — no markdown fences, no backticks, no preamble. First character must be {, last must be }.'

function claudeUserMessage(code: string, vehicleDesc: string, displayMessage: string): string {
  return `For DTC code ${code} on a ${vehicleDesc}${displayMessage ? ` (display shows: ${displayMessage})` : ''}, return a JSON object with these exact fields:

- code: the DTC code as entered
- name: official code name
- category: short category badge text (e.g. 'Ignition / Fuel')
- symptoms: array of 3-5 strings describing what the customer/driver would notice
- severity: object with three keys:
    level: 'Low' | 'Moderate' | 'High' | 'Critical'
    drivable: true | false
    notes: 1-2 sentence string about drivability and safety to road test
- common_causes: array of 4-6 strings, ordered most to least likely, specific to this engine when possible
- related_codes: array of 2-4 strings, each a code that commonly appears alongside or as a downstream effect
- diagnostic_order: array of 4-6 strings, steps in the order to check, cheapest/easiest first, ending in repair confirmation
- suggested_repair: 1-2 sentence string with the most likely fix, written like one mechanic talking to another

Be specific to the vehicle year/make/model when possible. Order causes most to least likely. Keep tone field-mechanic friendly, not textbook. Return ONLY valid JSON with no markdown fences or surrounding text.`
}

const DTC_TOOL = {
  name: 'return_dtc_analysis',
  description: 'Return the structured DTC analysis for the given code and vehicle.',
  input_schema: {
    type: 'object' as const,
    properties: {
      code:             { type: 'string' },
      name:             { type: 'string' },
      category:         { type: 'string' },
      symptoms:         { type: 'array', items: { type: 'string' } },
      severity: {
        type: 'object',
        properties: {
          level:    { type: 'string', enum: ['Low', 'Moderate', 'High', 'Critical'] },
          drivable: { type: 'boolean' },
          notes:    { type: 'string' },
        },
        required: ['level', 'drivable', 'notes'],
      },
      common_causes:    { type: 'array', items: { type: 'string' } },
      related_codes:    { type: 'array', items: { type: 'string' } },
      diagnostic_order: { type: 'array', items: { type: 'string' } },
      suggested_repair: { type: 'string' },
    },
    required: ['code', 'name', 'category', 'symptoms', 'severity', 'common_causes', 'related_codes', 'diagnostic_order', 'suggested_repair'],
  },
}

interface DTCStructured {
  code?: string; name?: string; category?: string
  symptoms?: string[]; severity?: { level?: string; drivable?: boolean; notes?: string }
  common_causes?: string[]; related_codes?: string[]; diagnostic_order?: string[]; suggested_repair?: string
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
      max_tokens:  800,
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
  return block.input as DTCStructured
}

// Flatten the structured fallback into the same labeled-section text the Gemini
// path produces, so the frontend renders one consistent format either way.
function structuredToText(r: DTCStructured): string {
  const sev = r.severity
  const sevLine = [
    sev?.level ?? '',
    sev?.drivable === false ? 'Do not drive' : sev?.drivable === true ? 'Safe to drive short distance' : '',
    sev?.notes ?? '',
  ].filter(Boolean).join(' — ')
  return [
    r.name              ? `CODE MEANING:\n${r.name}` : '',
    r.symptoms?.length  ? `SYMPTOMS:\n${r.symptoms.map(s => `- ${s}`).join('\n')}` : '',
    sevLine             ? `SEVERITY:\n${sevLine}` : '',
    r.common_causes?.length    ? `MOST LIKELY CAUSES:\n${r.common_causes.map((c, i) => `${i + 1}. ${c}`).join('\n')}` : '',
    r.diagnostic_order?.length ? `DIAGNOSTIC STEPS:\n${r.diagnostic_order.map((s, i) => `${i + 1}. ${s}`).join('\n')}` : '',
    r.suggested_repair  ? `COMMON FIX:\n${r.suggested_repair}` : '',
    r.related_codes?.length    ? `RELATED CODES:\n${r.related_codes.join(', ')}` : '',
  ].filter(Boolean).join('\n\n')
}

// ── Section helpers — preserve LD-specific sections after Haiku reshaping ──

// formatDiagnostic reshapes into the HD reefer section set (ALARM MEANING, etc.)
// and drops SYMPTOMS / SEVERITY / LABOR ESTIMATE / RELATED CODES. Re-attach those
// from the raw Gemini text so the LD panel keeps its extra sections.
const LD_KEEP = ['SYMPTOMS', 'SEVERITY', 'LABOR ESTIMATE', 'RELATED CODES']

function splitSections(text: string): { header: string; body: string }[] {
  const out: { header: string; body: string[] }[] = []
  const headerRe = /^([A-Z][A-Z0-9 /&()'\-]{2,40}):\s*$/
  let cur: { header: string; body: string[] } | null = null
  for (const line of text.split('\n')) {
    const m = line.match(headerRe)
    if (m) { cur = { header: m[1].trim(), body: [] }; out.push(cur) }
    else if (cur) cur.body.push(line)
  }
  return out.map(s => ({ header: s.header, body: s.body.join('\n').trim() }))
}

function mergeLdSections(formatted: string, raw: string): string {
  const have = new Set(splitSections(formatted).map(s => s.header.toUpperCase()))
  const extras = splitSections(raw).filter(
    s => LD_KEEP.includes(s.header.toUpperCase()) && !have.has(s.header.toUpperCase()) && s.body.length > 0,
  )
  if (extras.length === 0) return formatted
  return formatted.trim() + '\n\n' + extras.map(s => `${s.header}:\n${s.body}`).join('\n\n')
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
    // Hit — atomic search_count bump via the service client, no new model call.
    try {
      await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey })
    } catch (e) {
      console.error('[dtc] cache hit increment failed', e)
    }
    return NextResponse.json({
      result: { code: normalized, analysis: cached.result_html, citations: cached.citations ?? [] },
      source: 'cache',
      cached: true,
    })
  }

  // ── Miss — Gemini 2.5 Flash (grounded) → Haiku format ──
  const userPrompt = buildLdUserPrompt(normalized, year, make, model, engine, display)
  let analysis = ''
  let citations: string[] = []
  let source = 'gemini_web_search'

  try {
    const raw = await generateDiagnostic(userPrompt, LD_SYSTEM_PROMPT)
    if (raw.text.trim()) {
      const formatted = await formatDiagnostic(raw.text, {
        manufacturer: make || undefined,
        model:        model || undefined,
        alarmCode:    normalized,
      })
      analysis  = mergeLdSections(formatted.trim(), raw.text)
      citations = raw.citations
    }
  } catch (gemErr) {
    console.error('[dtc] Gemini failed — falling back to Claude Sonnet', gemErr)
  }

  // ── Fallback — existing Claude Sonnet structured call, flattened to text ──
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!analysis && apiKey) {
    try {
      const structured = await callClaude(apiKey, normalized, vehicleDesc, display)
      analysis = structuredToText(structured)
      source   = 'claude_fallback'
    } catch (err) {
      console.error('[dtc] Claude Sonnet fallback failed', err)
    }
  }

  if (!analysis.trim()) {
    return NextResponse.json({ error: 'AI response could not be generated — please try again' }, { status: 502 })
  }

  // ── Cache write — only genuine Gemini results (never a temporary-outage
  // fallback). LD cache is automatic: no email, no founder review, no expiry. ──
  if (source === 'gemini_web_search') {
    try {
      const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
        cache_key:    cacheKey,
        suite:        'ld',
        manufacturer: make || null,
        alarm_code:   normalized,
        unit_model:   model || null,
        result_html:  analysis,
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
    result: { code: normalized, analysis, citations },
    source,
    cached: false,
  })
}
