import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ALARM_CODE_SEED } from '@/lib/hd/alarm-code-seed'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user)                   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID)  return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

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

  // ── Step 2: delete existing rows ────────────────────────────────────────────
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

  console.log('[seed] existing rows deleted')

  // ── Step 3: insert seed data ─────────────────────────────────────────────────
  const { error: insertError } = await supabase
    .from('hd_alarm_codes')
    .insert(ALARM_CODE_SEED)

  if (insertError) {
    console.error('[seed] insert failed:', JSON.stringify(insertError))
    return NextResponse.json({
      error:   insertError.message,
      details: insertError,
      step:    'insert',
    }, { status: 500 })
  }

  console.log(`[seed] inserted ${ALARM_CODE_SEED.length} alarm codes`)

  return NextResponse.json({
    success: true,
    count:   ALARM_CODE_SEED.length,
    message: `${ALARM_CODE_SEED.length} alarm codes seeded successfully.`,
  })
}
