import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { PARTS_REFERENCE_SEED } from '@/lib/hd/parts-reference-seed'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export async function POST(_req: NextRequest) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  if (!user)                  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' },    { status: 403 })

  const supabase = createServiceClient()

  const { count, error: countError } = await supabase
    .from('hd_parts_reference')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    return NextResponse.json({
      error:   'Database connection failed — table may not exist or RLS is blocking access.',
      details: countError,
    }, { status: 500 })
  }

  console.log(`[parts-reference-seed] connection OK — existing row count: ${count}`)

  const { error: deleteError } = await supabase
    .from('hd_parts_reference')
    .delete()
    .not('id', 'is', null)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message, details: deleteError }, { status: 500 })
  }

  const { error: insertError } = await supabase
    .from('hd_parts_reference')
    .insert(PARTS_REFERENCE_SEED)

  if (insertError) {
    return NextResponse.json({ error: insertError.message, details: insertError }, { status: 500 })
  }

  console.log(`[parts-reference-seed] complete — ${PARTS_REFERENCE_SEED.length} parts seeded`)

  return NextResponse.json({
    success: true,
    count:   PARTS_REFERENCE_SEED.length,
    message: `${PARTS_REFERENCE_SEED.length} parts reference entries seeded successfully.`,
  })
}
