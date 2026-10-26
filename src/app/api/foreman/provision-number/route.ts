import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { canUseForeman } from '@/lib/subscription'
import { provisionForemanNumber } from '@/lib/foreman/provision'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // The Foreman add-on must be active, as on /foreman. A plan tier alone - or a trial -
  // must never be able to buy a Twilio number. See canUseForeman.
  if (!await canUseForeman(user.id)) {
    return NextResponse.json({ error: 'Foreman access required.' }, { status: 403 })
  }

  const result = await provisionForemanNumber(user.id)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 })
  }

  return NextResponse.json({
    phone_number:          result.phone_number,
    vapi_phone_number_id:  result.vapi_phone_number_id,
    already_provisioned:   result.already_provisioned ?? false,
  })
}
