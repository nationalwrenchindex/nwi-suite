// POST /api/hd/quotes/[id]/send
//
// Puts an HD quote in front of the customer: mints its public token, texts or emails
// the approval link, and records the send on the row.
//
// WHY THIS ROUTE DID NOT EXIST UNTIL NOW
//
// Migration 153 built the whole approval path - public_token, the customer page at
// /hd/quote/[token], the respond endpoint that writes approved_at and converts the
// quote to a work order. None of it was reachable. The HD quote screen had exactly two
// buttons, Convert to Invoice and Delete, so the only way to a quote's approval page
// was to already know a 32-character token, which nobody does. The feature was built
// and then left with no door.
//
// DELIVERY FAILURE IS NOT A REQUEST FAILURE. Same contract as the HD invoice send and
// both LD send routes: a bad number, a Twilio outage or a carrier rejection returns 200
// with { sent: false, error } so the tech can read what went wrong and still copy the
// link. Throwing here would lose the token and leave them with nothing.
//
// NOTHING RECORDS A SEND THAT DID NOT HAPPEN. status, sent_at, last_sent_at and
// sent_count move only after a channel confirms. A quote that reads "sent" and was not
// is how a shop waits a week on an approval that was never asked for.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { sendSmsResult } from '@/lib/twilio'
import { getContactSuppression } from '@/lib/customer-contact'
import { mintQuoteToken, publicQuoteUrl } from '@/lib/hd/quote-approval'
import { buildQuoteSms, buildQuoteEmail } from '@/lib/hd/sms-templates'

export const dynamic = 'force-dynamic'

// Same verified sender as the invoice mail. nationalwrenchindex.com is the Resend
// domain, so the message is SPF/DKIM signed; the visible branding is the subscriber's
// and is set by buildQuoteEmail.
const QUOTE_FROM = process.env.INVOICE_FROM_EMAIL ?? 'invoices@nationalwrenchindex.com'

interface SendBody {
  method?: 'sms' | 'email' | 'link'
  phone?:  string
  email?:  string
  /**
   * Hand back the link without claiming anything was delivered. The Copy Link tab needs
   * a URL before the tech has shared it, and asking for one is not a send - see the
   * matching flag on the LD routes, where a useEffect doing exactly this is how
   * times_sent reached 3 on quotes nobody received.
   */
  preview?: boolean
}

/** PostgREST / Postgres "that column is not there". Migration 155 may not be run yet. */
function isMissingSendColumn(message: string | undefined, code: string | undefined): boolean {
  if (code === 'PGRST204' || code === '42703') return true
  return /sent_at|last_sent_at|sent_count|sent_to_phone|sent_to_email/i.test(message ?? '')
      && /does not exist|schema cache|could not find/i.test(message ?? '')
}

