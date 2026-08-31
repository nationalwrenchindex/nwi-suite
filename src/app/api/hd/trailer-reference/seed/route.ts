import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { AIR_BRAKE_ROWS }      from '@/lib/hd/trailer/air-brakes'
import { SLACK_ADJUSTER_ROWS } from '@/lib/hd/trailer/slack-adjusters'
import { ABS_ROWS }            from '@/lib/hd/trailer/abs-codes'
import { WIRING_TORQUE_ROWS }  from '@/lib/hd/trailer/wiring-torque'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

// The catalog is assembled here rather than in a fifth data module so that adding a
// system later means adding one import and one array element, and touching no existing
// data file. Order matters only for readability — the UI sorts by system.
const TRAILER_REFERENCE_SEED = [
  ...AIR_BRAKE_ROWS,
  ...SLACK_ADJUSTER_ROWS,
  ...ABS_ROWS,
  ...WIRING_TORQUE_ROWS,
]

export async function POST(_req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const supabase = createServiceClient()

  // Probe before deleting. A missing table or a blocked policy surfaces here as a clean
  // 500 instead of as a delete that silently removes the catalog and an insert that then
  // fails, which would leave the table empty.
  const { count, error: countError } = await supabase
    .from('hd_trailer_reference')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json({
      error:   'Database connection failed — table may not exist or RLS is blocking access.',
      details: countError,
    }, { status: 500 })
  }

  console.log(`[trailer-reference-seed] connection OK — existing row count: ${count}`)

  // Full replace. These rows have no user data and no foreign keys pointing at them, so
  // the seed is the single source of truth and a wipe-and-reinsert keeps the table
  // exactly matching the modules rather than accumulating rows renamed across edits.
  const { error: deleteError } = await supabase
    .from('hd_trailer_reference')
    .delete()
    .not('id', 'is', null)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message, details: deleteError }, { status: 500 })
  }

  const { error: insertError } = await supabase
    .from('hd_trailer_reference')
    .insert(TRAILER_REFERENCE_SEED)

  if (insertError) {
    return NextResponse.json({ error: insertError.message, details: insertError }, { status: 500 })
  }

  console.log(`[trailer-reference-seed] complete — ${TRAILER_REFERENCE_SEED.length} rows seeded`)

  return NextResponse.json({
    success: true,
    count:   TRAILER_REFERENCE_SEED.length,
    counts: {
      airBrakes:      AIR_BRAKE_ROWS.length,
      slackAdjusters: SLACK_ADJUSTER_ROWS.length,
      abs:            ABS_ROWS.length,
      wiringTorque:   WIRING_TORQUE_ROWS.length,
    },
    previousCount: count,
    message: `${TRAILER_REFERENCE_SEED.length} trailer reference entries seeded successfully.`,
  })
}
