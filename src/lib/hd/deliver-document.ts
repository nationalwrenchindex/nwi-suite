// Deliver a saved HD quote or invoice to its customer, from a form's "Send" button.
//
// WHY THIS EXISTS
//
// The HD quote form's "Send Quote" and the new-invoice "Save & Send Invoice" used to
// save the row with status 'sent' and do nothing else. No email, no text: the button
// MARKED a document sent. A shop owner clicked it for weeks believing customers had
// their quotes, and pasted a link into Gmail by hand the one time he found out.
//
// The send routes (/api/hd/quotes/[id]/send, /api/hd/invoices/[id]/send) already
// deliver and record "sent" ONLY after a channel confirms. The forms now save the
// document unsent and come here, so there is one path that claims a send and it is
// the one that makes it.
//
// Email when the document has an address, a text when it has a number - both when it
// has both. Each channel's failure is kept, word for word, so the caller can show it.

export type DeliverKind = 'quote' | 'invoice'

export interface DeliverResult {
  /** Channels that confirmed delivery. Empty means nothing reached the customer. */
  delivered: Array<'email' | 'sms'>
  /** One human-readable line per failed channel. */
  errors:    string[]
}

/** True when there is something to send TO. A form refuses Send without one. */
export function hasDeliveryTarget(phone: string | null | undefined, email: string | null | undefined): boolean {
  return Boolean((phone ?? '').trim() || (email ?? '').trim())
}

/**
 * POST to the document's send route once per channel the customer has. `fetcher` is
 * injectable so a check can drive the real routes with its own session.
 */
export async function deliverHDDocument(
  kind: DeliverKind,
  id: string,
  contact: { phone?: string | null; email?: string | null },
  fetcher: typeof fetch = fetch,
): Promise<DeliverResult> {
  const url = kind === 'quote' ? `/api/hd/quotes/${id}/send` : `/api/hd/invoices/${id}/send`
  const email = (contact.email ?? '').trim()
  const phone = (contact.phone ?? '').trim()
  const out: DeliverResult = { delivered: [], errors: [] }

  const channels: Array<['email' | 'sms', Record<string, string>]> = []
  if (email) channels.push(['email', { method: 'email', email }])
  if (phone) channels.push(['sms',   { method: 'sms',   phone }])
  if (!channels.length) {
    out.errors.push('There is no email address or phone number to send to.')
    return out
  }

  for (const [channel, body] of channels) {
    const label = channel === 'email' ? `Email to ${email}` : `Text to ${phone}`
    try {
      const res  = await fetcher(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({})) as { sent?: boolean; error?: string }
      if (res.ok && json.sent === true) out.delivered.push(channel)
      else out.errors.push(`${label} failed: ${json.error ?? `the server answered ${res.status}`}`)
    } catch (err) {
      out.errors.push(`${label} failed: ${err instanceof Error ? err.message : 'network error'}`)
    }
  }
  return out
}
