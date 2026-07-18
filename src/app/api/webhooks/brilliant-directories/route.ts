import { NextResponse, type NextRequest } from 'next/server'
import { Resend } from 'resend'
import { createServiceClient } from '@/lib/supabase/service'

// Brilliant Directories fires this when a mechanic publishes a listing on
// nationalwrenchindex.com. We log the event and invite them to NWI Suite —
// once, and never if they're already a subscriber.

const FROM      = 'Brock Fleeman <brock@nationalwrenchindex.com>'
const SIGNUP_URL = 'https://tools.nationalwrenchindex.com/signup'

type SkipReason = 'existing_subscriber' | 'already_invited' | 'no_email' | 'email_failed'

// BD's field naming isn't stable across form/webhook configs, so accept the
// common aliases rather than silently dropping data.
function pick(payload: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = payload[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] ?? c))
}

function invitationHtml(firstName: string): string {
  const hi = firstName ? `Hi ${esc(firstName)},` : 'Hi,'
  return `
    <div style="font-family:sans-serif;max-width:560px;line-height:1.6;color:#1a1a1a;">
      <p>${hi}</p>

      <p>Your listing on National Wrench Index is live. Customers in your area can now
      find you and contact you directly — no lead fees, no middleman.</p>

      <p>While you are here I wanted to share something I built specifically for
      mobile mechanics like you.</p>

      <p>NWI Suite is the business management platform behind the directory.
      Scheduling, invoicing, AI diagnostics, automated Google reviews, and an AI
      receptionist that answers calls while you are under a hood. All in one place.
      Starting at $19 a month.</p>

      <p>Built by a 17-year mobile mechanic. For mobile mechanics.</p>

      <p>Want to see it?<br/>
      <a href="${SIGNUP_URL}" style="color:#FF6600;font-weight:bold;">${SIGNUP_URL.replace('https://', '')}</a></p>

      <p>— Brock Fleeman<br/>
      Founder — National Wrench Index<br/>
      743-216-7142</p>

      <p style="color:#666;font-size:14px;">P.S. Your directory listing is free forever.
      NWI Suite is the next step when you are ready.</p>
    </div>
  `
}

export async function POST(request: NextRequest) {
  // ---- PART 5: shared-secret auth --------------------------------------
  // Fail closed: if BD_API_KEY isn't configured we reject rather than
  // accepting unauthenticated writes.
  const expected = process.env.BD_API_KEY
  if (!expected) {
    console.error('[bd-webhook] BD_API_KEY not configured — rejecting')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const provided =
    request.headers.get('x-bd-api-key') ??
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer /i, '') ??
    ''

  if (provided !== expected) {
    console.warn('[bd-webhook] bad API key')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ---- PART 1: parse payload -------------------------------------------
  let payload: Record<string, unknown>
  try {
    payload = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const eventType = pick(payload, 'event', 'event_type', 'type') || 'member.created'
  const firstName = pick(payload, 'first_name', 'firstname', 'firstName')
  const lastName  = pick(payload, 'last_name', 'lastname', 'lastName')
  const email     = pick(payload, 'email', 'member_email', 'email_address').toLowerCase()
  const company   = pick(payload, 'company', 'company_name', 'business_name', 'companyName')
  const city      = pick(payload, 'city', 'member_city')
  const state     = pick(payload, 'state', 'member_state', 'region')
  const fullName  = [firstName, lastName].filter(Boolean).join(' ')

  const svc = createServiceClient()

  // Records the event and returns the row id, so skip/send outcomes are auditable.
  async function logEvent(fields: { email_sent?: boolean; email_sent_at?: string | null; skip_reason?: SkipReason | null }) {
    const { error } = await svc.from('directory_webhook_events').insert({
      event_type:     eventType,
      member_email:   email || null,
      member_name:    fullName || null,
      member_company: company || null,
      member_city:    city || null,
      member_state:   state || null,
      raw_payload:    payload,
      email_sent:     fields.email_sent ?? false,
      email_sent_at:  fields.email_sent_at ?? null,
      skip_reason:    fields.skip_reason ?? null,
    })
    if (error) console.error('[bd-webhook] failed to log event:', error.message)
  }

  if (!email) {
    await logEvent({ skip_reason: 'no_email' })
    return NextResponse.json({ received: true, emailed: false, reason: 'no_email' })
  }

  // ---- PART 4: duplicate prevention ------------------------------------
  // `profiles` mirrors auth.users and is the only table reachable over
  // PostgREST (the auth schema isn't exposed), so it stands in for auth.users.
  const { data: existingProfile, error: profileErr } = await svc
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (profileErr) {
    console.error('[bd-webhook] profile lookup failed:', profileErr.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  if (existingProfile) {
    await logEvent({ skip_reason: 'existing_subscriber' })
    return NextResponse.json({ received: true, emailed: false, reason: 'existing_subscriber' })
  }

  const { data: priorInvite, error: inviteErr } = await svc
    .from('directory_webhook_events')
    .select('id')
    .eq('member_email', email)
    .eq('email_sent', true)
    .maybeSingle()

  if (inviteErr) {
    console.error('[bd-webhook] prior-invite lookup failed:', inviteErr.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  if (priorInvite) {
    await logEvent({ skip_reason: 'already_invited' })
    return NextResponse.json({ received: true, emailed: false, reason: 'already_invited' })
  }

  // ---- PART 3: send the invitation -------------------------------------
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[bd-webhook] RESEND_API_KEY not set — logging without sending')
    await logEvent({ skip_reason: 'email_failed' })
    return NextResponse.json({ received: true, emailed: false, reason: 'email_not_configured' })
  }

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from:    FROM,
      to:      email,
      subject: "Your NWI listing is live — what's next?",
      html:    invitationHtml(firstName),
    })
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error('[bd-webhook] send failed:', err)
    // Logged as not-sent so a retry can pick it up.
    await logEvent({ skip_reason: 'email_failed' })
    return NextResponse.json({ received: true, emailed: false, reason: 'email_failed' })
  }

  await logEvent({ email_sent: true, email_sent_at: new Date().toISOString() })
  return NextResponse.json({ received: true, emailed: true })
}
