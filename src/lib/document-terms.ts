// ─── The terms block on LD quotes and invoices ────────────────────────────────
// docs/NWI-ESTIMATE-DOCUMENT-SPEC.md section 2.8, build-order item 3. Migration 164.
//
//   warranty terms               e.g. 90 days / 4,000 miles on workmanship
//   customer-supplied parts      the customer's own part is not warranted, and a
//                                re-diagnosis is billable - in writing
//   payment terms                Due on receipt / Net 7 ...
//   how to pay                   remit address and instructions, and/or a pay link
//
// Shop level, set once in Settings. But RECORDED VALUES BEAT CURRENT SETTINGS: a quote
// records the shop's terms when it is first SENT and an invoice when it is FINALIZED,
// and the customer's copy prints what the document recorded. A document with nothing
// recorded (everything sent before 164) prints no terms block at all - exactly as it
// printed before.

import type { SupabaseClient } from '@supabase/supabase-js'
import { termsDisplay } from '@/lib/hd/payment-terms'

export interface TermsSnapshot {
  version:                  1
  captured_at:              string
  warranty:                 string | null
  customer_supplied_clause: string | null
  /** due_on_receipt | net_7 | ... as the shop's default stood at capture. */
  payment_terms:            string | null
  /** How to pay: remit address, Zelle, cheque instructions - free text. */
  payment_instructions:     string | null
  pay_link:                 string | null
}

/** The profile columns migration 164 adds. */
export const TERMS_PROFILE_SELECT_164 = 'warranty_terms, customer_supplied_parts_clause, pay_link_url'

const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/**
 * A pay link the customer's copy may render as a link: https only, a real URL, no
 * credentials in it. Anything else - javascript:, a typo, plain http - is refused, so
 * a shop's settings field can never put a hostile or broken link on a document.
 */
export function safePayLink(v: unknown): string | null {
  const s = text(v)
  if (!s || s.length > 500) return null
  try {
    const u = new URL(s)
    if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null
    return u.toString()
  } catch {
    return null
  }
}

/** The shop's terms right now, ready to record on a document. */
export function termsSnapshotFrom(
  profile: Record<string, unknown> | null | undefined,
  now = new Date(),
): TermsSnapshot {
  const p = profile ?? {}
  return {
    version:                  1,
    captured_at:              now.toISOString(),
    warranty:                 text(p.warranty_terms),
    customer_supplied_clause: text(p.customer_supplied_parts_clause),
    payment_terms:            text(p.default_payment_terms),
    payment_instructions:     text(p.default_payment_instructions),
    pay_link:                 safePayLink(p.pay_link_url),
  }
}

/** A stored snapshot, or null when the document recorded none. Never throws. */
export function parseTermsSnapshot(v: unknown): TermsSnapshot | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (o.version !== 1) return null
  return {
    version:                  1,
    captured_at:              typeof o.captured_at === 'string' ? o.captured_at : '',
    warranty:                 text(o.warranty),
    customer_supplied_clause: text(o.customer_supplied_clause),
    payment_terms:            text(o.payment_terms),
    payment_instructions:     text(o.payment_instructions),
    // Re-checked on read, so a value written by anything else still cannot render as
    // an unsafe link.
    pay_link:                 safePayLink(o.pay_link),
  }
}

export interface TermsRow {
  key:   'warranty' | 'customer_supplied' | 'payment_terms' | 'how_to_pay'
  label: string
  text:  string | null
  link?: string | null
}

/**
 * The rows the terms block prints, in spec order. A row with nothing to say is
 * omitted, and no rows means no block - never an empty heading.
 *
 * An invoice already prints its own payment terms and How to Pay section, so it asks
 * for the warranty and the clause only and takes the pay link separately.
 */
