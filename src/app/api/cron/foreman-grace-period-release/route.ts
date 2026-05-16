import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { releaseVapiPhoneNumber } from '@/lib/foreman/vapi-api'

// Vercel Cron: runs daily at 2 AM UTC.
// Releases Twilio + Vapi numbers for subscribers who cancelled 30+ days ago.
export async function GET() {
  const svc = createServiceClient()

  const { data: rows, error } = await svc
    .from('foreman_grace_period')
    .select('*')
    .eq('released', false)
    .lte('release_scheduled_for', new Date().toISOString())

  if (error) {
    console.error('[foreman-grace-period] query error:', error)
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ released: 0 })
  }

  const twilioSid   = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const basicAuth   = twilioSid && twilioToken
    ? Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')
    : null

  let released = 0

  for (const row of rows) {
    console.log('[foreman-grace-period] releasing row', row.id, 'number', row.phone_number)
    try {
      // Release Twilio number
      if (basicAuth && twilioSid && row.phone_number) {
        const listRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(row.phone_number)}`,
          { headers: { Authorization: `Basic ${basicAuth}` } },
        )
        if (listRes.ok) {
          const listData = await listRes.json() as { incoming_phone_numbers?: { sid: string }[] }
          const twilioNumSid = listData.incoming_phone_numbers?.[0]?.sid
          if (twilioNumSid) {
            const delRes = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers/${twilioNumSid}.json`,
              { method: 'DELETE', headers: { Authorization: `Basic ${basicAuth}` } },
            )
            console.log('[foreman-grace-period] Twilio delete status:', delRes.status)
          }
        }
      }

      // Release Vapi phone number
      if (row.vapi_phone_number_id) {
        await releaseVapiPhoneNumber(row.vapi_phone_number_id)
      }

      await svc.from('foreman_grace_period').update({ released: true }).eq('id', row.id)
      released++
    } catch (err) {
      console.error('[foreman-grace-period] failed to release row', row.id, ':', err)
    }
  }

  return NextResponse.json({ released })
}
