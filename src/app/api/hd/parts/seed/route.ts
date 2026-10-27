import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { seedHDParts } from '@/lib/hd/parts-seed'

// hd_parts is shared by every subscriber, so only the founder may (re)load it -
// the same rule as every other seed route.
const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const result = await seedHDParts()

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ ok: true, parts: result.parts_count, cross_refs: result.xref_count })
}
