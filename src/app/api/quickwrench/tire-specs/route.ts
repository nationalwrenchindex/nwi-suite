import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'

const SYSTEM_PROMPT = `You are an expert automotive technician with access to OEM specification databases. Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Schema (all fields required, use null if genuinely uncertain):
{"tire_size_front":"","tire_size_rear":"","lug_torque_lb_ft":0,"bolt_pattern":"","tire_pressure_front_psi":0,"tire_pressure_rear_psi":0,"load_speed_rating":"","wheel_size":""}

Rules:
- tire_size_front / tire_size_rear: OEM size string like "225/65R17". Same value for both if front = rear. null only if truly unknown.
- lug_torque_lb_ft: integer lb-ft (e.g. 140). null if unknown.
- bolt_pattern: metric format like "6x139.7" or "5x114.3". null if unknown.
- tire_pressure_front_psi / tire_pressure_rear_psi: integer PSI from door jamb spec. null if unknown.
- load_speed_rating: like "100H" or "XL 107V". null if unknown.
- wheel_size: like "17x7.5". null if unknown.
- Use null only if you are not confident — never guess.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })

  let body: { year: string; make: string; model: string; trim?: string; engine?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { year, make, model, trim, engine } = body
  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make, and model are required.' }, { status: 400 })
  }

  const vehicleDesc = [year, make, model, trim, engine].filter(Boolean).join(' ')

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
        max_tokens: 400,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `Provide OEM tire specifications for a ${vehicleDesc}.` }],
      }),
    })

    if (!claudeRes.ok) {
      const errBody = await claudeRes.text()
      return NextResponse.json({ error: `AI service error: ${errBody}` }, { status: 502 })
    }

    const claudeData = await claudeRes.json()
    raw = claudeData.content?.[0]?.text ?? ''
    if (!raw) return NextResponse.json({ error: 'Empty AI response.' }, { status: 502 })
  } catch (err) {
    return NextResponse.json({ error: `AI unreachable: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }

  try {
    let text = raw.trim().replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()
    const first = text.indexOf('{')
    const last  = text.lastIndexOf('}')
    if (first !== -1 && last > first) text = text.slice(first, last + 1)
    const specs = JSON.parse(text)
    return NextResponse.json({ specs })
  } catch {
    console.error('[tire-specs] parse failed, raw:', raw)
    return NextResponse.json({ error: 'Failed to parse tire specs response.' }, { status: 502 })
  }
}
