// GET /api/parts/types   the part types actually present in the catalog
//
// Derived from the data rather than hardcoded. A hardcoded list goes stale the moment
// a new type is loaded, and then the filter silently hides parts that exist.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.from('parts').select('part_type')
  if (error) {
    console.error('[parts/types]', error)
    return NextResponse.json({ types: [] }, { status: 200 })
  }

  // "Filter - fuel", "Filter - air" and "Filter - oil (engine)" are distinct types and
  // all three are offered. The search matches a type as a SUBSTRING, so choosing
  // "Filter - fuel" is precise while typing "filter" in the text box still finds all of
  // them - which is the behaviour a parts counter actually wants.
  const types = [...new Set((data ?? []).map(r => String(r.part_type)).filter(Boolean))].sort()
  return NextResponse.json({ types })
}
