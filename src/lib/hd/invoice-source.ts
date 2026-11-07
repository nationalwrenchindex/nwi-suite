// ─── What an HD invoice was made from ─────────────────────────────────────────
//
// An invoice from a work order prints "Work Order: WO-..." off its own denormalized
// work_order_number. An invoice billed straight from a quote ("Bill Directly") printed
// nothing at all - INV-2026-0028 had no trail back to Q-2026-0013, the document the
// customer approved. hd_invoices stores the quote's id (quote_id), not its number, so
// the number is read here through that id, scoped to the invoice's own shop. A quote
// number never changes once issued, so reading it is not reading a live value.

import type { SupabaseClient } from '@supabase/supabase-js'

/** The quote number this invoice came from, or null. Never throws: a citation is not worth a failed page. */
export async function sourceQuoteNumber(
  supabase: SupabaseClient,
  inv: { quote_id?: unknown; user_id?: unknown },
): Promise<string | null> {
  if (typeof inv.quote_id !== 'string' || !inv.quote_id) return null
  try {
    let q = supabase.from('hd_quotes').select('quote_number').eq('id', inv.quote_id)
    if (typeof inv.user_id === 'string' && inv.user_id) q = q.eq('user_id', inv.user_id)
    const { data } = await q.maybeSingle()
    const n = (data as { quote_number?: unknown } | null)?.quote_number
    return typeof n === 'string' && n.trim() ? n.trim() : null
  } catch {
    return null
  }
}
