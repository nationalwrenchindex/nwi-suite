// ─── Is this customer already on file? ────────────────────────────────────────
// SERVER ONLY.
//
// POST /api/customers inserted unconditionally, so every "+ New customer" in the
// picker minted a row whether or not the shop already had that person. Production
// shows what that costs: Josh Johnston three times at one shop inside 32 minutes, and
// Polk Sherrif three times inside five.
//
// The matching rules are deliberately the SAME ONES logHDCustomer already uses on the
// HD side -- email case-insensitively, then phone on the trailing ten digits -- so the
// two paths cannot disagree about whether two rows are the same person. A third set of
// rules would be a third answer.

import type { SupabaseClient } from '@supabase/supabase-js'

export type DedupeReason = 'email' | 'phone' | 'name_no_contact'

export interface DedupeHit {
  id:     string
  reason: DedupeReason
}

const digits10 = (v: unknown): string => String(v ?? '').replace(/\D/g, '').slice(-10)
const clean    = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Find an existing customer for this shop that is the same person, or null.
 *
 * Scoped to one user_id throughout: customers are per-shop, so two shops both having
 * Brock Fleeman is not duplication, it is two shops with the same customer. Production
 * has exactly that across three shops and none of it is a duplicate.
 */
export async function findDuplicateCustomer(
  supabase: SupabaseClient,
  userId:   string,
  input:    { first_name?: unknown; last_name?: unknown; phone?: unknown; email?: unknown },
): Promise<DedupeHit | null> {
  const email = clean(input.email).toLowerCase()
  const phone = digits10(input.phone)
  const first = clean(input.first_name)
  const last  = clean(input.last_name)

  // ── 1. Email, case-insensitively ──
  if (email) {
    // LIKE metacharacters are escaped: '_' is a single-character wildcard, so an
    // unescaped "john_doe@x.com" would also match "johnXdoe@x.com" and bind this
    // record to the wrong person. Same guard logHDCustomer carries.
    const pattern = email.replace(/[\\%_]/g, m => `\\${m}`)
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .ilike('email', pattern)
      .limit(1)
    if (data && data.length > 0) return { id: data[0].id as string, reason: 'email' }
  }

  // ── 2. Phone, on the trailing ten digits ──
  // Compared in JS rather than SQL because "863-555-0100" and "+18635550100" are the
  // same number and no index can normalise that for us.
  if (phone.length === 10) {
    const { data } = await supabase
      .from('customers')
      .select('id, phone')
      .eq('user_id', userId)
      .not('phone', 'is', null)
    const hit = (data ?? []).find(c => digits10(c.phone) === phone)
    if (hit) return { id: hit.id as string, reason: 'phone' }
  }

  // ── 3. Same name, and NEITHER row has any contact detail ──
  //
  // This is the case that actually produced the duplicates in production: a tech types
  // a name, leaves phone and email blank, and there is nothing for rules 1 and 2 to
  // match on. Restricted to rows that ALSO have no contact details, so a shop with a
  // "John Smith" on file at a known number still gets a second John Smith when one
  // walks in -- those are plausibly different people. Two rows with the same name and
  // no way at all to tell them apart are not.
  //
  // Reported back as `name_no_contact` so the caller can say what it did rather than
  // silently returning someone else's record.
  if (!email && !phone && first && last) {
    const { data } = await supabase
      .from('customers')
      .select('id, phone, email')
      .eq('user_id', userId)
      .ilike('first_name', first.replace(/[\\%_]/g, m => `\\${m}`))
      .ilike('last_name',  last.replace(/[\\%_]/g, m => `\\${m}`))
    const hit = (data ?? []).find(c => !clean(c.phone) && !clean(c.email))
    if (hit) return { id: hit.id as string, reason: 'name_no_contact' }
  }

  return null
}

/** What the UI should say when a create turned into a match. */
export const DEDUPE_MESSAGE: Record<DedupeReason, string> = {
  email:           'matched an existing customer by email',
  phone:           'matched an existing customer by phone number',
  name_no_contact: 'matched an existing customer with the same name and no contact details',
}
