// Shared Foreman number provisioning logic — callable from API routes and Stripe webhook.
// Uses service client (bypasses RLS) so it works in webhook context.

import { createServiceClient } from '@/lib/supabase/service'

const VAPI_SERVER_URL = 'https://tools.nationalwrenchindex.com/api/webhooks/vapi'

export interface ProvisionResult {
  ok:                  boolean
  phone_number?:       string
  vapi_phone_number_id?: string | null
  already_provisioned?: boolean
  error?:              string
}

export async function provisionForemanNumber(userId: string): Promise<ProvisionResult> {
  const svc = createServiceClient()

  // Check if already provisioned
  const { data: existing } = await svc
    .from('foreman_settings')
    .select('phone_number, mechanic_phone')
    .eq('user_id', userId)
    .single()

  if (existing?.phone_number) {
    return { ok: true, phone_number: existing.phone_number, already_provisioned: true }
  }

  const twilioSid   = process.env.TWILIO_ACCOUNT_SID
  const twilioToken = process.env.TWILIO_AUTH_TOKEN
  const vapiKey     = process.env.VAPI_API_KEY

  if (!twilioSid || !twilioToken) {
    console.error('[provision] Twilio credentials missing')
    return { ok: false, error: 'Phone provisioning unavailable — Twilio not configured.' }
  }
  if (!vapiKey) {
    console.error('[provision] Vapi credentials missing')
    return { ok: false, error: 'Phone provisioning unavailable — Vapi not configured.' }
  }

  const basicAuth = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')

  // Determine area code from mechanic_phone, default 336 (NC)
  const mechDigits = (existing?.mechanic_phone ?? '').replace(/\D/g, '')
  let areaCode = '336'
  if (mechDigits.length === 11 && mechDigits.startsWith('1')) areaCode = mechDigits.slice(1, 4)
  else if (mechDigits.length === 10) areaCode = mechDigits.slice(0, 3)

  // Step 1: Search for available Twilio numbers
  console.log('[provision] searching for numbers, area code', areaCode, 'user', userId)
  let availableNumbers: { phone_number: string }[] = []

  const searchRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=${areaCode}&Limit=5`,
    { headers: { Authorization: `Basic ${basicAuth}` } },
  )
  if (searchRes.ok) {
    const d = await searchRes.json() as { available_phone_numbers?: { phone_number: string }[] }
    availableNumbers = d.available_phone_numbers ?? []
  }

  // Fallback to 336 if target area has no results
  if (availableNumbers.length === 0 && areaCode !== '336') {
    console.log('[provision] no numbers in', areaCode, '— falling back to 336')
    const fb = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/AvailablePhoneNumbers/US/Local.json?AreaCode=336&Limit=5`,
      { headers: { Authorization: `Basic ${basicAuth}` } },
    )
    if (fb.ok) {
      const d = await fb.json() as { available_phone_numbers?: { phone_number: string }[] }
      availableNumbers = d.available_phone_numbers ?? []
    }
  }

  if (availableNumbers.length === 0) {
    return { ok: false, error: 'No phone numbers available right now. Please try again shortly.' }
  }

  const chosenNumber = availableNumbers[0].phone_number

  // Step 2: Purchase the number
  console.log('[provision] purchasing', chosenNumber)
  const buyRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`,
    {
      method: 'POST',
      headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ PhoneNumber: chosenNumber }).toString(),
    },
  )

  if (!buyRes.ok) {
    const err = await buyRes.json() as { message?: string }
    console.error('[provision] Twilio purchase failed:', err.message)
    return { ok: false, error: `Could not purchase number: ${err.message ?? 'Twilio error'}` }
  }

  const buyData = await buyRes.json() as { phone_number: string }
  const purchasedNumber = buyData.phone_number
  console.log('[provision] purchased', purchasedNumber)

  // Step 3: Register with Vapi
  console.log('[provision] registering with Vapi')
  let vapiPhoneNumberId: string | null = null

  // No assistantId — phone numbers use server URL only so Vapi sends
  // assistant-request to our webhook on every inbound call, enabling
  // per-subscriber dynamic assistant config (multi-tenancy).
  const vapiRes = await fetch('https://api.vapi.ai/phone-number', {
    method: 'POST',
    headers: { Authorization: `Bearer ${vapiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider:         'twilio',
      number:           purchasedNumber,
      twilioAccountSid: twilioSid,
      twilioAuthToken:  twilioToken,
      serverUrl:        VAPI_SERVER_URL,
    }),
  })

  if (vapiRes.ok) {
    const d = await vapiRes.json() as { id?: string }
    vapiPhoneNumberId = d.id ?? null
    console.log('[provision] Vapi phone number id:', vapiPhoneNumberId)
  } else {
    const e = await vapiRes.json() as { message?: string }
    console.error('[provision] Vapi registration failed:', e.message, '— number still saved, will need manual Vapi config')
  }

  // Step 4: Save to foreman_settings
  await svc.from('foreman_settings').upsert({
    user_id:              userId,
    phone_number:         purchasedNumber,
    vapi_phone_number_id: vapiPhoneNumberId,
    updated_at:           new Date().toISOString(),
  }, { onConflict: 'user_id' })

  return { ok: true, phone_number: purchasedNumber, vapi_phone_number_id: vapiPhoneNumberId }
}
