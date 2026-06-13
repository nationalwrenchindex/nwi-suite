import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { ALARM_CODE_SEED } from '@/lib/hd/alarm-code-seed'

const FOUNDER_ID  = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const BATCH_SIZE  = 10

export async function POST(_req: NextRequest) {
  // Auth check via user-session client
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  // All DB operations use the service-role client to bypass RLS
  const supabase = createServiceClient()

  // ── Step 1: connection test ──────────────────────────────────────────────────
  const { count, error: countError } = await supabase
    .from('hd_alarm_codes')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('[seed] connection test failed:', JSON.stringify(countError))
    return NextResponse.json({
      error:   'Database connection failed — table may not exist or RLS is blocking access.',
      details: countError,
      step:    'connection_test',
    }, { status: 500 })
  }

  console.log(`[seed] connection OK — existing row count: ${count}`)
  console.log('[seed] columns being sent:', Object.keys(ALARM_CODE_SEED[0]))

  // ── Step 2: delete existing rows ─────────────────────────────────────────────
  const { error: deleteError } = await supabase
    .from('hd_alarm_codes')
    .delete()
    .not('id', 'is', null)

  if (deleteError) {
    console.error('[seed] delete failed:', JSON.stringify(deleteError))
    return NextResponse.json({
      error:   deleteError.message,
      details: deleteError,
      step:    'delete',
    }, { status: 500 })
  }

  console.log('[seed] existing rows deleted — beginning probe insert')

  // ── Step 3: probe — insert first row only ────────────────────────────────────
  const { error: probeError } = await supabase
    .from('hd_alarm_codes')
    .insert([ALARM_CODE_SEED[0]])

  if (probeError) {
    console.error('[seed] probe insert failed (row 0):', JSON.stringify(probeError))
    return NextResponse.json({
      error:      probeError.message,
      details:    probeError,
      step:       'probe_insert',
      row_index:  0,
      row_code:   ALARM_CODE_SEED[0].alarm_code,
      row_sample: ALARM_CODE_SEED[0],
    }, { status: 500 })
  }

  console.log('[seed] probe row inserted OK — inserting remaining rows in batches')

  // ── Step 4: insert remaining rows in batches ─────────────────────────────────
  const remaining = ALARM_CODE_SEED.slice(1)
  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch    = remaining.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1
    const rowStart = i + 2            // 1-based, row 1 was the probe
    const rowEnd   = rowStart + batch.length - 1

    const { error: batchError } = await supabase
      .from('hd_alarm_codes')
      .insert(batch)

    if (batchError) {
      console.error(
        `[seed] batch ${batchNum} failed (seed rows ${rowStart}–${rowEnd}):`,
        JSON.stringify(batchError),
      )
      return NextResponse.json({
        error:           batchError.message,
        details:         batchError,
        step:            'batch_insert',
        batch:           batchNum,
        seed_rows:       `${rowStart}–${rowEnd}`,
        first_row_code:  batch[0].alarm_code,
        last_row_code:   batch[batch.length - 1].alarm_code,
      }, { status: 500 })
    }

    console.log(`[seed] batch ${batchNum} OK (rows ${rowStart}–${rowEnd})`)
  }

  const total = ALARM_CODE_SEED.length
  console.log(`[seed] complete — ${total} alarm codes seeded`)

  return NextResponse.json({
    success: true,
    count:   total,
    message: `${total} alarm codes seeded successfully.`,
  })
}
