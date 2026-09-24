// ─── Work Orders access gate ──────────────────────────────────────────────────
// The feature is hidden per business behind profiles.work_orders_enabled (135).
// "Hidden" here means the routes do not answer, not merely that the nav item is
// absent: a URL typed by hand, or a stale bookmark from a business whose flag was
// switched off, must not reach a work order.
//
// Every page and every API route under /work-orders goes through this. One helper
// rather than an inline select per route, because a feature gate that is spelled
// out in nine places is a feature gate with eight chances to be spelled wrong.

import type { SupabaseClient } from '@supabase/supabase-js'

/** True only when the flag is explicitly on. A missing profile, a null column or a
 *  failed read all read as OFF — the gate fails closed. */
export async function hasWorkOrders(
  supabase: SupabaseClient,
  userId:   string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('work_orders_enabled')
    .eq('id', userId)
    .single()

  if (error) {
    console.error('[work-orders gate]', error.message)
    return false
  }
  return data?.work_orders_enabled === true
}
