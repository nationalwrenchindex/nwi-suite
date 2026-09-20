// POST /api/inspect/fuel-extract — read a photographed fuel pump display.
//
// DELIBERATELY UNAUTHENTICATED, same capability model as the rest of /api/inspect: the
// QR sticker on the truck is the credential and the driver has no account.
//
// ⚠ THIS ROUTE SPENDS MONEY, exactly like /api/inspect/extract-invoice. An open
// endpoint that accepts arbitrary bytes and forwards them to a metered vision API is a
// free-inference proxy for anyone who scrapes one unit id out of one QR code, and the
// bill lands on us. The gates below are the same seven, in the same order, cheapest
// first, so nothing expensive happens on a request that was never going to be
// legitimate:
//
//   1. Content-Length rejected before the body is read at all.
//   2. unit_id must be a UUID.
//   3. Declared MIME must be image/jpeg or image/png.
//   4. Byte length must be <= 5MB — checked BEFORE any decode.
//   5. Magic bytes must match the declared type, because the declared type is just a
//      string the client chose.
//   6. The unit must exist and be active. This is the real gate: the API call happens
//      only for a real truck, so a random id is a 404 for free.
//   7. A best-effort per-unit cooldown.
//
// It returns data for a screen the driver then EDITS. Nothing here writes to the
// database or to storage; the write is a separate, explicit confirm to
// /api/inspect/fuel-log.
//
// WHY GEMINI HERE AND CLAUDE NEXT DOOR: a pump display is seven-segment digits in
// three labelled boxes, not a page of prose in an unknown layout. It is the cheap end
// of vision work and it is hit far more often than the invoice reader — a fleet fuels
// daily and invoices monthly. The invoice route keeps Claude because a creased,
// handwritten shop invoice is genuinely harder. Neither is a preference about vendors.

import { NextResponse, type NextRequest } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { createServiceClient } from '@/lib/supabase/service'
import {
  EMPTY_FUEL_EXTRACTION,
  FUEL_IMAGE_TYPES,
  MAX_FUEL_IMAGE_BYTES,
  MAX_GALLONS,
  MAX_FUEL_COST,
  MAX_PRICE_PER_GALLON,
  unreadFuelFields,
  type ExtractedFuel,
  type FuelImageType,
} from '@/types/fleet-pro-fuel'

export const dynamic = 'force-dynamic'
// A phone photo of a pump in daylight glare still takes a moment. Well under the
// Vercel ceiling; the call below is capped tighter so we answer rather than being
// killed by the platform.
export const maxDuration = 45

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Kept in step with /inspect/[unitId] and GET /api/inspect/[unitId].
const RETIRED_STATUSES = new Set(['inactive', 'archived', 'retired', 'deleted'])

// The multipart envelope on top of the image itself.
const MAX_REQUEST_BYTES = MAX_FUEL_IMAGE_BYTES + 512 * 1024

const MODEL           = 'gemini-3.6-flash'
const GEMINI_TIMEOUT  = 30_000
const MAX_OUTPUT_TOKENS = 400

// THROTTLE: best-effort and honestly so — module scope lives per serverless instance,
// so a distributed caller routes around it. It blunts the cheap case (a double-tapped
// button, one device in a loop) without a network round-trip. A real limit needs a
// shared counter; same note as the invoice reader.
const THROTTLE_MS = 4_000
const lastCallByUnit = new Map<string, number>()

function throttled(unitId: string): boolean {
  const now  = Date.now()
  const last = lastCallByUnit.get(unitId) ?? 0
  if (now - last < THROTTLE_MS) return true
  lastCallByUnit.set(unitId, now)
  if (lastCallByUnit.size > 500) {
    for (const [key, at] of lastCallByUnit) {
      if (now - at > THROTTLE_MS * 10) lastCallByUnit.delete(key)
    }
  }
  return false
}

const bad = (error: string, status = 400) =>
  NextResponse.json({ error, extracted: EMPTY_FUEL_EXTRACTION }, { status })

/**
 * THE HALLUCINATION GUARD — same reasoning as the invoice reader, and it matters more
 * here than it looks.
 *
 * The tempting invention on a pump display is arithmetic: gallons x price = total is
 * printed on the pump, so a model that reads two of the three will happily produce the
 * third. That is indistinguishable from a read and it is wrong often enough to matter,
 * because the one the glare usually kills is the one being reconstructed. A fabricated
 * gallons figure is worse than a blank in a specific way: gallons is the denominator
 * of MPG, so an invented number does not just sit in a column — it silently sets this
 * truck's fuel economy and moves the rolling average that the next alert is judged
 * against. Blank costs the driver four seconds at the island.
 */
