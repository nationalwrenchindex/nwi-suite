import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'

// Claude can take >10s on long DTC responses; 60s prevents Vercel's default timeout kill
export const maxDuration = 60

type RouteContext = { params: Promise<{ code: string }> }

const SYSTEM_PROMPT =
  'You are an experienced automotive diagnostic assistant helping a mobile mechanic in the field. ' +
  'Return ONLY valid JSON — no markdown fences, no backticks, no preamble. First character must be {, last must be }.'

function userMessage(code: string, vehicleDesc: string): string {
  return `For DTC code ${code} on a ${vehicleDesc}, return a JSON object with these exact fields:

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

async function callClaude(apiKey: string, code: string, vehicleDesc: string): Promise<unknown> {
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
      system:      SYSTEM_PROMPT,
      tools:       [DTC_TOOL],
      tool_choice: { type: 'tool', name: 'return_dtc_analysis' },
      messages:    [{ role: 'user', content: userMessage(code, vehicleDesc) }],
    }),
  })

  if (!res.ok) throw new Error(`AI service error: ${await res.text()}`)
  const data  = await res.json()
  const block = data.content?.find((b: { type: string }) => b.type === 'tool_use')
  if (!block) throw new Error('No tool_use block in AI response')
  return block.input
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

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })

  const year  = req.nextUrl.searchParams.get('year')  ?? ''
  const make  = req.nextUrl.searchParams.get('make')  ?? ''
  const model = req.nextUrl.searchParams.get('model') ?? ''
  const vehicleDesc = [year, make, model].filter(Boolean).join(' ') || 'an unspecified vehicle'

  // tool_use guarantees structured output — retry once on any failure
  try {
    const result = await callClaude(apiKey, normalized, vehicleDesc)
    return NextResponse.json({ result, source: 'ai' })
  } catch (err) {
    console.error('[dtc] Claude call failed on first attempt:', err)
    // Single retry
    try {
      const result = await callClaude(apiKey, normalized, vehicleDesc)
      return NextResponse.json({ result, source: 'ai' })
    } catch (retryErr) {
      console.error('[dtc] Claude call failed after retry:', retryErr)
      return NextResponse.json(
        { error: 'AI response could not be parsed — please try again' },
        { status: 502 },
      )
    }
  }
}
