// POST /api/quickwrench/tech-guide
// Calls Claude API to generate vehicle-specific repair guide with torque specs,
// step-by-step instructions, parts list, and difficulty rating.
// Requires ANTHROPIC_API_KEY in environment.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TechGuideRequest, TechGuide } from '@/types/quickwrench'

const SYSTEM_PROMPT = `You are an automotive technician. Respond ONLY with raw JSON — no markdown, no backticks, no preamble. First character must be {, last must be }.

Schema (all fields required):
{"torque":[{"part":"","spec":""}],"steps":[""],"tools":[""],"warning":"","hours":1,"parts":[""]}

Limits: max 3 torque, max 5 steps, max 3 tools, 1 warning sentence, max 4 parts. Be concise.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
        max_tokens: 2000,
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

  let guide: TechGuide
  try {
    console.log('[tech-guide] Raw Claude response:\n', raw)

    let text = raw.trim()

    // Strip all markdown code fences (handles ```json, ```JSON, ``` variants anywhere in the text)
    text = text.replace(/```(?:json|JSON)?\s*/g, '').replace(/```/g, '').trim()

    // Extract the outermost JSON object — handles any remaining preamble/postamble text
    const firstBrace = text.indexOf('{')
    const lastBrace  = text.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1)
    }

    console.log('[tech-guide] raw length:', raw.length, 'raw:', raw.substring(0, 500))
    console.log('[tech-guide] Attempting JSON parse, extracted length:', text.length)
    guide = JSON.parse(text)
  } catch (err) {
    console.error('[tech-guide] JSON parse failed.')
    console.error('[tech-guide] Parse error:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: `AI response could not be parsed: ${err instanceof Error ? err.message : 'JSON parse error'}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ guide })
}
