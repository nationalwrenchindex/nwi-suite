// POST /api/inspect/extract-invoice — read a photographed repair invoice with Claude.
//
// DELIBERATELY UNAUTHENTICATED, same capability model as the rest of /api/inspect: the
// QR sticker on the truck is the credential and the technician has no account.
//
// ⚠ THIS ROUTE IS DIFFERENT FROM THE OTHER PUBLIC ONES: it spends money. An open
// endpoint that accepts arbitrary bytes and forwards them to a metered vision API is a
// free-inference proxy for anyone who scrapes one unit id out of one QR code, and the
// bill lands on us, not on them. Every gate below exists for that reason and runs in
// this order, cheapest first, so nothing expensive happens on a request that was never
// going to be legitimate:
//
//   1. Content-Length rejected before the body is read at all.
//   2. unit_id must be a UUID.
//   3. Declared MIME must be image/jpeg or image/png.
//   4. Byte length must be <= 5MB — checked BEFORE any decode.
//   5. Magic bytes must match the declared type, because the declared type is just a
//      string the client chose. Without this, "image/png" is enough to forward
//      anything at all.
//   6. The unit must exist and be active. This is the real gate: the API call happens
//      only for a real truck, so a random id is a 404 for free.
//   7. A best-effort per-unit cooldown (see THROTTLE below).
//
// It returns data for a screen the tech then EDITS. Nothing here writes to the
// database; the write is a separate, explicit confirm to /api/inspect/service-entry.

import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase/service'
import {
  ALLOWED_IMAGE_TYPES,
  EMPTY_EXTRACTION,
  MAX_IMAGE_BYTES,
  extractJsonObject,
  normalizeExtraction,
  unreadFields,
  type AllowedImageType,
} from '@/lib/fleet-pro/service-entry'

export const dynamic = 'force-dynamic'
// A photo of a creased invoice takes the model a while to read. 60s is the Vercel Pro
// ceiling; the SDK call below is capped under it so we return an error rather than
// having the platform kill the function.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kept in step with /inspect/[unitId] and GET /api/inspect/[unitId].
const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

// The multipart envelope (boundaries, field names, base64 growth on some clients) on
// top of the 5MB image. Anything past this is not a photo of an invoice.
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024

const MODEL      = 'claude-opus-5'
const MAX_TOKENS = 3_000

// THROTTLE: best-effort only, and honestly so — module scope lives per serverless
// instance, so a distributed caller routes around it. It exists to blunt the cheap
// case (one device in a loop, or a double-tapped button) without a network round-trip.
// A real limit needs a shared counter; noted for follow-up.
const THROTTLE_MS = 4_000
const lastCallByUnit = new Map<string, number>()

function throttled(unitId: string): boolean {
  const now  = Date.now()
  const last = lastCallByUnit.get(unitId) ?? 0
  if (now - last < THROTTLE_MS) return true
  lastCallByUnit.set(unitId, now)
  // Bound the map so a long-lived instance cannot grow it without limit.
  if (lastCallByUnit.size > 500) {
    for (const [key, at] of lastCallByUnit) {
      if (now - at > THROTTLE_MS * 10) lastCallByUnit.delete(key)
    }
  }
  return false
}

const bad = (error: string, status = 400) =>
  NextResponse.json({ error, extracted: EMPTY_EXTRACTION }, { status })

/**
 * THE HALLUCINATION GUARD.
 *
 * The failure mode that matters here is not a blank field — it is a confident, wrong
 * number. A blank costs the tech five seconds on the confirmation screen. A plausible
 * total that nobody typed becomes this unit's cost history, rolls into the fleet's
 * spend report, and gets quoted back in an argument about a bill months later, with
 * nothing on the record to show it was invented. So the prompt is built to make
 * "null" the comfortable answer and guessing the uncomfortable one:
 *
 *   * the rule is stated once, absolutely, before the field list;
 *   * the CONSEQUENCE is spelled out, because "be accurate" is weaker than telling the
 *     model what a wrong number actually does downstream;
 *   * arithmetic is banned explicitly — computing a missing total from the other lines
 *     is the single most likely invention, and it is indistinguishable from a read;
 *   * partial reads are banned — half an invoice number is worse than none;
 *   * it is told a human reviews and corrects every field, which removes the
 *     "be helpful, fill it in" pressure entirely.
 */
