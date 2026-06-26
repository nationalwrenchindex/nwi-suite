import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
import {
  TRUCK_SYSTEM_PROMPT,
  TRUCK_WEB_SEARCH_DIRECTIVE,
  TRUCK_DISCLAIMER,
  TRUCK_FALLBACK_ANALYSIS,
} from '@/lib/hd/truck-diagnostic'

// Dedicated truck-engine DTC route with its own duration budget, independent of
// the main QuickWrench route (which also serves reefer codes). Vercel Pro caps
// serverless functions at 60s — web search 30s + fallback 20s = 50s, safely under.
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Small helper so every failure path logs a consistent, inspectable line.
function logErr(stage: string, err: unknown) {
  const e = err as { name?: string; message?: string; status?: number; stack?: string }
  console.error(`[hd/truck-diagnostic] ${stage} failed:`, JSON.stringify({
    name:    e?.name,
    message: e?.message,
    status:  e?.status,
    stack:   e?.stack?.split('\n').slice(0, 4).join(' | '),
  }))
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const hasAccess = await checkHDAccess(user.id)
    if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })

    let body: {
      truckBrand?:   string
      engineModel?:  string
      spn?:          string
      fmi?:          string
      symptom?:      string
      vehicleYear?:  string
      vehicleMake?:  string
      vehicleModel?: string
      vehicleEngine?: string
    }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const { truckBrand, engineModel, spn, fmi, symptom: truckSymptom, vehicleYear, vehicleMake, vehicleModel, vehicleEngine } = body
    if (!truckBrand || !engineModel) {
      return NextResponse.json({ error: 'truckBrand and engineModel required' }, { status: 400 })
    }
    if (!spn && !fmi && !truckSymptom) {
      return NextResponse.json({ error: 'SPN, FMI, or symptom required' }, { status: 400 })
    }

    // Vehicle identity drives vehicle-specific results — surface it first so the
    // model searches for the exact year/make/model + code (or asks if missing).
    const vehicleBits = [
      vehicleYear?.trim()   ? `Year: ${vehicleYear.trim()}`     : null,
      vehicleMake?.trim()   ? `Make: ${vehicleMake.trim()}`     : null,
      vehicleModel?.trim()  ? `Model: ${vehicleModel.trim()}`   : null,
      vehicleEngine?.trim() ? `Engine: ${vehicleEngine.trim()}` : null,
    ].filter(Boolean)

    // Explicit web search query: always year + make + model + engine brand +
    // engine model + SPN + FMI — never the SPN alone.
    // e.g. "2020 Freightliner Cascadia DD13 SPN 3031 FMI 3 diagnostic repair procedure"
    const searchQuery = [
      vehicleYear?.trim(),
      vehicleMake?.trim(),
      vehicleModel?.trim(),
      truckBrand,
      engineModel,
      spn ? `SPN ${spn}` : null,
      (fmi !== undefined && fmi !== '') ? `FMI ${fmi}` : null,
    ].filter(Boolean).join(' ').trim()

    const parts: string[] = []
    if (vehicleBits.length > 0) parts.push(`Vehicle — ${vehicleBits.join(', ')}`)
    else parts.push('Vehicle: not specified — ask the tech for year, make, and model before giving a vehicle-specific answer.')
    parts.push(`Engine: ${truckBrand} ${engineModel}`)
    if (spn)          parts.push(`SPN (Suspect Parameter Number): ${spn}`)
    if (fmi !== undefined && fmi !== '') parts.push(`FMI (Failure Mode Identifier): ${fmi}`)
    if (truckSymptom) parts.push(`Symptom/Question: ${truckSymptom}`)
    if (searchQuery)  parts.push(`Run this web search first: "${searchQuery} diagnostic repair procedure"`)
    const truckUserPrompt = parts.join('\n')

    const client = new Anthropic({ apiKey })

    // Web search first for vehicle-specific results (TSBs, recalls, part numbers).
    // On any timeout/error, fall back to a standard call so the tech still gets
    // an answer. 30s + 20s = 50s, under the 60s function cap.
    let msg
    try {
      msg = await client.messages.create(
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 1500,
          system:     `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
            },
          ],
          messages:   [{ role: 'user', content: truckUserPrompt }],
        },
        { timeout: 30_000, maxRetries: 0 },
      )
    } catch (searchErr) {
      logErr('web search call', searchErr)
      msg = await client.messages.create(
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 1500,
          system:     `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
          messages:   [{ role: 'user', content: truckUserPrompt }],
        },
        { timeout: 20_000, maxRetries: 0 },
      )
    }

    const analysis = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()

    console.log('[hd/truck-diagnostic] stop_reason:', msg.stop_reason, 'tokens:', JSON.stringify(msg.usage), 'chars:', analysis.length)
    if (!analysis) console.error('[hd/truck-diagnostic] empty analysis returned — placeholder will show. stop_reason:', msg.stop_reason)

    return NextResponse.json({
      analysis: analysis || TRUCK_FALLBACK_ANALYSIS,
      tk_sources: [],
      alarm_pattern: null,
      disclaimer: TRUCK_DISCLAIMER,
    })
  } catch (err) {
    logErr('truck diagnostic (both calls)', err)
    return NextResponse.json({
      analysis: TRUCK_FALLBACK_ANALYSIS,
      tk_sources: [],
      alarm_pattern: null,
      disclaimer: TRUCK_DISCLAIMER,
    })
  }
}
