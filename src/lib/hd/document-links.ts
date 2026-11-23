// SERVER-ONLY. When an HD quote, work order or invoice is saved, the customer typed on it
// becomes a fleet account in Intel Hub and the unit typed on it becomes a unit on that
// account - found first, created only when nothing matches (Brock, Nov 23, 2026).
//
// WHY: a full production chain (Q-2026-0276 -> WO-2026-1584 -> INV-2026-0183, customer
// "test xyz", unit "test 002" Thermo King s-600) created neither. Only the text was
// stored; Intel Hub got nothing and the unit's history stays empty.
//
// THE CUSTOMER (fleet account)
//   * The document's own fleet_account_id wins, after an ownership check.
//   * Otherwise the typed business name (company_name, else customer_name) is matched on
//     THIS shop's accounts: trimmed, case-insensitive, internal spaces collapsed. One
//     match links it. Two or more link nothing and say so - never a guess.
//   * No match: the account is created, with the contact the document carries - the same
//     columns the "+ Fleet Account" form on /hd/fleet-accounts writes.
//
// THE UNIT (only on that fleet account, never with none)
//   * The document's own unit_id wins.
//   * Otherwise the account's units are matched on the normalized unit number, or on the
//     serial. A SERIAL-ONLY hit must also agree on model (matchUnitBySerialAndModel,
//     3f64cca1, unchanged): a serial alone never links. One unit links. Two or more, or
//     a serial whose unit's model disagrees, link nothing and say so.
//   * No match: the unit is created only with a unit number AND a manufacturer AND a
//     model, as typed. Never from blanks, and never "Unknown" to fill a gap.
//     hd_units.unit_number is NOT NULL, so a document carrying only a serial creates
//     nothing (that would need a number nobody typed).
//
// IDEMPOTENT BY MATCHING FIRST: a re-save, an edit or a second invoice from the same work
// order finds the account and the unit the first save made, and creates nothing new. The
// serial is also unique per shop (migration 161), which backstops a double create.
//
// Never throws: a document always saves. A link that cannot be made comes back as a
// notice for the user.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { matchUnitBySerialAndModel, normSerial, UNIT_SERIAL_MISMATCH_NOTICE } from '@/lib/hd/unit-match'
import { documentUnitView, namesUnlinkedUnit, type DocumentUnitFields } from '@/lib/hd/document-unit'

export interface DocumentLinkInput extends DocumentUnitFields {
  fleet_account_id?: string | null
  unit_id?: string | null
  customer_name?: string | null
  company_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

export interface DocumentLinks {
  fleet_account_id: string | null
  unit_id: string | null
  /** What this save created, for the caller's log and for tests. */
  created: { fleet_account_id?: string; unit_id?: string }
  /** Said to the user: a link that could not be made, and why. */
  notices: string[]
}

export const FLEET_NAME_AMBIGUOUS_NOTICE = (name: string) =>
  `More than one of your customers is named "${name}". Pick the customer yourself.`
export const UNIT_AMBIGUOUS_NOTICE =
  "More than one of this customer's units matches this unit number or serial. Pick the unit yourself."
export const UNIT_NOT_ENOUGH_NOTICE =
  "Not saved to this customer's units: a unit needs a unit number, a manufacturer and a model."
export const UNIT_SERIAL_TAKEN_NOTICE =
  'A unit with this serial is already saved under another customer. Pick the unit yourself.'

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
/** Business names compared trimmed, case-insensitive, internal spaces collapsed. */
export const normName = (v: unknown): string => s(v).toLowerCase().replace(/\s+/g, ' ')
const isSerialUniqueViolation = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === '23505' || /duplicate key/i.test(e.message ?? '')) && /serial/i.test(e.message ?? '')

interface FleetRow { id: string; fleet_name: string | null }
interface UnitRow { id: string; unit_number: string | null; serial_number: string | null; model: string | null; fleet_account_id: string | null }

