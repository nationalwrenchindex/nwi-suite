// POST /api/quickwrench/tech-guide
// Calls Claude API to generate vehicle-specific repair guide with torque specs,
// step-by-step instructions, parts list, and difficulty rating.
// Requires ANTHROPIC_API_KEY in environment.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import type { TechGuideRequest, TechGuide } from '@/types/quickwrench'

// NOTE: parts include demo pricing (unit_cost / unit_price) until PartsTech
// supplier integration is approved and live. At that point, replace this Claude
// call with a PartsTech catalog lookup and remove the pricing fields from the prompt.
const SYSTEM_PROMPT = `You are an automotive technician. Respond ONLY with raw JSON — no markdown, no backticks, no preamble, no explanation after. First character must be { and last character must be }. Do not write anything before or after the JSON object.

CRITICAL: Output ONLY valid JSON. No markdown code fences. No explanations before or after. No "Here is your response" text. Start your response with { and end with }. Nothing else.

Schema (all fields required):
{"torque":[{"part":"","spec":""}],"steps":[""],"tools":[""],"warning":"","hours":1,"parts":[{"name":"","qty":1,"unit_cost":0.00,"unit_price":0.00}]}

For each part, include realistic demo pricing:
- unit_cost: what a mechanic pays at a supplier (use these ranges: motor oil $8-12/qt, oil filter $10-25, air filter $15-35, brake pads $45-95/set, brake rotor $65-150 each, brake hardware kit $15-30, trans filter kit $30-80, trans fluid $12-18/qt, coolant $18-25/gal, spark plug $8-25 each, power steering/brake fluid $12-20, grease/cleaners $4-15, drain plugs/gaskets $2-10)
- unit_price: retail price customer pays — 15-25% above unit_cost, rounded to realistic cents (e.g. 45.99 not 45.38)

Limits: max 3 torque, max 5 steps, max 3 tools, 1 warning sentence, max 4 parts. Be concise.`

/**
 * Walks the string from the first '{' using depth counting to find the
 * matching closing brace of the outermost JSON object.  This is robust
 * against trailing explanation text that itself contains { } characters,
 * which trips up the naive lastIndexOf('}') approach.
 */
function extractOutermostJSON(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape)              { escape = false; continue }
    if (ch === '\\' && inString) { escape = true;  continue }
    if (ch === '"')          { inString = !inString; continue }
    if (inString)            { continue }
    if (ch === '{')          { depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[tech-guide] ANTHROPIC_API_KEY is not set in environment variables')
    return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })
  }
  console.log('[tech-guide] API key prefix:', apiKey.slice(0, 14) + '…')

  let body: TechGuideRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { vehicle, job } = body
  if (!vehicle?.year || !vehicle?.make || !vehicle?.model || !job?.name) {
    return NextResponse.json({ error: 'vehicle and job are required.' }, { status: 400 })
  }

  const vehicleDesc = [vehicle.year, vehicle.make, vehicle.model, vehicle.engine]
    .filter(Boolean)
    .join(' ')

  const userMessage = `Vehicle: ${vehicleDesc}
Job: ${job.name}
Category: ${job.categoryLabel}

Provide the complete technical guide for this specific vehicle and job.`

  let raw: string
  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4000,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      console.error(
        `[tech-guide] Claude API HTTP ${claudeRes.status} ${claudeRes.statusText}:`,
        errBody,
      )
      let detail = ''
      try { detail = JSON.parse(errBody)?.error?.message ?? errBody } catch { detail = errBody }
      return NextResponse.json(
        { error: `AI service error (HTTP ${claudeRes.status}): ${detail}` },
        { status: 502 },
      )
    }

    const claudeData = await claudeRes.json()
    console.log('[tech-guide] Claude response id:', claudeData.id, 'stop_reason:', claudeData.stop_reason)
    raw = claudeData.content?.[0]?.text ?? ''

    if (!raw) {
      console.error('[tech-guide] Empty text in Claude response:', JSON.stringify(claudeData))
      return NextResponse.json({ error: 'AI returned an empty response. Try again.' }, { status: 502 })
    }
  } catch (err) {
    console.error('[tech-guide] fetch threw:', err)
    return NextResponse.json(
      { error: `AI service unreachable: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }

  function parseRaw(rawText: string): TechGuide {
    let text = rawText.trim()
    // Strip markdown code fences wherever they appear
    text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
    // Use depth-counting extraction to find the true outermost JSON object,
    // immune to trailing explanation text that contains its own { } characters.
    const extracted = extractOutermostJSON(text)
    if (!extracted) throw new Error('No JSON object found in response')
    return JSON.parse(extracted)
  }

  let guide: TechGuide
  console.log('[tech-guide] raw length:', raw.length, 'raw preview:', raw.substring(0, 300))
  try {
    guide = parseRaw(raw)
  } catch (firstErr) {
    console.error('[tech-guide] First parse attempt failed:', firstErr instanceof Error ? firstErr.message : firstErr)
    console.error('[tech-guide] Full raw response:', raw)

    // Retry once — Claude occasionally produces off outputs
    console.log('[tech-guide] Retrying Claude API call...')
    try {
      const retryRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-6',
          max_tokens: 4000,
          system:     SYSTEM_PROMPT,
          messages:   [{ role: 'user', content: userMessage }],
        }),
      })
      if (retryRes.ok) {
        const retryData = await retryRes.json()
        const retryRaw  = retryData.content?.[0]?.text ?? ''
        console.log('[tech-guide] Retry raw length:', retryRaw.length, 'preview:', retryRaw.substring(0, 300))
        guide = parseRaw(retryRaw)
      } else {
        throw firstErr
      }
    } catch (retryErr) {
      console.error('[tech-guide] Retry also failed:', retryErr instanceof Error ? retryErr.message : retryErr)
      return NextResponse.json(
        { error: `AI response could not be parsed: ${firstErr instanceof Error ? firstErr.message : 'JSON parse error'}` },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({ guide })
}
