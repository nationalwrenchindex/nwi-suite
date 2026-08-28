// SERVER-ONLY. Mint and resolve the public (no-login) payment token for an HD invoice.
//
// The token is a CAPABILITY URL: whoever holds it can read the invoice, so it has
// to be unguessable and it must never be derived from the invoice id or
// invoice_number. Both of those are enumerable and both are printed on the paper
// copy the customer leaves on a dispatcher's desk.
//
// Reads deliberately go through the SERVICE-ROLE client. There is no anon RLS
// policy on hd_invoices.public_token (see migration 116) — the exact-token filter
// below is the only door, and it lives on the server where it cannot be widened
// by a client.

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

// 32 bytes -> 64 hex chars, 256 bits of entropy. Overkill against brute force on
// purpose: this URL travels through SMS, gets forwarded, and never expires, so the
// cost of a too-short token is unbounded and the cost of a long one is 32 extra
// characters in a text message.
function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export interface PublicInvoiceBranding {
  business_name:       string | null
  hd_company_logo_url: string | null
  business_logo_url:   string | null
  phone:               string | null
  email:               string | null
  city:                string | null
  state:               string | null
}

export interface PublicInvoiceResult {
  // hd_invoices is a wide, frequently-extended table and this page renders a
  // read-only document from it, so it is carried as a loose record rather than
  // re-declaring 40 columns that would drift out of date on the next migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  invoice:  Record<string, any>
  branding: PublicInvoiceBranding
}

const BRANDING_SELECT = 'business_name, hd_company_logo_url, business_logo_url, phone, email, city, state'

/**
 * Return the invoice's public token, creating one if it does not have one yet.
 *
 * IDEMPOTENT BY DESIGN. Re-sending an invoice (a reminder text, a second SMS to a
 * different number) must not rotate the token — the customer may already have the
 * first message open, and silently breaking that link looks like a dead business.
 *
 * Scoped by BOTH id and user_id so an id lifted from someone else's invoice cannot
 * be used to mint a live public URL onto their row.
 *
 * Throws if the invoice does not exist or is not owned by userId.
 */
export async function mintInvoiceToken(
  svc:       SupabaseClient,
  invoiceId: string,
  userId:    string,
): Promise<string> {
  const { data: existing, error: readErr } = await svc
    .from('hd_invoices')
    .select('public_token')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (readErr) throw new Error(`Failed to read invoice: ${readErr.message}`)
  if (!existing) throw new Error('Invoice not found')

  const current = (existing.public_token as string | null) ?? null
  if (current) return current

  const token = generateToken()

  // .is('public_token', null) makes this a compare-and-set. Two sends firing at
  // once would otherwise both generate a token and the second would overwrite the
  // first — invalidating a link that had already gone out over SMS.
  const { data: updated, error: writeErr } = await svc
    .from('hd_invoices')
    .update({ public_token: token })
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .is('public_token', null)
    .select('public_token')
    .maybeSingle()

  if (writeErr) throw new Error(`Failed to mint invoice token: ${writeErr.message}`)
  if (updated?.public_token) return updated.public_token as string

  // Lost the race: another request minted first. Its token is the live one.
  const { data: raced } = await svc
    .from('hd_invoices')
    .select('public_token')
    .eq('id', invoiceId)
    .eq('user_id', userId)
    .maybeSingle()

  const settled = (raced?.public_token as string | null) ?? null
  if (!settled) throw new Error('Failed to mint invoice token')
  return settled
}

/**
 * Resolve a public token to its invoice plus the subscriber's white-label branding.
 * Returns null for an unknown token so the caller can render one neutral response
 * for "never existed" and "existed and was deleted" alike.
 */
export async function getInvoiceByToken(
  svc:   SupabaseClient,
  token: string,
): Promise<PublicInvoiceResult | null> {
  // Guard the empty string explicitly. `.eq('public_token', '')` is a legitimate
  // query, and if a row ever carried '' it would match every visitor to /pay/.
  const clean = (token ?? '').trim()
  if (!clean) return null

  const { data: invoice, error } = await svc
    .from('hd_invoices')
    .select('*')
    .eq('public_token', clean)
    .maybeSingle()

  if (error || !invoice) return null

  const { data: profile } = await svc
    .from('profiles')
    .select(BRANDING_SELECT)
    .eq('id', invoice.user_id)
    .maybeSingle()

  const p = (profile ?? {}) as Partial<PublicInvoiceBranding>

  return {
    invoice,
    branding: {
      business_name:       p.business_name       ?? null,
      hd_company_logo_url: p.hd_company_logo_url ?? null,
      business_logo_url:   p.business_logo_url   ?? null,
      phone:               p.phone               ?? null,
      email:               p.email               ?? null,
      city:                p.city                ?? null,
      state:               p.state               ?? null,
    },
  }
}

/** Absolute URL for a minted token. Safe to embed in an SMS body. */
export function publicInvoiceUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com').replace(/\/$/, '')
  return `${base}/hd/invoices/pay/${token}`
}