function addressLine(d: DocumentLinkInput): string | null {
  const cityState = [s(d.city), [s(d.state), s(d.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [s(d.address_line1), s(d.address_line2), cityState].filter(Boolean).join(', ') || null
}

/** Find or create the document's fleet account. */
async function resolveFleet(supabase: SupabaseClient, userId: string, d: DocumentLinkInput, out: DocumentLinks): Promise<string | null> {
  const given = s(d.fleet_account_id)
  if (given) {
    const { data } = await supabase.from('hd_fleet_accounts').select('id').eq('id', given).eq('user_id', userId).maybeSingle()
    if (data?.id) return String(data.id)
  }
  const name = s(d.company_name) || s(d.customer_name)
  if (!name) return null
  const accounts = await fetchAllRows<FleetRow>((from, to) =>
    supabase.from('hd_fleet_accounts').select('id, fleet_name').eq('user_id', userId).order('id').range(from, to))
  const same = accounts.filter(a => normName(a.fleet_name) === normName(name))
  if (same.length === 1) return same[0].id
  if (same.length > 1) { out.notices.push(FLEET_NAME_AMBIGUOUS_NOTICE(name)); return null }
  const person = s(d.customer_name)
  const { data, error } = await supabase.from('hd_fleet_accounts').insert({
    user_id:       userId,
    fleet_name:    name,
    contact_name:  person && normName(person) !== normName(name) ? person : null,
    contact_phone: s(d.customer_phone) || null,
    contact_email: s(d.customer_email) || null,
    address:       addressLine(d),
  }).select('id').single()
  if (error || !data) { console.error('[document-links] fleet account not created:', error?.message); return null }
  out.created.fleet_account_id = String(data.id)
  return String(data.id)
}

/** Find, link or create the document's unit on that fleet account. */
async function resolveUnit(supabase: SupabaseClient, userId: string, fleetId: string, d: DocumentLinkInput, out: DocumentLinks): Promise<string | null> {
  const view = documentUnitView(d, null)
  const units = await fetchAllRows<UnitRow>((from, to) =>
    supabase.from('hd_units').select('id, unit_number, serial_number, model, fleet_account_id')
      .eq('user_id', userId).eq('fleet_account_id', fleetId).order('id').range(from, to))

  // By unit number on this customer: the fleet's own number for the machine.
  const byNumber = view.number ? units.filter(u => normName(u.unit_number) === normName(view.number)) : []
  // By serial on this customer - only with the model agreeing (3f64cca1's rule, unchanged).
  const bySerialRaw = view.serial ? units.filter(u => normSerial(u.serial_number) === normSerial(view.serial)) : []
  const serialRule = view.serial ? matchUnitBySerialAndModel(units, view.serial, view.model) : null
  const bySerial = serialRule?.unit ? [serialRule.unit] : []

  const hits = new Map<string, UnitRow>()
  for (const u of [...byNumber, ...bySerial]) hits.set(u.id, u)
  if (hits.size === 1) return [...hits.keys()][0]
  if (hits.size > 1) { out.notices.push(UNIT_AMBIGUOUS_NOTICE); return null }
  // The serial is this customer's unit, but its model disagrees (or several pass): refused.
  if (bySerialRaw.length > 0) { out.notices.push(serialRule?.notice ?? UNIT_SERIAL_MISMATCH_NOTICE); return null }

  // Nothing matches: create it, only from what was typed.
  if (!view.number || !view.manufacturer || !view.model) {
    if (view.number || view.serial) out.notices.push(UNIT_NOT_ENOUGH_NOTICE)
    return null
  }
  const year = view.year && /^\d{4}$/.test(view.year) ? Number(view.year) : null
  // The columns "+ Unit" on /hd/fleet-units writes, from the typed values only: no
  // "Unknown" model, no assumed refrigerant, no category (Uncategorized, as the importers
  // leave a unit whose type they cannot read). status 'active' as "+ Unit" sets it.
  const { data, error } = await supabase.from('hd_units').insert({
    user_id:          userId,
    fleet_account_id: fleetId,
    unit_number:      view.number,
    manufacturer:     view.manufacturer,
    model:            view.model,
    year,
    serial_number:    view.serial,
    status:           'active',
  }).select('id').single()
  if (error || !data) {
    if (isSerialUniqueViolation(error)) { out.notices.push(UNIT_SERIAL_TAKEN_NOTICE); return null }
    console.error('[document-links] unit not created:', error?.message)
    return null
  }
  out.created.unit_id = String(data.id)
  return String(data.id)
}

/**
 * The fleet account and unit a document being saved belongs to - found, or created.
 * `skipUnit`: the caller already refused a unit link with a notice of its own (the
 * invoice's serial + model check) - then no unit is linked or created here either.
 */
export async function linkDocumentFleetAndUnit(
  supabase: SupabaseClient,
  userId: string,
  d: DocumentLinkInput,
  opts: { skipUnit?: boolean } = {},
): Promise<DocumentLinks> {
  const out: DocumentLinks = { fleet_account_id: null, unit_id: s(d.unit_id) || null, created: {}, notices: [] }
  try {
    // A document already on a unit belongs to that unit's customer: the account comes
    // from the unit, never from a name match that could point somewhere else.
    if (out.unit_id && !s(d.fleet_account_id)) {
      const { data: u } = await supabase.from('hd_units').select('fleet_account_id').eq('id', out.unit_id).eq('user_id', userId).maybeSingle()
      if (u?.fleet_account_id) { out.fleet_account_id = String(u.fleet_account_id); return out }
    }
    out.fleet_account_id = await resolveFleet(supabase, userId, d, out)
    if (!out.unit_id && !opts.skipUnit && out.fleet_account_id && namesUnlinkedUnit(d)) {
      out.unit_id = await resolveUnit(supabase, userId, out.fleet_account_id, d, out)
    }
  } catch (e) {
    console.error('[document-links] failed - the document saves without the link:', e)
  }
  return out
}
