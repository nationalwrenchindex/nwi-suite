// The single gate every automated outbound path must consult before texting or
// emailing a customer.
//
// There is exactly one place that decides whether a customer may be contacted,
// and it is this file. Suppression checks scattered across a dozen cron routes
// drift: one gets the column name wrong, one forgets the email branch, one is
// added six months later and never backfilled into the others. Every sender
// calling the same function is the only version of this that stays true.
//
// `suppressionLabel` at the bottom is pure and imports nothing server-side, so
// client components can render the same wording the server enforces.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ContactChannel = 'sms' | 'email'

export interface ContactSuppression {
  no_email: boolean
  no_sms:   boolean
  note:     string | null
}

// What we return when we could not read the row. Named rather than inlined so
// every early-return below is visibly the same decision, not four coincidences.
const NOT_SUPPRESSED: ContactSuppression = { no_email: false, no_sms: false, note: null }

/**
 * Read a customer's contact suppression flags.
 *
 * FAILS OPEN — and this is the deliberate, load-bearing decision in this file.
 *
 * If the customer row cannot be read — bad id, network blip, RLS surprise,
 * migration 117 not yet applied to this environment — this returns NOT
 * suppressed, i.e. the send is allowed to proceed. That is the opposite of the
 * usual security default and it is correct here, because of what the two failure
 * modes actually cost:
 *
 *   - Fail closed on a lookup error: a transient database hiccup silently stops
 *     a business's invoices, job reminders and review requests from going out.
 *     Nothing errors visibly, nobody is paged, and the mechanic finds out weeks
 *     later from the unpaid invoices. The failure is invisible and compounding.
 *
 *   - Fail open on a lookup error: a customer who asked not to be texted may
 *     receive one text during the outage. That is a real harm and it is a
 *     bounded, visible, apologisable one.
 *
 * This is a courtesy-preference gate, not an authorization boundary, and the
 * asymmetry above only holds because of that. If these flags ever come to carry
 * a legal obligation — TCPA revocation, a formal unsubscribe of record — this
 * decision must be revisited, because for a legal duty the arithmetic reverses.
 *
 * The one thing that is never allowed: if the row IS read and the flag IS set,
 * the send does not happen. Failing open covers ignorance, never a known "no".
 */
export async function getContactSuppression(
  svc:        SupabaseClient,
  customerId: string | null | undefined,
): Promise<ContactSuppression> {
  // No customer id in scope at all. Many outbound paths only carry a phone
  // number or an email string (see the invoice send flows), and those cannot be
  // gated on a row that was never identified. Allowing the send keeps today's
  // behaviour; the fix is to thread a customer_id through, not to block here.
  if (!customerId) return NOT_SUPPRESSED

  const { data, error } = await svc
    .from('customers')
    .select('no_email, no_sms, contact_prefs_note')
    .eq('id', customerId)
    .maybeSingle()

  // Logged, not thrown. A sender must never crash because the preference lookup
  // failed — the message is the product, this check is a guard on it.
  if (error) {
    console.error('[customer-contact] suppression lookup failed, allowing send:', error.message)
    return NOT_SUPPRESSED
  }

  // Row genuinely absent (deleted customer, stale id). Nothing was suppressed
  // because nothing exists to suppress.
  if (!data) return NOT_SUPPRESSED

  // Coerced rather than trusted: if migration 117 has not run in this
  // environment the columns come back undefined, and `undefined` must read as
  // "not suppressed" rather than leaking a falsy-but-unknown value onward.
  return {
    no_email: data.no_email === true,
    no_sms:   data.no_sms === true,
    note:     data.contact_prefs_note ?? null,
  }
}

/**
 * True if it is OK to send `channel` to this customer.
 *
 * The call every sender should make:
 *
 *   if (!(await canContact(svc, invoice.customer_id, 'sms'))) return
 *
 * Inherits the fail-open behaviour documented on getContactSuppression: a
 * lookup that cannot be completed answers true.
 */
export async function canContact(
  svc:        SupabaseClient,
  customerId: string | null | undefined,
  channel:    ContactChannel,
): Promise<boolean> {
  const s = await getContactSuppression(svc, customerId)
  return channel === 'sms' ? !s.no_sms : !s.no_email
}

