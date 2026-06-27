import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

// Unit profile lookup + upsert for the reefer QuickWrench tab.
//
// Two trust models, mirrored from migration 063:
//   hd_unit_profiles — PRIVATE per-user data. Read/written through the
//                      authenticated client so RLS (auth.uid() = user_id)
//                      enforces strict per-user isolation.
//   hd_bm_map        — GLOBAL shared knowledge. Read by any authenticated user;
//                      written ONLY server-side via the service-role client
//                      (there is no user write policy on the table).
//
// The "build key" is the BM number for Thermo King and the model number for
// Carrier — both identify a unit model and are the key into hd_bm_map.

type Manufacturer = 'TK' | 'Carrier'

function normManuf(v: unknown): Manufacturer | null {
  return v === 'TK' || v === 'Carrier' ? v : null
}

const asStr = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

const asNum = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v)
  return null
}

// ── GET: the user's own profile + the global BM-map entry ─────────────────────
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params       = req.nextUrl.searchParams
  const manufacturer = normManuf(params.get('manufacturer'))
  if (!manufacturer) {
    return NextResponse.json({ error: 'manufacturer must be TK or Carrier' }, { status: 400 })
  }

  const bmNumber     = params.get('bm_number')?.trim()     || null  // build key (TK BM, Carrier model #)
  const serialNumber = params.get('serial_number')?.trim() || null
  if (!bmNumber && !serialNumber) {
    return NextResponse.json({ error: 'bm_number or serial_number required' }, { status: 400 })
  }

  // 1. The user's OWN profile (RLS scopes this to auth.uid()). Serial is the
  //    most reliable key; otherwise match the build number in whichever column
  //    holds it for this manufacturer.
  let profileQuery = supabase
    .from('hd_unit_profiles')
    .select('*')
    .eq('manufacturer', manufacturer)
  if (serialNumber) {
    profileQuery = profileQuery.eq('serial_number', serialNumber)
  } else if (bmNumber) {
    profileQuery = profileQuery.eq(manufacturer === 'TK' ? 'bm_number' : 'model_number', bmNumber)
  }
  const { data: profileRows } = await profileQuery.limit(1)
  const profile = profileRows?.[0] ?? null

  // 2. The GLOBAL BM map (read policy = any authenticated user). Keyed by the
  //    build number only — never by serial (serial is private customer data).
  let bmMap: { unit_model: string | null; refrigerant_type: string | null; known_parts: string | null } | null = null
  if (bmNumber) {
    const { data } = await supabase
      .from('hd_bm_map')
      .select('unit_model, refrigerant_type, known_parts')
      .eq('manufacturer', manufacturer)
      .eq('bm_number', bmNumber)
      .maybeSingle()
    bmMap = data ?? null
  }

  return NextResponse.json({ profile, bmMap })
}

// ── POST: upsert the user's profile; contribute to the global BM map ──────────
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const manufacturer = normManuf(body.manufacturer)
  if (!manufacturer) {
    return NextResponse.json({ error: 'manufacturer must be TK or Carrier' }, { status: 400 })
  }

  const serialNumber = asStr(body.serial_number)
  const bmNumber     = asStr(body.bm_number)       // TK build number
  const modelNumber  = asStr(body.model_number)    // Carrier build number
  const unitModel    = asStr(body.unit_model)
  const refrigerant  = asStr(body.refrigerant_type)
  const engineHours  = asNum(body.engine_hours)
  const notes        = asStr(body.notes)

  const buildKey = manufacturer === 'TK' ? bmNumber : modelNumber

  // Never persist an empty profile — require a serial or a build number.
  if (!serialNumber && !buildKey) {
    return NextResponse.json({ error: 'serial_number or build number required' }, { status: 400 })
  }

  // Find the user's existing row (RLS keeps this scoped to them). Serial is the
  // primary key for a profile; otherwise match on the build number column.
  let findQuery = supabase
    .from('hd_unit_profiles')
    .select('id')
    .eq('manufacturer', manufacturer)
  if (serialNumber) {
    findQuery = findQuery.eq('serial_number', serialNumber)
  } else if (buildKey) {
    findQuery = findQuery.eq(manufacturer === 'TK' ? 'bm_number' : 'model_number', buildKey)
  }
  const { data: existingRows } = await findQuery.limit(1)
  const existing = existingRows?.[0] ?? null

  const row = {
    user_id:          user.id,
    manufacturer,
    serial_number:    serialNumber,
    bm_number:        bmNumber,
    model_number:     modelNumber,
    unit_model:       unitModel,
    refrigerant_type: refrigerant,
    engine_hours:     engineHours,
    notes,
    updated_at:       new Date().toISOString(),
  }

  let savedId: string
  if (existing) {
    const { data, error } = await supabase
      .from('hd_unit_profiles')
      .update(row)
      .eq('id', existing.id)
      .select('id')
      .single()
    if (error) {
      console.error('[hd/unit-profile] update', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    savedId = data.id
  } else {
    const { data, error } = await supabase
      .from('hd_unit_profiles')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      console.error('[hd/unit-profile] insert', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
    savedId = data.id
  }

  // Contribute to the GLOBAL BM map via the service-role client (no user write
  // policy exists). Only insert when the BM is new; only fill unit_model when
  // empty — never overwrite an existing crowd-sourced entry.
  if (buildKey && unitModel) {
    const svc = createServiceClient()
    const { data: bmExisting } = await svc
      .from('hd_bm_map')
      .select('id, unit_model')
      .eq('manufacturer', manufacturer)
      .eq('bm_number', buildKey)
      .maybeSingle()

    if (!bmExisting) {
      await svc.from('hd_bm_map').insert({
        manufacturer,
        bm_number:        buildKey,
        unit_model:       unitModel,
        refrigerant_type: refrigerant,
        first_seen_by:    user.id,
      })
    } else if (!bmExisting.unit_model) {
      await svc
        .from('hd_bm_map')
        .update({ unit_model: unitModel, updated_at: new Date().toISOString() })
        .eq('id', bmExisting.id)
    }
  }

  return NextResponse.json({ ok: true, id: savedId })
}