const EXTRACTION_SYSTEM = `You are a transcription system for heavy-truck repair invoices. You output JSON and nothing else.

You are looking at a photograph taken by a technician standing in a shop or a yard. It may be crooked, glared, creased, shadowed, folded, partly out of frame, or out of focus.

THE RULE: report only what you can actually READ on the document. If a value is not printed on the page, or is printed but not legible, return null for that field. Do not infer it. Do not estimate it. Do not calculate it from the other numbers. Do not fill it in from what repair invoices usually contain.

Null is a correct answer and it is expected. Every field you return is shown to the technician on a confirmation screen before anything is saved, and he types in whatever you left blank — that costs him a few seconds. A confident wrong number costs far more, because it does not look wrong: it is saved as this truck's cost history, it feeds the fleet's spend reports, and it is used to argue about a repair bill months later. Blank beats plausible, every time.

Specifically:
- NEVER add up line items to produce a subtotal, tax or total that is not printed. If the total is not printed, total is null.
- NEVER complete a partially legible value. If two characters of an invoice number are unreadable, invoice_number is null, not a guess.
- NEVER assume the year on a date. If the printed date has no year, service_date is null.
- If the invoice shows one lump sum with no breakdown, put it in total and leave labor_cost, parts_cost and tax null.
- Transcribe text as written on the page in the shop's own words. Do not summarize, translate, tidy up, or expand abbreviations.

Fields:
- service_date: the date the work was performed or invoiced, as "YYYY-MM-DD".
- labor_description: the work performed, transcribed from the page.
- parts: an array of the parts actually itemized as line items, each { "name": string, "qty": number|null, "cost": number|null } where cost is the extended line cost as printed. Use [] if no parts are itemized.
- labor_cost, parts_cost, tax, total: numbers, only where printed with that meaning.
- vendor_name: the shop or vendor that ISSUED the invoice. Not the customer, not the fleet, not the truck owner.
- invoice_number: the invoice or work-order number as printed.

Numbers must be plain JSON numbers: no currency symbols, no thousands separators, no quotes.

Return the JSON object alone. No markdown fence, no explanation, no commentary before or after.`

/** PNG and JPEG signatures. The declared MIME type is client-controlled text; this is
 *  the only part of the request that is actually evidence of what the bytes are. */
