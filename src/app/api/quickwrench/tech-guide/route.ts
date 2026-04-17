// POST /api/quickwrench/tech-guide
// Calls Claude API to generate vehicle-specific repair guide with torque specs,
// step-by-step instructions, parts list, and difficulty rating.
// Requires ANTHROPIC_API_KEY in environment.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TechGuideRequest, TechGuide } from '@/types/quickwrench'

const SYSTEM_PROMPT = `You are a master automotive technician with 20+ years of experience.
When given a vehicle and job, respond ONLY with valid JSON — no markdown, no extra text.

Return this exact shape:
{
  "difficulty": "Easy" | "Moderate" | "Hard" | "Expert",
  "labor_hours": number,
  "overview": "2-3 sentences describing the job and what it involves",
  "torque_specs": [
    { "component": "string", "spec": "string", "notes": "string (optional)" }
  ],
  "repair_steps": ["string", ...],
  "special_tools": [
    { "name": "string", "notes": "string (optional)" }
  ],
  "warnings": ["string", ...],
  "parts_needed": [
    { "name": "string", "part_number_hint": "string", "qty": number, "price_estimate": number }
  ]
}

Rules:
- Be specific to the exact vehicle year/make/model/engine
- Include real torque specs in ft-lbs or Nm
- List steps numbered and detailed enough for a professional technician
- price_estimate should be realistic aftermarket retail pricing in USD
- labor_hours should be flat-rate book time
- Include all common replacement parts (not just primary parts)`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })
  }

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
        model:      'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      console.error('[tech-guide] Claude API error:', err)
      return NextResponse.json({ error: 'AI service error. Try again.' }, { status: 502 })
    }

    const claudeData = await claudeRes.json()
    raw = claudeData.content?.[0]?.text ?? ''
  } catch (err) {
    console.error('[tech-guide] fetch failed:', err)
    return NextResponse.json({ error: 'AI service unavailable.' }, { status: 502 })
  }

  let guide: TechGuide
  try {
    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
    guide = JSON.parse(cleaned)
  } catch (err) {
    console.error('[tech-guide] JSON parse failed. Raw:', raw.slice(0, 500), err)
    return NextResponse.json({ error: 'AI returned an unexpected format. Try again.' }, { status: 502 })
  }

  return NextResponse.json({ guide })
}