const FUEL_SYSTEM = `You are a transcription system for fuel pump displays. You output JSON and nothing else.

You are looking at a photograph taken by a truck driver standing at a fuel island, pointing a phone at a pump. It may be glared, sun-washed, dusty, taken at an angle, partly reflected, or out of focus. Seven-segment digits are easy to misread when a segment is dim or occluded.

THE RULE: report only the numbers you can actually READ on the display. If a value is not shown, or is shown but not clearly legible, return null for that field. Do not infer it. Do not estimate it. Do not calculate it from the other two numbers.

NEVER MULTIPLY OR DIVIDE. A pump shows gallons, price per gallon, and total sale. These are related by arithmetic, and that is exactly why you must not compute one from the others: if you cannot read the total, total_cost is null, even though you could work it out. A computed number looks identical to a read one and there is no way for anyone downstream to tell them apart.

Null is a correct answer and it is expected. Every field is shown to the driver on a confirmation screen before anything is saved, and he types in whatever you left blank. A confident wrong number is far more expensive: gallons is used to calculate this truck's fuel economy, so an invented figure becomes its MPG history and moves the average that future readings are compared against.

Watch for these specifically:
- A pump often shows the PRICE PER GALLON in small digits near the grade selector and the TOTAL SALE in the largest display. Do not swap them. If you are unsure which is which, return null for both.
- Some pumps display the previous customer's sale until the nozzle is lifted. If the photo appears to show a completed, unrelated sale you cannot attribute, return nulls.
- Diesel pumps at truck stops may show a running total mid-fill. Read what is displayed; do not adjust it.
- Ignore loyalty prices, cash/credit alternate prices, and advertised prices on signage. Only the transaction on this pump.

Fields:
- gallons: gallons dispensed, as a number.
- total_cost: total sale in dollars, as a number.
- price_per_gallon: unit price in dollars, as a number.

Numbers must be plain JSON numbers: no currency symbols, no thousands separators, no quotes, no units.

Return the JSON object alone. No markdown fence, no explanation, no commentary before or after.`

/** PNG and JPEG signatures. The declared MIME type is client-controlled text; this is
 *  the only part of the request that is actually evidence of what the bytes are. */
function magicMatches(bytes: Uint8Array, declared: FuelImageType): boolean {
  if (declared === 'image/png') {
    return bytes.length > 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  }
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/** Pull the first balanced JSON object out of model output. "JSON only" is an
 *  instruction, not a guarantee: a fence, a preamble or a truncated object are all
 *  possible and none of them may throw out of this handler. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/** Clamped, non-negative, or null. The model's output is treated exactly as hostile as
 *  the browser's — a value past the physical ceiling is a misread, not a fillup. */
function fuelNumber(value: unknown, max: number, decimals: number): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''))
  if (!Number.isFinite(n) || n < 0) return null
  if (n > max) return null
  const factor = 10 ** decimals
  const rounded = Math.round(n * factor) / factor
  return rounded > 0 ? rounded : null
}

function normalizeFuel(value: unknown): ExtractedFuel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return EMPTY_FUEL_EXTRACTION
  const row = value as Record<string, unknown>
  return {
    gallons:          fuelNumber(row.gallons,          MAX_GALLONS,           3),
    total_cost:       fuelNumber(row.total_cost,       MAX_FUEL_COST,         2),
    price_per_gallon: fuelNumber(row.price_per_gallon, MAX_PRICE_PER_GALLON,  3),
  }
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
  const declaredType = file.type as FuelImageType
  if (!(FUEL_IMAGE_TYPES as readonly string[]).includes(declaredType)) {
    return bad('Photos must be JPEG or PNG. Use your phone camera.', 415)
  }

  // ── gate 4: real byte length, BEFORE any decode ─────────────────────────────
  if (file.size > MAX_FUEL_IMAGE_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }
  if (file.size < 1_024) return bad('That photo did not come through. Try again.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  // Belt and braces: File.size is reported by the client too.
  if (bytes.byteLength > MAX_FUEL_IMAGE_BYTES) {
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

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.error('[inspect/fuel-extract] GEMINI_API_KEY missing')
    // 503, not 500: the driver's next move is to read the pump himself, and the
    // client turns this into exactly that offer.
    return bad('Pump reading is unavailable right now — enter the numbers by hand.', 503)
  }

  // ── the call ────────────────────────────────────────────────────────────────
  // No Google Search grounding: this is transcription of what is in the frame, and
  // grounding would let outside web content influence a number that must come only
  // from the photograph.
  let text = ''
  try {
    const client = new GoogleGenAI({ apiKey })
    const response = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: declaredType, data: Buffer.from(bytes).toString('base64') } },
            { text: 'Transcribe the numbers on this fuel pump display.' },
          ],
        },
      ],
      config: {
        systemInstruction: FUEL_SYSTEM,
        maxOutputTokens:   MAX_OUTPUT_TOKENS,
        // Deterministic transcription. The default sampling temperature is tuned for
        // prose and is the wrong setting for reading digits off a display.
        temperature:       0,
        httpOptions:       { timeout: GEMINI_TIMEOUT },
      },
    })
    text = (response.text ?? '').trim()
  } catch (err) {
    const e = err as { status?: number; message?: string }
    console.error('[inspect/fuel-extract] model call failed:', e?.status ?? '', e?.message ?? err)
    return bad('Could not read that photo right now. Enter the numbers by hand.', 502)
  }

  // ── defensive parse ─────────────────────────────────────────────────────────
  const json = extractJsonObject(text)
  if (!json) {
    console.error('[inspect/fuel-extract] no JSON object in model output')
    return bad('Could not read that photo. Enter the numbers by hand.', 422)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    console.error('[inspect/fuel-extract] model output was not valid JSON')
    return bad('Could not read that photo. Enter the numbers by hand.', 422)
  }

  const extracted = normalizeFuel(parsed)

  return NextResponse.json({
    ok:     true,
    extracted,
    // Named so the confirmation screen can flag them. The driver needs to see WHICH
    // boxes the machine could not read, or he skims a form that looks complete.
    unread: unreadFuelFields(extracted),
  })
}