function magicMatches(bytes: Uint8Array, declared: AllowedImageType): boolean {
  if (declared === 'image/png') {
    return bytes.length > 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

export async function POST(req: NextRequest) {
  // ── gate 1: size, before the body is touched ────────────────────────────────
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('Could not read the upload')
  }

  // ── gate 2: a real unit id ──────────────────────────────────────────────────
  const unitId = String(form.get('unit_id') ?? '')
  if (!UUID_RE.test(unitId)) return bad('Not found', 404)

  const file = form.get('image')
  if (!(file instanceof File)) return bad('No photo was attached')

  // ── gate 3: declared type ───────────────────────────────────────────────────
  const declaredType = file.type as AllowedImageType
  if (!ALLOWED_IMAGE_TYPES.includes(declaredType)) {
    return bad('Photos must be JPEG or PNG. Use your phone camera, not a scan or a PDF.', 415)
  }

  // ── gate 4: real byte length, BEFORE any decode ─────────────────────────────
  if (file.size > MAX_IMAGE_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }
  if (file.size < 1_024) return bad('That photo did not come through. Try again.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Belt and braces: File.size is reported by the client too.
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }

  // ── gate 5: the bytes are what they claim ───────────────────────────────────
  if (!magicMatches(bytes, declaredType)) {
    return bad('That file is not a photo. Use your phone camera.', 415)
  }

  // ── gate 6: the unit is real — the only check that costs a query, and the one
  //           that stops a scripted caller with a made-up id from spending money.
  //           Undifferentiated 404: unknown, inactive and retired look identical,
  //           so this endpoint cannot be used to enumerate valid unit ids.
  let unitExists = false
  try {
    const svc = createServiceClient()
    const { data: unit, error } = await svc
      .from('hd_units')
      .select('id, status, active')
      .eq('id', unitId)
      .maybeSingle()
    if (error) return bad('Temporarily unavailable', 503)
    unitExists = !!unit
      && unit.active !== false
      && !RETIRED_STATUSES.has(String(unit.status ?? '').toLowerCase())
  } catch {
    return bad('Temporarily unavailable', 503)
  }
  if (!unitExists) return bad('Not found', 404)

  // ── gate 7: cooldown ────────────────────────────────────────────────────────
  if (throttled(unitId)) {
    return bad('One at a time — wait a moment and try again.', 429)
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[inspect/extract-invoice] ANTHROPIC_API_KEY missing')
    // 503, not 500: the tech's next move is to type the invoice in by hand, and the
    // client turns this into exactly that offer.
    return bad('Invoice reading is unavailable right now — enter the details by hand.', 503)
  }

  // ── the call ────────────────────────────────────────────────────────────────
  let text = ''
  try {
    const client = new Anthropic({ apiKey })
    const message = await client.messages.create(
      {
        model:      MODEL,
        max_tokens: MAX_TOKENS,
        system:     EXTRACTION_SYSTEM,
        // Low effort: this is transcription, not reasoning. It keeps the per-photo
        // cost and the latency down on an endpoint anyone can reach.
        output_config: { effort: 'low' },
        // Opaque id only — it lets Anthropic's abuse tooling see a runaway caller as
        // one caller. It is a unit UUID, never a person.
        metadata: { user_id: unitId },
        messages: [
          {
            role: 'user',
            content: [
              {
                type:   'image',
                source: {
                  type:       'base64',
                  media_type: declaredType,
                  data:       Buffer.from(bytes).toString('base64'),
                },
              },
              { type: 'text', text: 'Transcribe this repair invoice.' },
            ],
          },
        ],
      },
      // One retry, not the SDK default of two: every attempt is billable and the tech
      // is standing there waiting. 45s leaves headroom under maxDuration.
      { maxRetries: 1, timeout: 45_000 },
    )

    // A safety decline is not a crash — it just means no fields, and the tech types
    // the invoice in instead.
    if (message.stop_reason === 'refusal') {
      return bad('Could not read that photo. Enter the details by hand.', 422)
    }

    text = message.content
      .filter(block => block.type === 'text')
      .map(block => (block as Anthropic.TextBlock).text)
      .join('\n')
      .trim()
  } catch (err) {
    const e = err as { status?: number; message?: string }
    console.error('[inspect/extract-invoice] model call failed:', e?.status ?? '', e?.message ?? err)
    return bad('Could not read that photo right now. Enter the details by hand.', 502)
  }

  // ── defensive parse ─────────────────────────────────────────────────────────
  // "JSON only" is an instruction, not a guarantee: a fence, a preamble, or a
  // truncated object are all possible and none of them may throw out of this handler.
  const json = extractJsonObject(text)
  if (!json) {
    console.error('[inspect/extract-invoice] no JSON object in model output')
    return bad('Could not read that photo. Enter the details by hand.', 422)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    console.error('[inspect/extract-invoice] model output was not valid JSON')
    return bad('Could not read that photo. Enter the details by hand.', 422)
  }

  // Everything past this point is clamped, capped and typed — the model's output is
  // treated exactly as hostile as the browser's.
  const extracted = normalizeExtraction(parsed)

  return NextResponse.json({
    ok:        true,
    extracted,
    // Named so the confirmation screen can flag them. The tech needs to see WHICH
    // boxes the machine could not read, or he skims a form that looks complete.
    unread:    unreadFields(extracted),
  })
}