/** "Mar 4, 2026" from a DATE column, or null. Shown to the customer, so no ISO. */
function humanDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: SendBody
  try { body = await req.json() as SendBody } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const method = body.method === 'email' ? 'email' : body.method === 'link' ? 'link' : 'sms'

  // '*' rather than a column list: this reads migration 153's public_token and
  // migration 155's send-history columns, and naming them explicitly would make the
  // whole read fail until both are applied - which would block sending entirely rather
  // than just losing the history. Ownership is still the security boundary.
  const { data: quote, error: fetchErr } = await supabase
    .from('hd_quotes')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchErr || !quote) return NextResponse.json({ error: 'Quote not found.' }, { status: 404 })

  const q = quote as Record<string, unknown>

  // A declined quote is not re-sent by accident. The tech can revise it and send the
  // revision; re-pushing the one the customer already said no to is nagging, and it is
  // never what the button was meant to do.
  if (q.status === 'declined') {
    return NextResponse.json({
      sent:  false,
      error: 'This customer declined this quote. Revise it before sending it again.',
    })
  }

  let token: string
  try {
    token = await mintQuoteToken(id, user.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // public_token arrives with migration 153. Say which migration, because the
    // alternative is a 500 that looks like an outage.
    if (/public_token|schema cache|does not exist|could not find/i.test(message)) {
      console.error('[hd-quote-send] public_token missing - run migration 153:', message)
      return NextResponse.json({
        error: 'The customer approval link is not available on this database yet (migration 153).',
      }, { status: 500 })
    }
    console.error('[hd-quote-send] token mint failed:', message)
    return NextResponse.json({ error: 'Could not create the approval link.' }, { status: 500 })
  }

  const url = publicQuoteUrl(token)

  // PREVIEW. The token is written - a link that exists only in one HTTP response is not
  // a link - and nothing else is.
  if (body.preview === true) {
    return NextResponse.json({ sent: false, preview: true, url, quote_number: q.quote_number ?? null })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('business_name, phone')
    .eq('id', user.id)
    .maybeSingle()

  const prof       = (profile ?? {}) as Record<string, unknown>
  const validUntil = humanDate(q.valid_until)

  /**
   * Record a delivery that actually happened.
   *
   * THE THREE TIMESTAMPS ARE NOT THE SAME THING - the same distinction the HD invoice
   * send holds:
   *   sent_at      first delivery only, never overwritten. "How long has the customer
   *                had this" counts from here, so a courtesy re-send must not restart
   *                that clock.
   *   last_sent_at every delivery, which is what the tech reads.
   *   sent_count   successful deliveries only.
   *
   * Status is only ever an upgrade. An 'approved' quote keeps 'approved': re-sending a
   * copy of a quote the customer already signed must not un-approve it and strand the
   * work order that approval created.
   *
   * COLUMN-TOLERANT. Migrations are applied by hand and code deploys independently, so
   * there is a window where 155 is not in yet. In that window the status change is the
   * part that matters and the history is dropped, with a warning - refusing the send
   * because a reporting column is missing would be the wrong trade.
   */
  async function recordSend(channel: 'sms' | 'email' | 'link', destination: string | null) {
    const now = new Date().toISOString()
    const update: Record<string, unknown> = {
      sent_at:      (q.sent_at as string | null) ?? now,
      last_sent_at: now,
      sent_count:   Number(q.sent_count ?? 0) + 1,
      updated_at:   now,
    }
    if (q.status === 'draft') update.status = 'sent'
    if (channel === 'sms'   && destination) update.sent_to_phone = destination
    if (channel === 'email' && destination) update.sent_to_email = destination

    const { error } = await supabase
      .from('hd_quotes')
      .update(update)
      .eq('id', id)
      .eq('user_id', user!.id)

    if (!error) {
      return {
        status:       (update.status as string | undefined) ?? String(q.status ?? 'draft'),
        sent_at:      update.sent_at as string,
        last_sent_at: now,
        sent_count:   update.sent_count as number,
      }
    }

    if (isMissingSendColumn(error.message, error.code)) {
      console.warn('[hd-quote-send] send history columns missing - run migration 155:', error.message)
      const fallback: Record<string, unknown> = { updated_at: now }
      if (q.status === 'draft') fallback.status = 'sent'
      const { error: retryErr } = await supabase
        .from('hd_quotes')
        .update(fallback)
        .eq('id', id)
        .eq('user_id', user!.id)
      if (retryErr) console.error('[hd-quote-send] status update failed after delivery:', retryErr.message)
      return {
        status:       (fallback.status as string | undefined) ?? String(q.status ?? 'draft'),
        sent_at:      null,
        last_sent_at: null,
        sent_count:   null,
        warning:      'The quote was sent. Its send history was not recorded - migration 155 has not been applied.',
      }
    }

    // Delivered, but the row did not take the update. Reported as the success it was:
    // failing here would tell the tech to send again, and they would send it twice.
    console.error('[hd-quote-send] send record update failed after delivery:', error.message)
    return {
      status:       String(q.status ?? 'draft'),
      sent_at:      null,
      last_sent_at: null,
      sent_count:   null,
      warning:      'The quote was sent, but we could not update its record. Do not send it again.',
    }
  }

  // ── Link ─────────────────────────────────────────────────────────────────
  // The tech asked for the link to hand over themselves. That IS the delivery, so it
  // records like one - unlike a preview, which is only looking at it.
  if (method === 'link') {
    const record = await recordSend('link', null)
    return NextResponse.json({ sent: true, method: 'link', url, ...record })
  }

  // ── Email ────────────────────────────────────────────────────────────────
  if (method === 'email') {
    const toEmail = (body.email ?? (q.customer_email as string | null) ?? '').trim()
    if (!toEmail) {
      return NextResponse.json({ sent: false, url, error: 'No email address for this customer.' })
    }

    const suppression = await getContactSuppression(supabase, (q.customer_id as string | null) ?? null)
    if (suppression.no_email) {
      return NextResponse.json({
        sent: false, suppressed: true, url,
        error: 'This customer has asked not to receive email.',
      })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      // Said plainly rather than returned as a fake success: a tech who believes the
      // quote went out will wait on an approval nobody was asked for.
      return NextResponse.json({
        sent: false, url,
        error: 'Email delivery is not configured on this deployment. Use SMS, or copy the link and send it yourself.',
      })
    }

    const { subject, text } = buildQuoteEmail({
      businessName:  prof.business_name as string | null | undefined,
      businessPhone: prof.phone as string | null | undefined,
      quoteNumber:   String(q.quote_number ?? 'Quote'),
      total:         q.total as number | string | null,
      url,
      validUntil,
    })

    try {
      const { Resend } = await import('resend')
      const { error: sendErr } = await new Resend(apiKey).emails.send({
        from: QUOTE_FROM, to: toEmail, subject, text,
      })
      if (sendErr) {
        return NextResponse.json({
          sent: false, url, to: toEmail,
          error: sendErr.message || 'The email could not be delivered.',
        })
      }
    } catch (err) {
      return NextResponse.json({
        sent: false, url, to: toEmail,
        error: err instanceof Error ? err.message : 'The email could not be delivered.',
      })
    }

    const record = await recordSend('email', toEmail)
    return NextResponse.json({ sent: true, method: 'email', to: toEmail, url, ...record })
  }

  // ── SMS ──────────────────────────────────────────────────────────────────
  const to = (body.phone ?? (q.customer_phone as string | null) ?? '').trim()
  if (!to) {
    return NextResponse.json({ sent: false, url, error: 'No phone number for this customer.' })
  }

  // A customer marked do-not-SMS is not texted even on a manual send: the flag is the
  // customer's instruction, not a preference about automation.
  const suppression = await getContactSuppression(supabase, (q.customer_id as string | null) ?? null)
  if (suppression.no_sms) {
    return NextResponse.json({
      sent: false, suppressed: true, url,
      error: 'This customer has asked not to receive text messages.',
    })
  }

  const smsBody = buildQuoteSms({
    businessName:  prof.business_name as string | null | undefined,
    businessPhone: prof.phone as string | null | undefined,
    quoteNumber:   String(q.quote_number ?? 'Quote'),
    total:         q.total as number | string | null,
    url,
    validUntil,
  })

  const result = await sendSmsResult({ to, body: smsBody })

  if (!result.success) {
    return NextResponse.json({
      sent: false, url, to,
      error: result.error ?? 'Text message could not be delivered.',
    })
  }

  const record = await recordSend('sms', to)
  return NextResponse.json({ sent: true, method: 'sms', to, url, ...record })
}
