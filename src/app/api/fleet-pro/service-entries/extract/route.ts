// POST /api/fleet-pro/service-entries/extract — read a photographed paper invoice
// for a logged-in fleet manager.
//
// The manager-side twin of /api/inspect/extract-invoice. Same document, same model,
// same prompt, same sanitizer. What differs is who is asking and what comes back:
//
//   * AUTHENTICATED and membership-checked, so the abuse model is not "anyone who
//     scraped a QR sticker" but "a paying member of this fleet". The unit-existence
//     check therefore becomes a unit-OWNERSHIP check: the unit has to be in the
//     caller's own fleet, or a manager could read an invoice against someone else's
//     truck and file cost into their spend.
//   * COST-GATED. An invoice is a money document, and Fleet Pro already hides every
//     cost figure from a viewer. Letting a viewer photograph one and read the total
//     off the confirmation screen would route straight around that.
//   * It also returns the unit number and VIN printed on the page, and matches them
//     against this fleet's units, so the confirmation screen can preselect the truck.
//
// Nothing here writes to the database or to storage. The write is a separate,
// explicit confirm to POST /api/fleet-pro/service-entries.

import { NextResponse, type NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFleetProMember } from '@/lib/fleet-pro/access'
import { canViewCosts } from '@/types/fleet-pro'
import {
  ALLOWED_IMAGE_TYPES,
  EMPTY_EXTRACTION,
  EMPTY_IDENTITY,
  INVOICE_EXTRACTION_SYSTEM,
  INVOICE_IDENTITY_ADDENDUM,
  MAX_IMAGE_BYTES,
  extractJsonObject,
  imageMagicMatches,
  normalizeExtraction,
  normalizeIdentity,
  unreadFields,
  type AllowedImageType,
  type ExtractedInvoiceIdentity,
} from '@/lib/fleet-pro/service-entry'

export const dynamic = 'force-dynamic'

// A photo of a creased invoice takes the model a while to read. 60s is the Vercel Pro
// ceiling; the SDK call below is capped under it so we return an error rather than
// having the platform kill the function. Matches the QR route.
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The multipart envelope on top of the 5MB image. Anything past this is not a photo.
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 512 * 1024

const MODEL      = 'claude-opus-5'
const MAX_TOKENS = 3_000

// A fleet's roster is tens of trucks, not thousands, but PostgREST silently caps an
// unbounded select at 1000 rows and a silent cap on the matching set would mean a
// real VIN quietly failing to match.
const UNIT_MATCH_CEILING = 2_000

const bad = (error: string, status = 400) =>
  NextResponse.json(
    { error, extracted: EMPTY_EXTRACTION, identity: EMPTY_IDENTITY, unit_match: null },
    { status },
  )

interface UnitMatch {
  unit_id:     string
  unit_number: string | null
  /** Which stored field the printed number hit. Shown to the manager, because
   *  "matched the serial" and "matched the trailer number" do not deserve equal
   *  confidence from him. */
  matched_on:  'unit_number' | 'truck_trailer_number' | 'serial_number'
}

/** Loose compare for a number a shop wrote by hand: "T-1042", "t1042" and "T 1042"
 *  are the same truck. */
