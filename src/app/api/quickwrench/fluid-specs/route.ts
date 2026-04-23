import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'

const SYSTEM_PROMPT = `You are an automotive fluids specialist. Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Schema (all fields required):
{"oil":"","coolant":"","transmission":"","brake":"","power_steering":"","notes":""}

Be specific to the exact vehicle year/make/model/engine. Use OEM-recommended specs. Keep each value to one concise phrase (e.g. "5W-30 Full Synthetic"). Notes field: one short sentence about any critical fluid considerations.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI service not configured.' }, { status: 503 })

  let body: { year: string; make: string; model: string; engine?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const { year, make, model, engine } = body
  if (!year || !make || !model) {
    return NextResponse.json({ error: 'year, make, and model are required.' }, { status: 400 })
  }

  const vehicleDesc = [year, make, model, engine].filter(Boolean).join(' ')

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
        max_tokens: 300,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: `Vehicle: ${vehicleDesc}\nProvide OEM fluid specifications.` }],
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
    console.error('[fluid-specs] parse failed, raw:', raw)
    return NextResponse.json({ error: 'Failed to parse fluid specs response.' }, { status: 502 })
  }
}