/**
 * Suppression flags for several customers in one round trip.
 *
 * For list and cron paths that would otherwise issue one SELECT per recipient.
 * Same fail-open contract: a failed read yields an empty map, and every lookup
 * against it then falls through to "not suppressed".
 */
export async function getContactSuppressionMap(
  svc:         SupabaseClient,
  customerIds: readonly string[],
): Promise<Map<string, ContactSuppression>> {
  const map = new Map<string, ContactSuppression>()

  const ids = [...new Set(customerIds.filter(Boolean))]
  if (ids.length === 0) return map

  const { data, error } = await svc
    .from('customers')
    .select('id, no_email, no_sms, contact_prefs_note')
    .in('id', ids)

  if (error) {
    console.error('[customer-contact] bulk suppression lookup failed, allowing sends:', error.message)
    return map
  }

  for (const row of data ?? []) {
    map.set(row.id, {
      no_email: row.no_email === true,
      no_sms:   row.no_sms === true,
      note:     row.contact_prefs_note ?? null,
    })
  }
  return map
}

/** Companion to the map above — an id with no entry is not suppressed. */
export function canContactFromMap(
  map:        Map<string, ContactSuppression>,
  customerId: string | null | undefined,
  channel:    ContactChannel,
): boolean {
  if (!customerId) return true
  const s = map.get(customerId)
  if (!s) return true
  return channel === 'sms' ? !s.no_sms : !s.no_email
}

/**
 * Human-readable summary of what is switched off, or null when nothing is.
 *
 * PURE — no imports, no I/O, safe in a client component. It exists so the badge
 * a mechanic reads in the UI is generated by the same code that describes the
 * rule the server enforces, instead of two hand-written strings that disagree
 * after the next change.
 */
export function suppressionLabel(s: ContactSuppression | null | undefined): string | null {
  if (!s) return null
  const off: string[] = []
  if (s.no_sms)   off.push('No SMS')
  if (s.no_email) off.push('No email')
  return off.length > 0 ? off.join(' · ') : null
}

/**
 * Suppression looked up by PHONE rather than by customer id.
 *
 * Needed because several outbound paths never carry a customer id. torquewrench_reviews
 * has no customer_id column and its job_id is frequently null, and hd_invoices has no
 * customer_id either — so for those senders the phone number is the only handle on who
 * is being contacted. Matching on the trailing 10 digits mirrors how logHDCustomer
 * already reconciles HD customers, so a number stored as "(863) 555-0100" still matches
 * one sent as "+18635550100".
 *
 * Same fail-open contract as getContactSuppression: an unreadable row, an unparseable
 * number, or no match at all yields NOT_SUPPRESSED. A customer who was never recorded
 * cannot have asked to be left alone.
 *
 * Ambiguity is resolved toward the customer: if two rows for this user share the
 * number and EITHER is suppressed, treat it as suppressed. Contacting someone who
 * opted out is the worse error.
 */
export async function getContactSuppressionByPhone(
  svc:    SupabaseClient,
  userId: string | null | undefined,
  phone:  string | null | undefined,
): Promise<ContactSuppression> {
  if (!userId || !phone) return NOT_SUPPRESSED

  const digits = String(phone).replace(/\D/g, '').slice(-10)
  if (digits.length < 10) return NOT_SUPPRESSED

  try {
    const { data, error } = await svc
      .from('customers')
      .select('phone, no_sms, no_email, contact_prefs_note')
      .eq('user_id', userId)
      .not('phone', 'is', null)

    if (error || !data) return NOT_SUPPRESSED

    const matches = data.filter(r => String(r.phone ?? '').replace(/\D/g, '').slice(-10) === digits)
    if (matches.length === 0) return NOT_SUPPRESSED

    return {
      no_sms:   matches.some(r => r.no_sms === true),
      no_email: matches.some(r => r.no_email === true),
      note:     (matches.find(r => r.contact_prefs_note)?.contact_prefs_note as string | null) ?? null,
    }
  } catch {
    return NOT_SUPPRESSED
  }
}
