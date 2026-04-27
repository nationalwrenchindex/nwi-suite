// Shared Claude API call for vehicle-specific tech guides.
// Imported by both /api/quickwrench/tech-guide and /api/inspections/[id]/generate-quote.

import type { TechGuide } from '@/types/quickwrench'

const SYSTEM_PROMPT = `You are an automotive technician. Respond ONLY with raw JSON — no markdown, no backticks, no preamble, no explanation after. First character must be { and last character must be }. Do not write anything before or after the JSON object.

CRITICAL: Output ONLY valid JSON. No markdown code fences. No explanations before or after. No "Here is your response" text. Start your response with { and end with }. Nothing else.

Schema (all fields required):
{"torque":[{"part":"","spec":""}],"steps":[""],"tools":[""],"warning":"","hours":1,"parts":[{"name":"","qty":1,"unit_cost":0.00,"unit_price":0.00}]}

For each part, include realistic demo pricing:
- unit_cost: what a mechanic pays at a supplier (use these ranges: motor oil $8-12/qt, oil filter $10-25, air filter $15-35, brake pads $45-95/set, brake rotor $65-150 each, brake hardware kit $15-30, trans filter kit $30-80, trans fluid $12-18/qt, coolant $18-25/gal, spark plug $8-25 each, power steering/brake fluid $12-20, grease/cleaners $4-15, drain plugs/gaskets $2-10)
- unit_price: retail price customer pays — 15-25% above unit_cost, rounded to realistic cents (e.g. 45.99 not 45.38)

Limits: max 3 torque, max 5 steps, max 3 tools, 1 warning sentence, max 4 parts. Be concise.`

function extractOutermostJSON(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth    = 0
  let inString = false
  let escape   = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape)                  { escape = false; continue }
    if (ch === '\\' && inString) { escape = true;  continue }
    if (ch === '"')              { inString = !inString; continue }
    if (inString)                { continue }
    if (ch === '{')              { depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function parseRaw(rawText: string): TechGuide {
  let text = rawText.trim()
  text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
  const extracted = extractOutermostJSON(text)
  if (!extracted) throw new Error('No JSON object found in response')
  return JSON.parse(extracted)
}

export interface TechGuideVehicle {
  year?:   string | number | null
  make?:   string | null
  model?:  string | null
  engine?: string | null
}

export interface TechGuideJobRef {
  name:           string
  categoryLabel?: string
}

async function attemptGuide(
  apiKey:      string,
  userMessage: string,
  timeoutMs:   number,
): Promise<TechGuide> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), timeoutMs)

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
      signal: controller.signal,
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      let detail = errBody
      try { detail = JSON.parse(errBody)?.error?.message ?? errBody } catch { /* ignore */ }
      throw new Error(`Claude API HTTP ${claudeRes.status}: ${detail}`)
    }

    const claudeData = await claudeRes.json()
    const raw        = claudeData.content?.[0]?.text ?? ''
    if (!raw) throw new Error('Empty response from Claude')

    return parseRaw(raw)
  } finally {
    clearTimeout(timer)
  }
}

// Returns parsed TechGuide, or null if both attempts fail.
export async function callTechGuide(
  apiKey:    string,
  vehicle:   TechGuideVehicle,
  job:       TechGuideJobRef,
  timeoutMs  = 15000,
): Promise<TechGuide | null> {
  const vehicleDesc = [vehicle.year, vehicle.make, vehicle.model, vehicle.engine]
    .filter(Boolean)
    .join(' ')

  const userMessage = `Vehicle: ${vehicleDesc || 'Generic vehicle'}
Job: ${job.name}
Category: ${job.categoryLabel ?? job.name}

Provide the complete technical guide for this specific vehicle and job.`

  try {
    return await attemptGuide(apiKey, userMessage, timeoutMs)
  } catch (firstErr) {
    console.warn(
      '[callTechGuide] First attempt failed, retrying:',
      job.name,
      firstErr instanceof Error ? firstErr.message : firstErr,
    )
    try {
      return await attemptGuide(apiKey, userMessage, timeoutMs)
    } catch (retryErr) {
      console.error(
        '[callTechGuide] Both attempts failed for:',
        job.name,
        retryErr instanceof Error ? retryErr.message : retryErr,
      )
      return null
    }
  }
}