function foldIdentifier(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Find the truck this invoice names, within the caller's own fleet.
 *
 * NO VIN MATCH, deliberately: hd_units has no vin column. It has unit_number,
 * truck_trailer_number, serial_number and bm_number, and a reefer's identity on a
 * shop's paperwork is usually one of those. The VIN is still extracted and still
 * stored in extracted_raw, because it is printed on the page and is the field that
 * would settle an argument later — but nothing here can resolve it to a row, and
 * pretending otherwise would be a match the manager could not verify.
 *
 * Fields are tried in descending order of how specific they are. A serial number is
 * close to globally unique; a unit number is unique only by convention — two fleets
 * both run a truck 101, and so do some single fleets after a merge.
 *
 * An AMBIGUOUS hit returns no match at all rather than the first row. A silent wrong
 * preselection is the exact failure this feature exists to prevent, and the manager
 * still has the dropdown.
 */
async function matchUnit(
  svc:      ReturnType<typeof createServiceClient>,
  fleetId:  string,
  identity: ExtractedInvoiceIdentity,
): Promise<UnitMatch | null> {
  if (!identity.unit_number) return null

  const { data, error } = await svc
    .from('hd_units')
    .select('id, unit_number, truck_trailer_number, serial_number')
    .eq('fleet_account_id', fleetId)
    .limit(UNIT_MATCH_CEILING)

  if (error || !data) {
    if (error) console.error('[fleet-pro/service-entries/extract] unit match load failed:', error.message)
    return null
  }

  const rows   = data as {
    id: string; unit_number: string | null
    truck_trailer_number: string | null; serial_number: string | null
  }[]
  const wanted = foldIdentifier(identity.unit_number)

  const columns = ['serial_number', 'unit_number', 'truck_trailer_number'] as const
  for (const column of columns) {
    const matches = rows.filter(r => {
      const stored = r[column]
      return !!stored && foldIdentifier(stored) === wanted
    })
    if (matches.length === 1) {
      return {
        unit_id:     matches[0].id,
        unit_number: matches[0].unit_number,
        matched_on:  column,
      }
    }
  }

  return null
}

export async function POST(req: NextRequest) {
  // ── gate 1: size, before the body is touched ────────────────────────────────
  const declaredLength = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }

  // ── gate 2: membership, then cost access ────────────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const gate = await requireFleetProMember(user?.id ?? null)
  if (!gate.ok) return bad(gate.error, gate.status)
  if (!canViewCosts(gate.membership.role)) {
    return bad('Reading invoices requires cost access', 403)
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return bad('Could not read the upload')
  }

  // ── gate 3: a real unit id, owned by this fleet ─────────────────────────────
  // Sent so the match result can be compared against the page the manager is on.
  // It is validated here rather than trusted, exactly as the QR route does.
  const unitId = String(form.get('unit_id') ?? '')
  if (!UUID_RE.test(unitId)) return bad('Not found', 404)

  const svc = createServiceClient()
  const { data: unit, error: unitErr } = await svc
    .from('hd_units')
    .select('id')
    .eq('id', unitId)
    .eq('fleet_account_id', gate.membership.fleet_account_id)
    .maybeSingle()

  if (unitErr) return bad('Temporarily unavailable', 503)
  // Undifferentiated: a unit in another fleet and a unit that does not exist look
  // identical from here, so this cannot be used to probe other fleets' rosters.
  if (!unit) return bad('Not found', 404)

  const file = form.get('image')
  if (!(file instanceof File)) return bad('No photo was attached')

  // ── gate 4: declared type ───────────────────────────────────────────────────
  const declaredType = file.type as AllowedImageType
  if (!ALLOWED_IMAGE_TYPES.includes(declaredType)) {
    return bad('Photos must be JPEG or PNG. Use your phone camera, not a scan or a PDF.', 415)
  }

  // ── gate 5: real byte length, BEFORE any decode ─────────────────────────────
  if (file.size > MAX_IMAGE_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }
  if (file.size < 1_024) return bad('That photo did not come through. Try again.')

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    return bad('That photo is too large. Take it again at normal quality.', 413)
  }

  // ── gate 6: the bytes are what they claim ───────────────────────────────────
  if (!imageMagicMatches(bytes, declaredType)) {
    return bad('That file is not a photo. Use your phone camera.', 415)
  }

  // No per-caller throttle here, unlike the QR route. That one is open to anyone
  // holding a unit id, so a cooldown is the only thing between it and a metered API;
  // this one costs a Fleet Pro seat to reach, and a member photographing his own
  // invoices in a burst is the feature working.

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('[fleet-pro/service-entries/extract] ANTHROPIC_API_KEY missing')
    // 503, not 500: the manager's next move is to type the invoice in by hand, and
    // the client turns this into exactly that offer.
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
        system:     INVOICE_EXTRACTION_SYSTEM + INVOICE_IDENTITY_ADDENDUM,
        // Low effort: this is transcription, not reasoning.
        output_config: { effort: 'low' },
        // Opaque id only. The fleet account, never a person.
        metadata: { user_id: gate.membership.fleet_account_id },
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
      // One retry, not the SDK default of two: every attempt is billable and the
      // manager is standing there waiting. 45s leaves headroom under maxDuration.
      { maxRetries: 1, timeout: 45_000 },
    )

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
    console.error('[fleet-pro/service-entries/extract] model call failed:', e?.status ?? '', e?.message ?? err)
    return bad('Could not read that photo right now. Enter the details by hand.', 502)
  }

  // ── defensive parse ─────────────────────────────────────────────────────────
  const json = extractJsonObject(text)
  if (!json) {
    console.error('[fleet-pro/service-entries/extract] no JSON object in model output')
    return bad('Could not read that photo. Enter the details by hand.', 422)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    console.error('[fleet-pro/service-entries/extract] model output was not valid JSON')
    return bad('Could not read that photo. Enter the details by hand.', 422)
  }

  // The model's output is treated exactly as hostile as the browser's.
  const extracted = normalizeExtraction(parsed)
  const identity  = normalizeIdentity(parsed)

  return NextResponse.json({
    ok:         true,
    extracted,
    // Which boxes the machine could not read, so the manager's eye goes to them
    // instead of skimming a form that looks complete.
    unread:     unreadFields(extracted),
    identity,
    // Null when nothing matched or a unit number was ambiguous. The client falls
    // back to the unit whose page this is, and always shows the dropdown.
    unit_match: await matchUnit(svc, gate.membership.fleet_account_id, identity),
  })
}
