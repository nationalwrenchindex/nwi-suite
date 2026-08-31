import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import type { TrailerSystem } from '@/lib/hd/trailer/types'

// Columns the QuickWrench Trailer Systems panel renders. Listed explicitly rather
// than select('*') for the same reason as the parts-reference route: it drops the
// internal-only `created_at` from every payload and pins the response shape to what
// TrailerRefEntry declares on the client.
const TRAILER_COLUMNS = [
  'id', 'system', 'component', 'description', 'value', 'units', 'notes', 'manufacturer',
].join(',')

// The seven values of TrailerSystem, needed at runtime to validate ?system= and to
// tell the client what the filter offers. Migration 124 deliberately puts no CHECK
// constraint on the column, so this list and the seed route are the only thing
// keeping the stored values honest; declaring it TrailerSystem[] means the compiler
// fails here the moment it drifts from the shared contract.
const TRAILER_SYSTEMS: TrailerSystem[] = [
  'Air Brakes',
  'Brake Chambers',
  'Slack Adjusters',
  'Brake Shoes & Drums',
  'ABS',
  'Electrical',
  'Torque Specs',
]

// Postgres error 42P01 = relation does not exist. PGRST205 = PostgREST cannot find
// the table in its schema cache. Both mean migration 124 has not been run yet, which
// is a not-yet-provisioned state rather than a failure — the panel renders its
// "reference not loaded" empty state instead of a red error box. Any OTHER error
// still surfaces as a 500, so real breakage is never swallowed.
const TABLE_MISSING_CODES = new Set(['42P01', 'PGRST205', 'PGRST202'])

// `q` is interpolated into a PostgREST or= filter string, where a comma, paren or dot
// would be read as filter syntax rather than as text. Strip the structural characters
// and the LIKE wildcards so the needle can only ever widen into a plain substring
// match. (The QuickWrench panel does not use this path at all — it downloads the
// table once and filters in TypeScript, exactly like the Parts Ref panel — but the
// route is a public part of the HD API surface and is hardened accordingly.)
function sanitizeNeedle(raw: string): string {
  return raw.replace(/[,()*%_\\"']/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * GET /api/hd/trailer-reference
 *
 * Query params (all optional):
 *   q       free text, matched case-insensitively against system, component AND
 *           description. Omit to return everything.
 *   system  exact TrailerSystem filter ('Air Brakes', 'ABS', 'Torque Specs', …).
 *           An unrecognised value is a 400 rather than a silent empty list.
 *   limit   1-1000. Omit for the whole (small) table, which is what the panel wants.
 *
 * Response: { trailer: TrailerRefEntry[], systems: TrailerSystem[], available: boolean }
 * `available` is false only when the table does not exist yet.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  // Same gate as the rest of the HD API surface: signed-in HD subscriber. Trailer
  // brake specs are base-tier content like the parts library, not Reefer Module
  // content, so this is checkHDAccess and not checkHDReeferAccess.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const q         = sanitizeNeedle(searchParams.get('q')?.trim() ?? '')
  const system    = searchParams.get('system')?.trim() ?? ''
  const limitText = searchParams.get('limit')?.trim() ?? ''

  if (system && !(TRAILER_SYSTEMS as string[]).includes(system)) {
    return NextResponse.json(
      { error: `Unknown system. Expected one of: ${TRAILER_SYSTEMS.join(', ')}` },
      { status: 400 },
    )
  }

  let limit: number | null = null
  if (limitText) {
    const parsed = Number(limitText)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return NextResponse.json({ error: 'limit must be an integer between 1 and 1000' }, { status: 400 })
    }
    limit = parsed
  }

  let query = supabase
    .from('hd_trailer_reference')
    .select(TRAILER_COLUMNS)
    .order('system')
    .order('component')

  if (system) query = query.eq('system', system)

  // One ilike per searchable column, OR'd. `system` is included so "abs" or "torque"
  // finds the whole system even when neither the component nor the description
  // repeats the word.
  if (q) {
    query = query.or(
      [`system.ilike.%${q}%`, `component.ilike.%${q}%`, `description.ilike.%${q}%`].join(','),
    )
  }

  if (limit !== null) query = query.limit(limit)

  const { data, error } = await query

  if (error) {
    if (TABLE_MISSING_CODES.has(error.code)) {
      return NextResponse.json({ trailer: [], systems: TRAILER_SYSTEMS, available: false })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ trailer: data ?? [], systems: TRAILER_SYSTEMS, available: true })
}
