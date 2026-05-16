// Vapi API helpers used for lifecycle management (release, etc.).
// Phone number provisioning lives in provision.ts.

const VAPI_BASE = 'https://api.vapi.ai'

export async function releaseVapiPhoneNumber(vapiPhoneNumberId: string): Promise<boolean> {
  const key = process.env.VAPI_API_KEY
  if (!key) {
    console.error('[vapi-api] VAPI_API_KEY not set')
    return false
  }
  try {
    const res = await fetch(`${VAPI_BASE}/phone-number/${vapiPhoneNumberId}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${key}` },
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({})) as { message?: string }
      console.error('[vapi-api] release failed:', e.message)
      return false
    }
    console.log('[vapi-api] released phone number id:', vapiPhoneNumberId)
    return true
  } catch (err) {
    console.error('[vapi-api] release error:', err)
    return false
  }
}
