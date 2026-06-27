import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
import {
  TRUCK_SYSTEM_PROMPT,
  TRUCK_WEB_SEARCH_DIRECTIVE,
  TRUCK_FALLBACK_ANALYSIS,
} from '@/lib/hd/truck-diagnostic'

// Dedicated truck-engine DTC route. Streams the answer back so the connection
// stays alive while web search runs (a full search can take 10-30s) and the tech
// sees text as it arrives, instead of buffering the whole response and risking
// the Vercel function timeout. Capped at 60s (Vercel Pro).
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
    const baseParams = {
      model:      'claude-haiku-4-5-20251001' as const,
      max_tokens: 1500,
      system:     `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
      messages:   [{ role: 'user' as const, content: truckUserPrompt }],
    }

    const encoder = new TextEncoder()

    // Stream the answer as plain text. Web search first; if it errors before any
    // text streamed, fall back to a plain (no-tools) call; only emit the
    // placeholder if everything fails — never leave the tech with a blank box.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let emitted = false
        const emit = (text: string) => {
          if (text) { emitted = true; controller.enqueue(encoder.encode(text)) }
        }

        // Run one streaming Claude call, piping text deltas to the client.
        async function pipe(useWebSearch: boolean) {
          const s = useWebSearch
            ? client.messages.stream({ ...baseParams, tools: [webSearchTool] }, { maxRetries: 0, timeout: 55_000 })
            : client.messages.stream(baseParams, { maxRetries: 0, timeout: 45_000 })
          for await (const event of s) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              emit(event.delta.text)
            }
          }
          const final = await s.finalMessage()
          // [TRUCK-DIAG] temporary: surface the stream's stop_reason + which mode produced it
          console.log('[TRUCK-DIAG] stream finished — webSearch:', useWebSearch, 'stop_reason:', final.stop_reason, 'usage:', JSON.stringify(final.usage))
          console.log('[hd/truck-diagnostic] stream done — webSearch:', useWebSearch, 'stop_reason:', final.stop_reason, 'tokens:', JSON.stringify(final.usage))
        }

        try {
          await pipe(true)              // web search
          // [TRUCK-DIAG] temporary: if text streamed here, the web-search path won
          if (emitted) console.log('[TRUCK-DIAG] final response produced by: WEB-SEARCH path')
        } catch (searchErr) {
          const searchSummary = summarizeErr('web search stream', searchErr)
          // [TRUCK-DIAG] temporary: exact failure of the web-search call
          console.error('[TRUCK-DIAG] web-search path threw:', searchSummary, '— emittedSoFar:', emitted)
        }
        // Web search errored OR produced no text — try a plain call (only if
        // nothing has streamed yet, so we never duplicate output).
        if (!emitted) {
          console.log('[TRUCK-DIAG] web-search path produced no text — attempting standard (no-tools) fallback')
          try {
            await pipe(false)
            // [TRUCK-DIAG] temporary: if text streamed here, the fallback path won
            if (emitted) console.log('[TRUCK-DIAG] final response produced by: STANDARD FALLBACK path')
          } catch (fallbackErr) {
            const fallbackSummary = summarizeErr('standard fallback stream', fallbackErr)
            // [TRUCK-DIAG] temporary: exact failure of the no-tools fallback call
            console.error('[TRUCK-DIAG] standard fallback path threw:', fallbackSummary, '— emittedSoFar:', emitted)
          }
        }
        if (!emitted) {
          // [TRUCK-DIAG] temporary: both live calls failed — client gets the canned placeholder as a 200
          console.error('[TRUCK-DIAG] final response produced by: PLACEHOLDER (both calls failed)')
          console.error('[hd/truck-diagnostic] all calls failed — emitting placeholder')
          emit(TRUCK_FALLBACK_ANALYSIS)
        }
        controller.close()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type':      'text/plain; charset=utf-8',
        'Cache-Control':     'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const outerSummary = summarizeErr('truck diagnostic (outer)', err)
    // [TRUCK-DIAG] temporary: pre-stream failure (auth/parse/etc.) — placeholder returned as a 200
    console.error('[TRUCK-DIAG] final response produced by: OUTER CATCH placeholder (pre-stream failure):', outerSummary)
    // Pre-stream failure (auth/parse/etc.) — return the placeholder as plain
    // text so the client renders it the same way as a streamed answer.
    return new Response(TRUCK_FALLBACK_ANALYSIS, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
