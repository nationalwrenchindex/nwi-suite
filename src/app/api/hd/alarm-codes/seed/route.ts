import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { seedAlarmCodes, ALARM_CODE_SEED } from '@/lib/hd/alarm-code-seed'

const FOUNDER_ID = '4a8c046f-7db3-42bb-8422-fd47efb7678c'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user)            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user.id !== FOUNDER_ID) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    await seedAlarmCodes()
    return NextResponse.json({
      success: true,
      count:   ALARM_CODE_SEED.length,
      message: `${ALARM_CODE_SEED.length} alarm codes seeded successfully.`,
    })
  } catch (e) {
    const msg = e instanceof Error
      ? e.message
      : (typeof e === 'object' && e !== null && 'message' in e)
        ? String((e as { message: unknown }).message)
        : 'Seed failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
