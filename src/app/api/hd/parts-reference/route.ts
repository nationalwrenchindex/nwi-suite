import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'

// Columns the QuickWrench Parts Ref panel actually renders. Listed explicitly
// rather than select('*') because the table now holds ~960 rows: dropping the
// internal-only `verified` / `created_at` columns trims the single payload the
// panel downloads, and pins the response shape to what PartsRefEntry declares.
const PART_COLUMNS = [
  'id', 'manufacturer', 'unit_family', 'part_category', 'part_function',
  'oem_part_number', 'baldwin', 'napa_gold', 'luber_finer', 'donaldson',
  'fleetguard', 'wix', 'dayco', 'continental', 'gates', 'notes',
].join(',')

// The whole table is returned in one shot and searched client-side. At ~960 rows
// that is a few hundred KB once, after which every keystroke filters instantly with
// no round trip — which matters on shop wi-fi and in a truck. It also keeps the
// forgiving model matching (normalising "s600" → "S-600", splitting the
// comma-separated unit_family fits-list, treating ALL-TK/ALL-Carrier as universal)
// in plain TypeScript, instead of encoding it into a PostgREST `or=` filter string
// that would have to embed user input. No user text reaches the query at all.
export async function GET() {
  const supabase = await createClient()

  // Same gate as the rest of the HD API surface: signed-in HD subscriber. The /hd
  // layout already redirects everyone else, so this adds no friction for the
  // mechanic — it just stops the reference library being readable by anyone.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_parts_reference')
    .select(PART_COLUMNS)
    .order('manufacturer')
    .order('part_category')
    .order('part_function')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ parts: data ?? [] })
}
