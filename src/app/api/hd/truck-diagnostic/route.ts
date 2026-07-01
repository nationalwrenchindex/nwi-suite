import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import Anthropic from '@anthropic-ai/sdk'
import {
  TRUCK_SYSTEM_PROMPT,
  TRUCK_WEB_SEARCH_DIRECTIVE,
  TRUCK_FALLBACK_ANALYSIS,
} from '@/lib/hd/truck-diagnostic'
import { generateDiagnostic } from '@/lib/gemini/client'
import { formatDiagnostic } from '@/lib/gemini/formatter'
import { detectsHazard } from '@/lib/gemini/hazard'
import { sendNewCacheAlert } from '@/lib/email-alerts'

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

    // ── Response cache (engine + fault-code keyed) ──────────────────────────
    // The key is faithful only when the answer depends solely on engine brand +
    // model + SPN/FMI. Skip the cache for vehicle-specific or free-text-symptom
    // queries — their answers vary beyond the key, so a hit could otherwise
    // return a wrong-vehicle result.
    const spnKey = spn?.trim() ?? ''
    const fmiKey = fmi?.trim() ?? ''
    const vehicleSpecific = !!(vehicleYear?.trim() || vehicleMake?.trim() || vehicleModel?.trim() || vehicleEngine?.trim())
    const cacheable = (spnKey.length > 0 || fmiKey.length > 0) && !(truckSymptom?.trim()) && !vehicleSpecific
    const cacheKey  = `truck-${truckBrand}-${engineModel}-${spnKey}-${fmiKey}`

    if (cacheable) {
      const { data: cached } = await supabase
        .from('hd_cached_diagnostics')
        .select('result_html')
        .eq('cache_key', cacheKey)
        .maybeSingle()
      if (cached?.result_html) {
        // Hit — return the cached result with NO API call. Atomic single-UPDATE
        // hit counter via the service client (no user write policy).
        try {
          await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey })
        } catch (e) {
          console.error('[hd/truck-diagnostic] cache hit increment failed', e)
        }
        return new Response(cached.result_html, {
          headers: {
            'Content-Type':      'text/plain; charset=utf-8',
            'Cache-Control':     'no-store, no-transform',
            'X-Accel-Buffering': 'no',
          },
        })
      }
    }

    const client  = new Anthropic({ apiKey })
    const encoder = new TextEncoder()

    // Primary path: Gemini 2.5 Flash (grounded search) generates, Haiku formats,
    // then the formatted result is streamed. Gemini/Haiku are not incremental,
    // so the answer is emitted once it's ready — the response is still a stream
    // so the connection stays alive during generation. Plain Haiku (no
    // grounding) is the fallback; the canned placeholder is the last resort and
    // is never cached.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let emitted = false
        let full = ''
        let citations: string[] = []
        let usedSource = 'gemini_web_search'
        const emit = (text: string) => {
          if (text) { emitted = true; full += text; controller.enqueue(encoder.encode(text)) }
        }

        // 1. Gemini grounded generation + Haiku formatting.
        try {
          const { text: rawText, citations: cites } = await generateDiagnostic(
            truckUserPrompt,
            `${TRUCK_WEB_SEARCH_DIRECTIVE}\n\n${TRUCK_SYSTEM_PROMPT}`,
          )
          if (rawText.trim()) {
            const formatted = await formatDiagnostic(rawText, {
              engineBrand: truckBrand, engineModel, spn: spnKey, fmi: fmiKey,
            })
            citations = cites
            emit(formatted.trim())
          }
        } catch (gemErr) {
          summarizeErr('gemini diagnostic', gemErr)
        }

        // 2. Fallback: plain Haiku (no grounding) if Gemini produced nothing.
        if (!emitted) {
          usedSource = 'haiku_fallback'
          try {
            const msg = await client.messages.create(
              {
                model:      'claude-haiku-4-5-20251001',
                max_tokens: 1500,
                system:     TRUCK_SYSTEM_PROMPT,
                messages:   [{ role: 'user', content: truckUserPrompt }],
              },
              { maxRetries: 0, timeout: 45_000 },
            )
            const t = msg.content
              .filter(b => b.type === 'text')
              .map(b => (b as Anthropic.TextBlock).text)
              .join('\n')
              .trim()
            emit(t)
          } catch (fallbackErr) {
            summarizeErr('haiku fallback', fallbackErr)
          }
        }

        // Capture whether genuine AI text was produced BEFORE the placeholder
        // branch, so the canned TRUCK_FALLBACK_ANALYSIS is never cached.
        const producedReal = emitted
        if (!emitted) {
          console.error('[hd/truck-diagnostic] all calls failed — emitting placeholder')
          emit(TRUCK_FALLBACK_ANALYSIS)
        }

        // Cache genuine AI results only — never the placeholder. Flag hazardous
        // electrical content for founder review.
        if (cacheable && producedReal && full.trim() && full !== TRUCK_FALLBACK_ANALYSIS) {
          try {
            const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
              cache_key:    cacheKey,
              engine_brand: truckBrand,
              engine_model: engineModel,
              spn:          spnKey || null,
              fmi:          fmiKey || null,
              result_html:  full,
              source:       usedSource,
              citations,
              needs_review: detectsHazard(full),
            }, { onConflict: 'cache_key' })
            if (cacheErr) {
              console.error('[hd/truck-diagnostic] cache write failed', cacheErr)
            } else {
              // New cache write succeeded — notify founders. The diagnostic text
              // is already streamed to the tech, so awaiting the email here does
              // not block their answer.
              await sendNewCacheAlert({
                manufacturer:   truckBrand,
                unitModel:      engineModel,
                alarmCode:      [spnKey && `SPN ${spnKey}`, fmiKey && `FMI ${fmiKey}`].filter(Boolean).join(' ') || '—',
                displayMessage: '',
                cacheKey,
                source:         usedSource,
              })
            }
          } catch (e) {
            console.error('[hd/truck-diagnostic] cache write failed', e)
          }
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
    summarizeErr('truck diagnostic (outer)', err)
    // Pre-stream failure (auth/parse/etc.) — return the placeholder as plain
    // text so the client renders it the same way as a streamed answer.
    return new Response(TRUCK_FALLBACK_ANALYSIS, {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
