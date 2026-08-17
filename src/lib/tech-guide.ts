// Shared vehicle-specific tech-guide generation (Gemini only).
// callTechGuideGemini is used by /api/quickwrench/tech-guide and
// /api/inspections/[id]/generate-quote. Same SYSTEM_PROMPT + JSON parser.

import type { TechGuide } from '@/types/quickwrench'
import { generateDiagnostic } from '@/lib/gemini/client'

const SYSTEM_PROMPT = `You are an automotive technician. Respond ONLY with raw JSON — no markdown, no backticks, no preamble, no explanation after. First character must be { and last character must be }. Do not write anything before or after the JSON object.

CRITICAL: Output ONLY valid JSON. No markdown code fences. No explanations before or after. No "Here is your response" text. Start your response with { and end with }. Nothing else.

Schema (all fields required):
{"torque":[{"part":"","spec":""}],"steps":[""],"tools":[""],"warning":"","hours":1,"parts":[{"name":"","qty":1,"unit_cost":0.00,"unit_price":0.00}]}

For each part, include realistic demo pricing:
- unit_cost: what a mechanic pays at a supplier (use these ranges: motor oil $8-12/qt, oil filter $10-25, air filter $15-35, brake pads $45-95/set, brake rotor $65-150 each, brake hardware kit $15-30, trans filter kit $30-80, trans fluid $12-18/qt, coolant $18-25/gal, spark plug $8-25 each, power steering/brake fluid $12-20, grease/cleaners $4-15, drain plugs/gaskets $2-10, tires $80-180 each passenger/LT, TPMS sensor $20-45 each)
- unit_price: retail price customer pays — 15-25% above unit_cost, rounded to realistic cents (e.g. 45.99 not 45.38)

Limits: max 3 torque, max 5 steps, max 3 tools, 1 warning sentence, max 4 parts. Be concise.

TIRE SERVICE KNOWLEDGE:
- Tire size format: P265/70R17 → P=passenger, 265=width in mm, 70=aspect ratio % (sidewall height), R=radial, 17=rim diameter in inches. LT prefix = light truck. No prefix = Euro metric.
- OEM tires: match the exact size, load index, and speed rating on the door jamb sticker. Never deviate without customer approval.
- Aftermarket tires: same size but different brand — confirm load rating meets or exceeds OEM spec.
- Lug nut torque is vehicle-specific — always torque to spec (typical range 80–120 ft-lbs for passenger, 100–140 ft-lbs for trucks/SUVs). Retorque after 50 miles.
- Tire mounting: lubricate bead with approved lubricant only. Never use petroleum-based lube (degrades rubber).
- TPMS sensors: direct sensors require programming to vehicle after replacement. Use OEM-compatible replacement (vehicle-specific). After programming run TPMS relearn procedure per manufacturer (slow-speed drive or static procedure).
- Wheel balancing: always balance after tire replacement. Specify 0.25 oz increments. Road force balancing preferred for highway vehicles.
- Torque specs for lug nuts: Passenger cars 80-100 ft-lbs, light trucks/SUVs 100-130 ft-lbs, full-size pickups 120-150 ft-lbs. Always confirm vehicle-specific spec.`

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

/**
 * Coerces a parsed model response into a TechGuide with every field present.
 *
 * The parse used to cast straight to TechGuide, which made a missing key
 * indistinguishable from an empty one. When Gemini omitted `parts` — it is the
 * last field in the schema and the easiest to drop — the guide still rendered
 * (steps, torque and tools were there) while the Parts step received undefined
 * and reported "No parts data — go back and load the tech guide first". The
 * guide had in fact loaded; only the parts were silently missing.
 *
 * Field names are matched loosely for the same reason: a response keyed
 * `parts_needed` was a total loss before, and is now recovered.
 */
export function normaliseGuide(raw: unknown): TechGuide {
  const o = (raw ?? {}) as Record<string, unknown>
  const arr = (...keys: string[]): unknown[] => {
    for (const k of keys) if (Array.isArray(o[k])) return o[k] as unknown[]
    return []
  }

  const parts = arr('parts', 'parts_needed', 'partsNeeded', 'required_parts')
    .map(p => {
      if (typeof p === 'string') return p
      const q = p as Record<string, unknown>
      const name = typeof q?.name === 'string' ? q.name
                 : typeof q?.part === 'string' ? q.part
                 : null
      if (!name) return null
      return {
        name,
        qty:        Number(q.qty ?? q.quantity ?? 1) || 1,
        unit_cost:  Number(q.unit_cost  ?? q.cost  ?? 0) || 0,
        unit_price: Number(q.unit_price ?? q.price ?? 0) || 0,
      }
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)

  return {
    torque:  arr('torque', 'torque_specs') as TechGuide['torque'],
    steps:   arr('steps', 'repair_steps').filter((s): s is string => typeof s === 'string'),
    tools:   arr('tools').filter((s): s is string => typeof s === 'string'),
    warning: typeof o.warning === 'string' ? o.warning : '',
    hours:   Number(o.hours ?? o.labor_hours ?? 0) || 0,
    parts,
  }
}

function parseRaw(rawText: string): TechGuide {
  let text = rawText.trim()
  text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
  const extracted = extractOutermostJSON(text)
  if (!extracted) throw new Error('No JSON object found in response')
  return normaliseGuide(JSON.parse(extracted))
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

// Gemini tech-guide generation. generateDiagnostic handles Google Search
// grounding + the 55s timeout. Two attempts before giving up. Returns the parsed
// TechGuide, or null if both attempts fail.
export async function callTechGuideGemini(
  vehicle: TechGuideVehicle,
  job:     TechGuideJobRef,
): Promise<TechGuide | null> {
  const vehicleDesc = [vehicle.year, vehicle.make, vehicle.model, vehicle.engine]
    .filter(Boolean)
    .join(' ')

  const userMessage = `Vehicle: ${vehicleDesc || 'Generic vehicle'}
Job: ${job.name}
Category: ${job.categoryLabel ?? job.name}

Provide the complete technical guide for this specific vehicle and job.`

  async function attempt(): Promise<TechGuide> {
    const { text } = await generateDiagnostic(userMessage, SYSTEM_PROMPT)
    if (!text) throw new Error('Empty response from Gemini')
    return parseRaw(text)
  }

  try {
    return await attempt()
  } catch (firstErr) {
    console.warn(
      '[callTechGuideGemini] First attempt failed, retrying:',
      job.name,
      firstErr instanceof Error ? firstErr.message : firstErr,
    )
    try {
      return await attempt()
    } catch (retryErr) {
      console.error(
        '[callTechGuideGemini] Both attempts failed for:',
        job.name,
        retryErr instanceof Error ? retryErr.message : retryErr,
      )
      return null
    }
  }
}
