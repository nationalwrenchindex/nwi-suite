import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

// RETIRED Oct 27, 2026. This route deleted every hd_parts_reference row and
// reinserted PARTS_REFERENCE_SEED (48 rows), which would have wiped the ~910 rows
// migrations 107-113 added. Every seed row is already in the table, so there is
// nothing left for it to add, and hd_parts_reference is being folded into the
// migration-148 `parts` store. It now refuses before touching the database.
export async function POST(_req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  return NextResponse.json({
    error: 'Retired: this reseed would delete the rows migrations 107-113 added. hd_parts_reference is being folded into the parts store.',
  }, { status: 410 })
}
