import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Compliance lines on an HD document the SUBSCRIBER'S customer keeps.
 *
 * The HD invoice footer printed "EPA Section 608 certified refrigeration work - All
 * work performed by certified technicians" on every invoice, and the PDF and the pay
 * page printed "Refrigeration work performed by an EPA Section 608 certified
 * technician" whenever no cert number was set. Both are claims about the subscriber
 * that the software cannot know (Brock, Nov 11). EPA 608 is a legal certification for
 * refrigerant handling, so a false one on an invoice is not a wording problem.
 *
 * NOTHING IS CLAIMED BY DEFAULT. A line prints only from what the subscriber typed in
 * HD Settings, exactly as typed:
 *   - EPA 608 certification number (profiles.hd_epa_cert_number, migration 048)
 *   - Technician certification note (profiles.hd_tech_cert_note, migration 185)
 * Blank prints nothing - no placeholder, no partial sentence, no separator.
 *
 * The EPA number still prints only on an invoice that is refrigeration work
 * (documentDisclaimers().epa608): a real cert number on an aerial lift inspection
 * still reads as a statement about that job. The technician note is the shop's own
 * words about its people and prints on every HD invoice when filled.
 */

export const TECH_CERT_NOTE_MAX = 300

export interface ComplianceInput {
  /** documentDisclaimers(inv).epa608 - the invoice is refrigeration work. */
  refrigerationWork: boolean
  epaCertNumber:     string | null | undefined
  techCertNote:      string | null | undefined
}

/** The lines to print, in order. Empty means print none. */
export function complianceLines(input: ComplianceInput): string[] {
  const epa  = String(input.epaCertNumber ?? '').replace(/\s+/g, ' ').trim()
  const note = String(input.techCertNote ?? '').replace(/\s+/g, ' ').trim()
  const out: string[] = []
  if (epa && input.refrigerationWork) out.push(`EPA Section 608 certification: ${epa}`)
  if (note) out.push(note)
  return out
}

/** The neutral attribution the HD invoice screen keeps. No claim in it. */
export const HD_SUITE_FOOTER = 'National Wrench Index HD Suite'

/**
 * profiles.hd_tech_cert_note, read on its own (migration 185). Migrations are applied
 * by hand while code deploys independently, and selecting a missing column fails the
 * whole query - so this never rides along in a select that carries anything else.
 * `available` is false when the column does not exist yet.
 */
export async function readTechCertNote(
  client: SupabaseClient,
  userId: string,
): Promise<{ note: string | null; available: boolean }> {
  const { data, error } = await client
    .from('profiles')
    .select('hd_tech_cert_note')
    .eq('id', userId)
    .maybeSingle()
  if (error) return { note: null, available: false }
  const v = (data as { hd_tech_cert_note?: string | null } | null)?.hd_tech_cert_note
  return { note: typeof v === 'string' && v.trim() ? v.trim() : null, available: true }
}