export function termsBlockRows(
  snap: TermsSnapshot | null,
  opts: { includePayment: boolean },
): TermsRow[] {
  if (!snap) return []
  const rows: TermsRow[] = []
  if (snap.warranty) rows.push({ key: 'warranty', label: 'Warranty', text: snap.warranty })
  if (snap.customer_supplied_clause) {
    rows.push({ key: 'customer_supplied', label: 'Customer-supplied parts', text: snap.customer_supplied_clause })
  }
  if (opts.includePayment) {
    if (snap.payment_terms) {
      rows.push({ key: 'payment_terms', label: 'Payment terms', text: termsDisplay(snap.payment_terms) })
    }
    if (snap.payment_instructions || snap.pay_link) {
      rows.push({ key: 'how_to_pay', label: 'How to pay', text: snap.payment_instructions, link: snap.pay_link })
    }
  }
  return rows
}

/** True when a read or write failed only because migration 164 is not applied. */
export function isMissing164Column(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const m = String((error as { message?: unknown }).message ?? '').toLowerCase()
  const named = ['terms_snapshot', 'warranty_terms', 'customer_supplied_parts_clause', 'pay_link_url']
    .some(c => m.includes(c))
  return named && (m.includes('does not exist') || m.includes('could not find') || m.includes('schema cache'))
}

/**
 * Record the shop's terms on a document that has none yet. Called when a quote is
 * sent and when an invoice is finalized - for HD, when an invoice is sent, the point
 * at which the customer is handed it (HD invoices have no finalize step). An HD
 * document carried from a quote already holds the quote's terms and keeps them.
 *
 * NEVER FAILS THE CALLER. A quote that went to the customer, or an invoice that was
 * finalized, must not be reported as failed because a display block could not be
 * stored - and before 164 is applied the columns simply are not there. A document
 * that already recorded terms keeps them: a resend does not re-capture.
 */
export async function recordTermsSnapshot(
  supabase: SupabaseClient,
  table:    'quotes' | 'invoices' | 'hd_quotes' | 'hd_invoices',
  id:       string,
  userId:   string,
): Promise<{ written: boolean; reason?: string }> {
  try {
    const { data: doc, error: docErr } = await supabase
      .from(table).select('terms_snapshot').eq('id', id).eq('user_id', userId).single()
    if (docErr) return { written: false, reason: docErr.message }
    if ((doc as { terms_snapshot?: unknown } | null)?.terms_snapshot) {
      return { written: false, reason: 'already recorded' }
    }
    const { data: profile, error: pErr } = await supabase
      .from('profiles')
      .select(`${TERMS_PROFILE_SELECT_164}, default_payment_terms, default_payment_instructions`)
      .eq('id', userId)
      .single()
    if (pErr) return { written: false, reason: pErr.message }
    const { error } = await supabase
      .from(table)
      .update({ terms_snapshot: termsSnapshotFrom(profile as Record<string, unknown>) })
      .eq('id', id)
      .eq('user_id', userId)
      .is('terms_snapshot', null)
    return error ? { written: false, reason: error.message } : { written: true }
  } catch (e) {
    return { written: false, reason: e instanceof Error ? e.message : 'unknown' }
  }
}

/**
 * The payment terms a DOCUMENT prints (HD parity pass, Brock Oct 25): its own recorded
 * payment_terms; failing that, the terms its snapshot recorded; failing both, nothing.
 * No silent default - a blank must never print as "Due on receipt" or Net 30.
 */
export function documentPaymentTerms(
  ownTerms: string | null | undefined,
  snap: TermsSnapshot | null,
): string | null {
  const own = typeof ownTerms === 'string' && ownTerms.trim() ? ownTerms.trim() : null
  const recorded = own ?? snap?.payment_terms ?? null
  return recorded ? termsDisplay(recorded) : null
}

/**
 * The terms block an HD document prints at its bottom: warranty, the customer-supplied
 * parts clause and how to pay, all from what the document RECORDED. Payment terms are
 * not here - they come from the document itself (documentPaymentTerms). No rows, no
 * block.
 */
export function hdTermsBlockRows(snap: TermsSnapshot | null): TermsRow[] {
  if (!snap) return []
  const rows = termsBlockRows(snap, { includePayment: false })
  if (snap.payment_instructions || snap.pay_link) {
    rows.push({ key: 'how_to_pay', label: 'How to pay', text: snap.payment_instructions, link: snap.pay_link })
  }
  return rows
}

