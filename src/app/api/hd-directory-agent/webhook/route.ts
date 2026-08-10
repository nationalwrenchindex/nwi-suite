import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { normalizeUsPhone } from '@/lib/directory-agent/config'
import { sendAgentSms } from '@/lib/directory-agent/sms'
import {
  findProspectByPhone,
  handleProspectReply,
  matchesKeyword,
  OPT_OUT_KEYWORDS,
  recordOptOut,
} from '@/lib/directory-agent/reply'
import { HD_VARIANT } from '@/lib/hd-directory-agent/variant'
import { HD_FALLBACK_MESSAGE, HD_FROM_NUMBER } from '@/lib/hd-directory-agent/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ─── POST /api/hd-directory-agent/webhook ────────────────────────────────────
// Inbound SMS replies from invited HD providers. Public endpoint — authenticity
// comes from the Twilio HMAC-SHA1 signature, not from a session.
//
// Reply routing lives in src/lib/directory-agent/reply.ts, shared with the LD
// agent and with /api/torquewrench/sms-response; HD_VARIANT points it at the HD
// tables, number, copy and the nwihd.com directory.
//
// ⚠️  DEPLOYMENT STEP — after deploying, set the Twilio inbound SMS webhook for
//     the HD outreach number (+1 336-276-1896 unless
//     HD_DIRECTORY_AGENT_FROM_NUMBER says otherwise) to:
//         https://tools.nationalwrenchindex.com/api/hd-directory-agent/webhook
//     Method: HTTP POST. The signature check below hashes exactly that URL, so
//     it must match character for character (no trailing slash).
//
// Every path returns 200 + TwiML. Twilio retries and surfaces error alerts on
// anything else, and none of our failure modes are worth a retry storm.

const WEBHOOK_URL =
  `${(process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')}` +
  '/api/hd-directory-agent/webhook'

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[hd-directory-agent/webhook] TWILIO_AUTH_TOKEN not set')
    return twiml()
  }

  const rawBody = await request.text()
  const params  = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>

  const signature = request.headers.get('x-twilio-signature') ?? ''
  if (!verifyTwilioSignature(authToken, signature, WEBHOOK_URL, params)) {
    console.warn('[hd-directory-agent/webhook] invalid Twilio signature — ignoring request')
    return twiml()
  }

  const fromRaw = params.From ?? ''
  const message = params.Body ?? ''
  const phone   = normalizeUsPhone(fromRaw)

  if (!phone) {
    console.warn('[hd-directory-agent/webhook] unparseable From:', fromRaw)
    return twiml()
  }

  // Any status matches here — this number only ever receives HD directory
  // traffic, so a reply from an already-responded prospect is still ours.
  const prospect = await findProspectByPhone(HD_VARIANT, phone)

  if (!prospect) {
    // A STOP from a number we have no prospect row for is still binding.
    if (matchesKeyword(message, OPT_OUT_KEYWORDS)) {
      await recordOptOut(HD_VARIANT, phone, null)
    } else {
      await sendAgentSms({ to: phone, body: HD_FALLBACK_MESSAGE, from: HD_FROM_NUMBER() })
    }
    return twiml()
  }

  await handleProspectReply(HD_VARIANT, phone, message, prospect)
  return twiml()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function twiml() {
  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
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
