import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { lookupDTC, getCategoryDescription } from '@/data/dtc-codes'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await params
  const normalized = code.trim().toUpperCase()

  if (!/^[PBCU][0-9]{4}$/.test(normalized)) {
    return NextResponse.json({ error: 'Invalid DTC format. Expected e.g. P0420' }, { status: 400 })
  }

  const entry = lookupDTC(normalized)

  if (entry) {
    return NextResponse.json({ result: entry, source: 'database' })
  }

  // Not in built-in DB — return generic info derived from code structure
  const system = getCategoryDescription(normalized)
  return NextResponse.json({
    result: {
      code:        normalized,
      description: `${normalized} — Manufacturer or extended code (not in common database)`,
      system,
      causes:      ['Refer to vehicle-specific service manual for this code'],
      repair:      'This code is not in the common OBD-II database. Consult the factory service manual or ALLDATA for this specific code and vehicle.',
    },
    source: 'generic',
  })
}
