import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import { createAgentListing } from '@/lib/directory-agent/bd'
import {
  FALLBACK_MESSAGE,
  LISTED_MESSAGE,
  normalizeUsPhone,
  OPTOUT_MESSAGE,
} from '@/lib/directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/directory-agent/webhook ───────────────────────────────────────
// Inbound SMS replies from invited mechanics. Public endpoint — authenticity
// comes from the Twilio HMAC-SHA1 signature, not from a session.
//
// ⚠️  DEPLOYMENT STEP — after deploying, set the Twilio inbound SMS webhook for
//     +1 743-901-6244 (Console → Phone Numbers → Messaging → "A message comes
//     in") to:
//         https://tools.nationalwrenchindex.com/api/directory-agent/webhook
//     Method: HTTP POST. The signature check below hashes exactly that URL, so
//     it must match character for character (no trailing slash).
//
// Every path returns 200 + TwiML. Twilio retries and surfaces error alerts on
// anything else, and none of our failure modes are worth a retry storm.

const WEBHOOK_URL =
  `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')}` +
  '/api/directory-agent/webhook'

const OPT_OUT_KEYWORDS = ['stop', 'no', 'unsubscribe', 'cancel', 'end', 'quit']

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[directory-agent/webhook] TWILIO_AUTH_TOKEN not set')
    return twiml()
  }

  const rawBody = await request.text()
  const params  = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>

  const signature = request.headers.get('x-twilio-signature') ?? ''
  if (!verifyTwilioSignature(authToken, signature, WEBHOOK_URL, params)) {
    console.warn('[directory-agent/webhook] invalid Twilio signature — ignoring request')
    return twiml()
  }

  const fromRaw = params.From ?? ''
  const message = params.Body ?? ''
  const phone   = normalizeUsPhone(fromRaw)

  if (!phone) {
    console.warn('[directory-agent/webhook] unparseable From:', fromRaw)
    return twiml()
  }

  const supabase = createServiceClient()

  const { data: prospect } = await supabase
    .from('directory_prospects')
    .select('id, phone, business_name, city, state, status, bd_listing_created')
    .eq('phone', phone)
    .maybeSingle()

  // ── Opt out ──────────────────────────────────────────────────────────────
  // Checked before YES so a message like "no thanks" can't be read as consent.
  if (matchesKeyword(message, OPT_OUT_KEYWORDS)) {
    // The opt-out list is authoritative and survives the prospect row, so it is
    // written even for senders we have no prospect record for.
    const { error: optErr } = await supabase
      .from('directory_optouts')
      .upsert({ phone, opted_out_at: new Date().toISOString() }, { onConflict: 'phone', ignoreDuplicates: true })
    if (optErr) console.error('[directory-agent/webhook] optout insert failed:', optErr.message)

    if (prospect) {
      await supabase
        .from('directory_prospects')
        .update({ status: 'optout', responded_at: new Date().toISOString() })
        .eq('id', prospect.id)
    }

    await sendAgentSms({ to: phone, body: OPTOUT_MESSAGE })
    console.log('[directory-agent/webhook] opted out', phone)
    return twiml()
  }

  // ── Yes ──────────────────────────────────────────────────────────────────
  if (matchesKeyword(message, ['yes'])) {
    if (!prospect) {
      // A YES from a number we never invited — nothing to list.
      await sendAgentSms({ to: phone, body: FALLBACK_MESSAGE })
      return twiml()
    }

    // Idempotent: a second YES must not mint a second BD listing.
    if (prospect.bd_listing_created === true) {
      console.log('[directory-agent/webhook] duplicate YES, listing already exists for', phone)
      return twiml()
    }

    await supabase
      .from('directory_prospects')
      .update({ status: 'yes', responded_at: new Date().toISOString() })
      .eq('id', prospect.id)

    const businessName = (prospect.business_name as string) || 'Mobile Mechanic'

    try {
      const listing = await createAgentListing({
        businessName,
        city:  (prospect.city  as string | null) ?? null,
        state: (prospect.state as string | null) ?? null,
        phone: prospect.phone as string,
      })

      await supabase
        .from('directory_prospects')
        .update({ bd_listing_created: true, bd_listing_url: listing.listingUrl })
        .eq('id', prospect.id)

      await sendAgentSms({ to: phone, body: LISTED_MESSAGE })
      console.log(`[directory-agent/webhook] listed ${businessName} → ${listing.listingUrl}`)
    } catch (err) {
      // Consent is recorded either way — the prospect stays 'yes' with
      // bd_listing_created false so the admin page shows it as a manual retry.
      // No SMS: never promise a listing that doesn't exist yet.
      console.error(
        `[directory-agent/webhook] BD listing failed for ${businessName}:`,
        err instanceof Error ? err.message : String(err),
      )
    }

    return twiml()
  }

  // ── Anything else ────────────────────────────────────────────────────────
  await sendAgentSms({ to: phone, body: FALLBACK_MESSAGE })
  return twiml()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function twiml() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}

// Word-boundary match so "NOPE" doesn't hit on "no" via substring, while
// "no thanks" and "STOP." still do.
function matchesKeyword(message: string, keywords: string[]): boolean {
  const text = message.toLowerCase()
  return keywords.some(k => new RegExp(`\\b${k}\\b`).test(text))
}

function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort()
  const paramStr   = sortedKeys.reduce((acc, k) => acc + k + (params[k] ?? ''), '')
  const hmac       = crypto.createHmac('sha1', authToken)
  hmac.update(url + paramStr)
  const computed   = hmac.digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch {
    return false
  }
}
