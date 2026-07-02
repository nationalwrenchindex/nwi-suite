import { NextResponse, type NextRequest, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'
import { generateDiagnostic } from '@/lib/gemini/client'
import { formatParts } from '@/lib/gemini/formatter'
import { sendNewCacheAlert } from '@/lib/email-alerts'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const PARTS_SYSTEM_PROMPT = `You are a transport refrigeration parts specialist with expert knowledge of Thermo King and Carrier Transicold parts catalogs, supersession chains, and cross-reference numbers.

When given a unit model and fault code, provide a complete parts list for that repair. Always include:
1. Primary OEM part number (current, not superseded)
2. Supersession chain if the part has been updated (old to new)
3. Aftermarket cross-reference numbers if available
4. Thread size, pressure rating, or electrical specs where relevant
5. Quantity typically needed for the repair
6. Approximate cost range if known

FORMAT AS A CLEAN PARTS LIST:
PARTS FOR [MANUFACTURER] [MODEL] — [CODE/FAULT]:

[Part Name]
OEM Part Number: XXXXX (supersedes XXXXX)
Aftermarket: [brand] XXXXX
Spec: [thread/pressure/voltage spec]
Qty: [number]
Est. Cost: $XX to $XX

If part numbers are uncertain or vary by build year, state that clearly and tell the tech what to provide to their dealer for exact identification (serial number, compressor model, refrigerant type). Never guess part numbers. If uncertain, say so and provide the best available cross-reference information.

CRITICAL RULES:
1. Only return parts that are DIRECTLY related to diagnosing or repairing the specific fault code provided. Never return parts for unrelated systems (e.g. do not return pressure transducers for an electric motor fault, do not return controller boards unless the fault is specifically a controller fault).

2. If you cannot find the specific OEM part number for a component, say exactly: 'Part number not available in public sources — provide unit serial number to TK/Carrier dealer for exact identification.' Do not substitute unrelated parts to fill space.

3. Focus on the most likely failed components for this specific fault code. For an electric motor fault, return motor assembly, contactor, and overload relay — not sensors or controllers.

4. A parts list with 2 accurate parts is better than a parts list with 8 parts where 6 are wrong or unrelated.`

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: {
    manufacturer?:   string
    model?:          string
    alarmCode?:      string
    displayMessage?: string
    unitType?:       string
    serialNumber?:   string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const manufacturer   = (body.manufacturer   ?? '').trim()
  const model          = (body.model          ?? '').trim()
  const alarmCode      = (body.alarmCode      ?? '').trim()
  const displayMessage = (body.displayMessage ?? '').trim()
  const unitType       = (body.unitType       ?? '').trim()

  if (!manufacturer || !model) {
    return NextResponse.json({ error: 'manufacturer and model required' }, { status: 400 })
  }

  const cacheKey = `parts-${manufacturer}-${model}-${alarmCode}`

  // 1. Cache check — parts_manager entries only, and only if not expired.
  const { data: cached } = await supabase
    .from('hd_cached_diagnostics')
    .select('result_html, expires_at')
    .eq('cache_key', cacheKey)
    .eq('source', 'parts_manager')
    .maybeSingle()
  if (cached?.result_html) {
    const notExpired = !cached.expires_at || new Date(cached.expires_at) > new Date()
    if (notExpired) {
      try {
        await createServiceClient().rpc('increment_hd_cache_hit', { p_cache_key: cacheKey })
      } catch (e) {
        console.error('[hd/parts-manager] cache hit increment failed', e)
      }
      return NextResponse.json({ parts: cached.result_html, cached: true })
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'Parts service not configured' }, { status: 503 })
  }

  // 2. Gemini parts query (grounded).
  const userPrompt = `Provide the complete parts list for repairing a ${manufacturer} ${model}${unitType ? ' ' + unitType : ''} with alarm ${alarmCode || 'the reported fault'}${displayMessage ? ` (${displayMessage})` : ''}. Include all OEM part numbers, supersession chains, aftermarket cross-references, and specifications.`

  let raw = ''
  try {
    const { text } = await generateDiagnostic(userPrompt, PARTS_SYSTEM_PROMPT)
    raw = text.trim()
  } catch (err) {
    console.error('[hd/parts-manager] Gemini parts lookup failed', err)
    return NextResponse.json({ error: 'Parts lookup failed. Please try again.' }, { status: 502 })
  }
  if (!raw) {
    return NextResponse.json({ error: 'No parts information found.' }, { status: 502 })
  }

  // 3. Haiku formatting pass.
  const formatted = (await formatParts(raw)).trim()

  // 4. Cache with a 12-month expiry; notify founders on a genuinely new write.
  const expiresAt = new Date()
  expiresAt.setMonth(expiresAt.getMonth() + 12)
  try {
    const { error: cacheErr } = await createServiceClient().from('hd_cached_diagnostics').upsert({
      cache_key:    cacheKey,
      manufacturer,
      alarm_code:   alarmCode || null,
      unit_model:   model,
      result_html:  formatted,
      source:       'parts_manager',
      needs_review: true,   // parts results need founder review before being trusted
      expires_at:   expiresAt.toISOString(),
    }, { onConflict: 'cache_key' })
    if (cacheErr) {
      console.error('[hd/parts-manager] cache write failed', cacheErr)
    } else {
      after(() => sendNewCacheAlert({
        manufacturer,
        unitModel:      model,
        alarmCode:      alarmCode || '—',
        displayMessage,
        cacheKey,
        source:         'parts_manager',
      }))
    }
  } catch (e) {
    console.error('[hd/parts-manager] cache write failed', e)
  }

  return NextResponse.json({ parts: formatted })
}
