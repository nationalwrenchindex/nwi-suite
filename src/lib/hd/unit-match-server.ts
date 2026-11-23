// Server side of the serial + model rule (src/lib/hd/unit-match.ts): load the units in
// scope, then apply the SAME pure comparison the calendar applies in the browser.
//
// Every unit in scope that carries a serial is read (paged past PostgREST's 1,000-row
// cap), not an ilike lookup: ilike does not trim, so a stored serial with a stray space
// would be missed on the server and found in the browser, and the two paths must give one
// answer.
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
import { matchUnitBySerialAndModel, type SerialModelMatch } from '@/lib/hd/unit-match'

export interface MatchableUnit {
  id: string
  serial_number: string | null
  model: string | null
  unit_number: string | null
  fleet_account_id: string | null
}

/** The shop's (or one fleet's) unit for a typed serial + model, by the one rule. Never throws. */
export async function findUnitBySerialAndModel(
  client: SupabaseClient,
  scope: { userId: string } | { fleetAccountId: string },
  serial: string | null | undefined,
  model: string | null | undefined,
): Promise<SerialModelMatch<MatchableUnit>> {
  if (!String(serial ?? '').trim()) return { unit: null, reason: 'no_serial', notice: null }
  try {
    const units = await fetchAllRows<MatchableUnit>((from, to) => {
      let q = client.from('hd_units').select('id, serial_number, model, unit_number, fleet_account_id').not('serial_number', 'is', null)
      q = 'userId' in scope ? q.eq('user_id', scope.userId) : q.eq('fleet_account_id', scope.fleetAccountId)
      return q.order('id').range(from, to)
    })
    return matchUnitBySerialAndModel(units, serial, model)
  } catch (e) {
    // A failed read links nothing. Saying nothing is right here: no unit was found to
    // disagree with, and the document still saves.
    console.error('[unit-match] unit read failed - linking nothing:', e)
    return { unit: null, reason: 'no_match', notice: null }
  }
}
