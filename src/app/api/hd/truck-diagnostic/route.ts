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

// Pull the useful, inspectable bits out of an Anthropic/SDK error so the exact
// failure (status, error type, message, request id) shows up in logs AND in the
// _debug field of the response. Returns a short one-line summary.
function summarizeErr(stage: string, err: unknown): string {
  const e = err as {
    name?: string; message?: string; status?: number
    error?: { error?: { type?: string; message?: string } }
    headers?: Record<string, string> | { get?: (k: string) => string | null }
    stack?: string
  }
  let requestId: string | undefined
  try {
    const h = e?.headers as { get?: (k: string) => string | null } | undefined
    requestId = (typeof h?.get === 'function' ? h.get('request-id') : undefined) ?? undefined
  } catch { /* ignore */ }

  const summary = {
    stage,
    name:    e?.name,
    status:  e?.status,
    apiType: e?.error?.error?.type,
    apiMsg:  e?.error?.error?.message,
    message: e?.message,
    requestId,
  }
  console.error(`[hd/truck-diagnostic] ${stage} failed:`, JSON.stringify(summary))
  if (e?.stack) console.error(`[hd/truck-diagnostic] ${stage} stack:`, e.stack.split('\n').slice(0, 4).join(' | '))
  return `${stage}: ${e?.status ?? ''} ${e?.error?.error?.type ?? e?.name ?? ''} ${e?.error?.error?.message ?? e?.message ?? 'unknown error'}`.trim()
}

export async function POST(req: NextRequest) {
  console.log('[hd/truck-diagnostic] POST received')
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const hasAccess = await checkHDAccess(user.id)
    if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

    // #2/#7 — confirm the API key is actually present in this route's runtime.
    // (Logs presence + length only — never the key itself.)
    const apiKey = process.env.ANTHROPIC_API_KEY
    console.log('[hd/truck-diagnostic] ANTHROPIC_API_KEY present:', !!apiKey, 'length:', apiKey?.length ?? 0)
    if (!apiKey) {
      console.error('[hd/truck-diagnostic] ANTHROPIC_API_KEY missing — this is the immediate-fallback cause')
      return NextResponse.json({ error: 'AI service not configured' }, { status: 503 })
    }

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

    const webSearchTool = { type: 'web_search_20250305' as const, name: 'web_search' as const }

    // Web search first for vehicle-specific results (TSBs, recalls, part numbers).
    // If it errors, fall back to a standard (no-tools) call. If BOTH error we
    // return the placeholder — and now also surface the exact reason in _debug.
    // 30s + 20s = 50s, under the 60s function cap.
    let msg: Anthropic.Message | undefined
    let debug = ''
    let usedWebSearch = false

    try {
      console.log('[hd/truck-diagnostic] calling web search — tools:', JSON.stringify([webSearchTool]))
      msg = await client.messages.create(
        {
          model:      'claude-sonnet-4-6',
          max_tokens: 1500,
          system:     `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
          tools:      [webSearchTool],
          messages:   [{ role: 'user', content: truckUserPrompt }],
        },
        { timeout: 30_000, maxRetries: 0 },
      )
      usedWebSearch = true
    } catch (searchErr) {
      debug = summarizeErr('web search call', searchErr)
      // Fall back to a plain call so the tech still gets an answer.
      try {
        console.log('[hd/truck-diagnostic] web search failed — trying standard fallback call')
        msg = await client.messages.create(
          {
            model:      'claude-sonnet-4-6',
            max_tokens: 1500,
            system:     `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
            messages:   [{ role: 'user', content: truckUserPrompt }],
          },
          { timeout: 20_000, maxRetries: 0 },
        )
      } catch (fallbackErr) {
        debug = `${debug} || ${summarizeErr('standard fallback call', fallbackErr)}`
        return NextResponse.json({
          analysis: TRUCK_FALLBACK_ANALYSIS,
          tk_sources: [],
          alarm_pattern: null,
          disclaimer: TRUCK_DISCLAIMER,
          _debug: debug,
        })
      }
    }

    const analysis = msg.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n')
      .trim()

    // Did the model actually run a server-side web search?
    const searchUses = msg.content.filter(b => b.type === 'server_tool_use').length
    console.log('[hd/truck-diagnostic] done — stop_reason:', msg.stop_reason, 'usedWebSearchTool:', usedWebSearch, 'serverToolUses:', searchUses, 'tokens:', JSON.stringify(msg.usage), 'chars:', analysis.length)
    if (!analysis) console.error('[hd/truck-diagnostic] empty analysis returned — placeholder will show. stop_reason:', msg.stop_reason)

    return NextResponse.json({
      analysis: analysis || TRUCK_FALLBACK_ANALYSIS,
      tk_sources: [],
      alarm_pattern: null,
      disclaimer: TRUCK_DISCLAIMER,
      ...(analysis ? {} : { _debug: `empty analysis; stop_reason=${msg.stop_reason}; ${debug}` }),
    })
  } catch (err) {
    const debug = summarizeErr('truck diagnostic (outer)', err)
    return NextResponse.json({
      analysis: TRUCK_FALLBACK_ANALYSIS,
      tk_sources: [],
      alarm_pattern: null,
      disclaimer: TRUCK_DISCLAIMER,
      _debug: debug,
    })
  }
}
