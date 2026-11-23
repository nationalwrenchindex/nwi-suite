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
import { findUnitBySerialAndModel } from '@/lib/hd/unit-match-server'

export interface InvoiceLinkInput {
  work_order_id?: string | null
  unit_id?:       string | null
  unit_serial?:   string | null
  /** The model typed on the invoice. A serial links a unit only when this agrees (lib/hd/unit-match). */
  unit_model?:    string | null
}

export interface InvoiceFleetLinks {
  unit_id:          string | null
  fleet_account_id: string | null
  /** Set when the serial found a unit but the link was refused - shown to the user, never silent. */
  notice?:          string | null
}

const NO_LINKS: InvoiceFleetLinks = { unit_id: null, fleet_account_id: null }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Work out which unit and fleet account an invoice belongs to.
 *
 * Resolution order, most reliable first — the first source that yields anything wins:
 *   1. work_order_id — the work order already carries verified unit_id/fleet_account_id.
 *   2. an explicitly supplied unit_id, after confirming the unit belongs to this user.
 *   3. unit_serial against this user's units - AND unit_model must agree (Nov 23, 2026).
 *
 * SERIAL + MODEL RULE (lib/hd/unit-match, the same rule as the calendar and quote
 * approval): a serial alone never links. The serial must match, the model must agree,
 * and exactly one unit may pass; otherwise nothing links and `notice` says why.
 *
 * AMBIGUITY RULE: step 3 accepts a match ONLY when exactly one unit passes.
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
    // The work order's account, kept when the work order names no unit (see step 1).
    let woFleetOnly: string | null = null

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
      // A work order ON A UNIT is authoritative. One with only an account (now the usual
      // case: a typed customer becomes a fleet account) keeps that account and falls
      // through, so the unit is still looked for - it used to stop here with no unit.
      if (woUnit) return { unit_id: woUnit, fleet_account_id: woFleet }
      woFleetOnly = woFleet
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
    //    Serial AND model, one unit only (lib/hd/unit-match). A wrong link would put this
    //    invoice and its cost on another unit's Fleet Pro history; a refused one says so.
    if (serial) {
      const found = await findUnitBySerialAndModel(svc, { userId }, serial, str(input.unit_model))
      if (found.unit) {
        return {
          unit_id:          found.unit.id,
          fleet_account_id: found.unit.fleet_account_id ?? woFleetOnly,
        }
      }
      if (found.notice) {
        console.warn(`[fleet-pro invoice-link] serial "${serial}" found a unit but the link was refused (${found.reason}) — leaving invoice unlinked`)
        return { ...NO_LINKS, fleet_account_id: woFleetOnly, notice: found.notice }
      }
    }

    if (woFleetOnly) return { unit_id: null, fleet_account_id: woFleetOnly }

    return NO_LINKS
  } catch (err) {
    console.error('[fleet-pro invoice-link] failed', err)
    return NO_LINKS
  }
}
