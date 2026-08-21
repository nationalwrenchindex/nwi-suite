// SERVER-ONLY. Resolves the structural fleet/unit links for an HD invoice.
//
// hd_invoices historically carried only free-text unit fields (unit_manufacturer,
// unit_model, unit_serial, ...) plus, since migration 102, a work_order_id. Migration
// 105 added unit_id and fleet_account_id, and the entire Fleet Pro portal — dashboard,
// unit detail, cost reports — keys off those two columns. An invoice written without
// them is invisible to the customer who paid for it, with no error anywhere to explain
// why, so they have to be resolved at write time rather than patched up later.
//
// This is best-effort plumbing: it never throws and never blocks an invoice from being
// saved. A missing link costs the customer a dashboard row; a failed insert costs Kurt
// the invoice.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface InvoiceLinkInput {
  work_order_id?: string | null
  unit_id?:       string | null
  unit_serial?:   string | null
}

export interface InvoiceFleetLinks {
  unit_id:          string | null
  fleet_account_id: string | null
}

const NO_LINKS: InvoiceFleetLinks = { unit_id: null, fleet_account_id: null }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Serials are typed by hand and get compared case-insensitively, so ilike is the right
// operator — but '%' and '_' are wildcards to it. A serial containing either would
// silently widen the match, which is exactly the failure this module exists to prevent.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, m => `\\${m}`)
}

/**
 * Work out which unit and fleet account an invoice belongs to.
 *
 * Resolution order, most reliable first — the first source that yields anything wins:
 *   1. work_order_id — the work order already carries verified unit_id/fleet_account_id.
 *   2. an explicitly supplied unit_id, after confirming the unit belongs to this user.
 *   3. a case-insensitive match on unit_serial against this user's units.
 *
 * AMBIGUITY RULE: step 3 accepts a serial match ONLY when exactly one unit matches.
 * Two units sharing a serial (duplicate entry, or the same serial reused across two
 * departments the mechanic services) resolve to null, never to a best guess. Guessing
 * wrong publishes one department's service record and cost figures on another
 * department's Fleet Pro dashboard — a cross-tenant data leak, not a display glitch.
 * A null link is a row the customer does not see; a wrong link is a row they should
 * never have seen.
 *
 * Never throws. On any error it logs and returns nulls.
 */
export async function resolveInvoiceFleetLinks(
  svc:    SupabaseClient,
  userId: string,
  input:  InvoiceLinkInput,
): Promise<InvoiceFleetLinks> {
  try {
    const workOrderId = str(input.work_order_id)
    const unitId      = str(input.unit_id)
    const serial      = str(input.unit_serial)

    // 1. Work order — authoritative. Scoped to the caller's own rows so a forged id
    //    from the request body cannot pull another mechanic's fleet through.
    if (workOrderId) {
      const { data, error } = await svc
        .from('hd_work_orders')
        .select('unit_id, fleet_account_id')
        .eq('id', workOrderId)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) console.error('[fleet-pro invoice-link] work order lookup failed', error)

      const woUnit  = (data?.unit_id          as string | null) ?? null
      const woFleet = (data?.fleet_account_id as string | null) ?? null
      // Only a hit if the work order actually carries a link. An unlinked work order
      // tells us nothing, so fall through rather than discarding a usable serial.
      if (woUnit || woFleet) return { unit_id: woUnit, fleet_account_id: woFleet }
    }

    // 2. Explicit unit_id — trusted only after an ownership check. An id we cannot
    //    verify resolves to null rather than being written through unchecked.
    if (unitId) {
      const { data, error } = await svc
        .from('hd_units')
        .select('id, fleet_account_id')
        .eq('id', unitId)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) console.error('[fleet-pro invoice-link] unit lookup failed', error)
      if (data) {
        return {
          unit_id:          data.id as string,
          fleet_account_id: (data.fleet_account_id as string | null) ?? null,
        }
      }
      return NO_LINKS
    }

    // 3. Serial match — the only path available when a tech types the unit in by hand.
    if (serial) {
      const { data, error } = await svc
        .from('hd_units')
        .select('id, fleet_account_id, serial_number')
        .eq('user_id', userId)
        .ilike('serial_number', escapeLike(serial))
        .limit(5)

      if (error) {
        console.error('[fleet-pro invoice-link] serial lookup failed', error)
        return NO_LINKS
      }

      // Re-check in JS: ilike does not trim, so a stored serial with stray whitespace
      // still has to be normalized before it counts as a match.
      const wanted  = serial.toLowerCase()
      const matches = (data ?? []).filter(
        u => str(u.serial_number).toLowerCase() === wanted,
      )

      if (matches.length === 1) {
        return {
          unit_id:          matches[0].id as string,
          fleet_account_id: (matches[0].fleet_account_id as string | null) ?? null,
        }
      }
      if (matches.length > 1) {
        console.warn(
          `[fleet-pro invoice-link] serial "${serial}" matched ${matches.length} units — leaving invoice unlinked`,
        )
      }
    }

    return NO_LINKS
  } catch (err) {
    console.error('[fleet-pro invoice-link] failed', err)
    return NO_LINKS
  }
}
