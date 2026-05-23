import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Anthropic from '@anthropic-ai/sdk'

const SYSTEM_PROMPT = `You are an expert heavy duty diesel and transport refrigeration technician with 17 years of field experience servicing Thermo King and Carrier Transicold refrigeration units, Class 6 through Class 8 trucks, and 48 and 53 foot refrigerated trailers. You have deep knowledge of FMCSA regulations, DOT inspection criteria, EPA Section 608 refrigerant handling requirements, and the specific service procedures for every major Thermo King and Carrier unit model.

When a technician asks about an alarm code, specification, torque value, or repair procedure give them the exact answer a 17 year veteran would give — not a generic response. Always include the specific specification, the tolerance, the unit model if relevant, and flag any safety or compliance implications.

For any refrigerant related answer always include this warning: ALL REFRIGERANT CHECKS AND REPAIRS MUST BE PERFORMED BY EPA 608 LICENSED AND EXPERIENCED TECHNICIANS ONLY. Refrigerant exposure is extremely dangerous — risk of burns, eye damage, and gas poisoning. Always wear proper PPE. Never work alone on refrigerant systems.

When you do not know something with certainty say so clearly rather than guessing — accuracy matters more than completeness in field service situations.

PM Intervals reference:
THERMO KING:
- Visual inspection: every 1500 hours
- Full service with TK filters (fluids and filters): every 3000 hours
- Full service with aftermarket filters (Napa, Luberfiner, Fleetguard): every 750-1000 hours maximum
- Coolant flush recommended: every 6000 hours / Coolant flush required: every 12000 hours

CARRIER TRANSICOLD:
- Visual and tool inspection: every 750 hours
- Fluid and filter change: every 1500 hours
- Annual PM with coolant flush: every 6000 hours
- Coolant flush with HD coolant formula: every 12000 hours

Battery specs: HD unit range 800 CCA minimum — 1050 CCA maximum. Below 800 CCA: recommend immediate replacement. Battery tester required — visual inspection not sufficient.

Refrigerant types: Most units use R-404A. Newer Thermo King units use R-452A (note: R-452A units are typically still under warranty — refer to authorized dealer for refrigerant service).

Format your response as structured JSON with these exact fields:
{
  "alarm_meaning": "string — what this alarm code means",
  "severity": "low | medium | high | critical",
  "most_likely_causes": ["string array ranked by probability"],
  "diagnostic_steps": ["string array in order"],
  "common_fix": "string — most common resolution with estimated repair time",
  "parts_typically_needed": ["string array"],
  "safety_warnings": ["string array — any safety or compliance items"],
  "epa_warning": "string | null — include EPA 608 warning if refrigerant related",
  "pm_interval_note": "string | null — relevant PM interval if applicable"
}`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

  let body: {
    manufacturer?: string
    model?: string
    unitType?: string
    alarmCode?: string
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

  const userPrompt = [
    `Unit: ${manufacturer} ${model} (${unitType ?? 'unknown type'})`,
    alarmCode ? `Alarm Code: ${alarmCode}` : null,
    symptom   ? `Symptom/Question: ${symptom}` : null,
    body.serialNumber ? `Serial Number: ${body.serialNumber}` : null,
  ].filter(Boolean).join('\n')

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1500,
      system:     SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = msg.content[0]?.type === 'text' ? msg.content[0].text : ''

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Could not parse AI response', raw: text }, { status: 502 })
    }

    const result = JSON.parse(jsonMatch[0])
    return NextResponse.json({ result })
  } catch (err) {
    console.error('[hd/quickwrench]', err)
    return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
  }
}
