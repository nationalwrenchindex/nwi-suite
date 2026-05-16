import crypto from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSmsResult } from '@/lib/twilio'
import { buildGoogleReviewUrl } from '@/lib/torquewrench/review-url'

// ─── POST /api/torquewrench/sms-response ─────────────────────────────────────
// Receives inbound SMS from Twilio (customers replying with ratings).
// Verifies Twilio HMAC-SHA1 signature, finds the matching review, extracts a
// rating 1-5, then either sends a Google review link (4-5) or triggers service
// recovery (1-3).
export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[tw-sms-in] TWILIO_AUTH_TOKEN not set')
    return new NextResponse('', { status: 200 }) // Always 200 to Twilio
  }

  const rawBody = await request.text()
  const params  = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>

  // Verify Twilio signature
  const appUrl        = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '')
  const webhookUrl    = `${appUrl}/api/torquewrench/sms-response`
  const twilioSig     = request.headers.get('x-twilio-signature') ?? ''

  if (!verifyTwilioSignature(authToken, twilioSig, webhookUrl, params)) {
    console.warn('[tw-sms-in] Invalid Twilio signature — ignoring request')
    return new NextResponse('', { status: 200 })
  }

  const fromRaw    = params.From ?? ''
  const messageBody = params.Body ?? ''

  if (!fromRaw) {
    return new NextResponse('', { status: 200 })
  }

  const fromDigits = fromRaw.replace(/\D/g, '')
  const supabase   = createServiceClient()

  // Find the most recent sent review for this phone number (within 7 days)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: reviews } = await supabase
    .from('torquewrench_reviews')
    .select('*')
    .eq('status', 'sent')
    .is('rated_at', null)
    .gte('send_attempted_at', sevenDaysAgo)
    .order('send_attempted_at', { ascending: false })

  // Normalize phone comparison: match last 10 digits
  const review = reviews?.find((r) => {
    const stored = ((r.customer_phone as string) ?? '').replace(/\D/g, '')
    return stored.length >= 10 && fromDigits.endsWith(stored.slice(-10))
  })

  if (!review) {
    // Unknown sender or no active review — silently ignore
    return new NextResponse('', { status: 200 })
  }

  // Idempotency: skip if already rated
  if (review.rated_at) {
    return new NextResponse('', { status: 200 })
  }

  const rating = extractRating(messageBody)

  if (rating === null) {
    // One-time fallback asking for 1-5 — don't send if we already asked
    if (!review.fallback_sent_at) {
      await supabase
        .from('torquewrench_reviews')
        .update({ fallback_sent_at: new Date().toISOString() })
        .eq('id', review.id)

      await sendSmsResult({
        to:   fromRaw,
        body: "Thanks for the reply! Could you rate us 1-5? It helps us improve.",
      })
    }
    return new NextResponse('', { status: 200 })
  }

  // Save rating
  await supabase
    .from('torquewrench_reviews')
    .update({ rating, rated_at: new Date().toISOString(), status: 'rated' })
    .eq('id', review.id)

  // Load mechanic settings
  const { data: settings } = await supabase
    .from('torquewrench_settings')
    .select('*')
    .eq('user_id', review.user_id)
    .single()

  if (rating >= 4) {
    // Happy customer — send Google review link
    const googleUrl = settings?.google_place_id
      ? buildGoogleReviewUrl(settings.google_place_id as string)
      : null

    if (googleUrl) {
      await sendSmsResult({
        to:   fromRaw,
        body: `Thank you so much! It means a lot. Mind leaving us a quick Google review? It takes less than a minute: ${googleUrl}`,
      })
    } else {
      await sendSmsResult({
        to:   fromRaw,
        body: "Thank you so much! Really appreciate the kind words.",
      })
    }
  } else {
    // Rating 1-3 — service recovery
    if (settings?.service_recovery_enabled && settings?.service_recovery_phone) {
      const customerName  = (review.customer_name as string) || 'A customer'
      const serviceType   = (review.service_type as string) || 'service'

      await sendSmsResult({
        to:   settings.service_recovery_phone as string,
        body: `Heads up — ${customerName} rated their ${serviceType} ${rating}/5. Recommend reaching out to make it right. — TorqueWrench`,
      })

      await supabase
        .from('torquewrench_reviews')
        .update({ status: 'recovery', service_recovery_triggered: true })
        .eq('id', review.id)

      await sendSmsResult({
        to:   fromRaw,
        body: "Thanks for the honest feedback — we'll be reaching out to make this right.",
      })
    } else {
      // Recovery disabled — acknowledge without alarm
      await sendSmsResult({
        to:   fromRaw,
        body: "Thanks for the feedback — we appreciate it.",
      })
    }
  }

  return new NextResponse('', { status: 200 })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function extractRating(message: string): number | null {
  const text = message.toLowerCase().trim()

  // Explicit digit 1-5 (word boundary, not part of a longer number)
  const numMatch = text.match(/\b([1-5])\b/)
  if (numMatch) return parseInt(numMatch[1], 10)

  if (/\b(great|amazing|excellent|love|perfect|awesome|fantastic)\b/.test(text)) return 5
  if (/\b(good|nice|happy|satisfied)\b/.test(text)) return 4
  if (/\b(okay|ok|fine|alright|meh)\b/.test(text)) return 3
  if (/\b(bad|disappointed|unhappy|poor)\b/.test(text)) return 2
  if (/\b(terrible|awful|worst|horrible|hate)\b/.test(text)) return 1

  return null
}
