// One-time admin endpoint: remove assistantId from a Vapi phone number so that
// inbound calls trigger assistant-request instead of using the pre-assigned assistant.
// Required for numbers provisioned before the multi-tenancy fix.
// Founder-only access.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const FOUNDER_ID   = '4a8c046f-7db3-42bb-8422-fd47efb7678c'
const VAPI_BASE    = 'https://api.vapi.ai'
const SERVER_URL   = 'https://tools.nationalwrenchindex.com/api/webhooks/vapi'

export async function POST(req: NextRequest) {
  // Auth: founder only
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== FOUNDER_ID) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let vapiPhoneNumberId: string | undefined
  try {
    const body = await req.json() as { vapiPhoneNumberId?: string }
    vapiPhoneNumberId = body.vapiPhoneNumberId
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!vapiPhoneNumberId) {
    return NextResponse.json({ error: 'vapiPhoneNumberId is required' }, { status: 400 })
  }

  const vapiKey = process.env.VAPI_API_KEY
  if (!vapiKey) {
    return NextResponse.json({ error: 'VAPI_API_KEY not configured' }, { status: 503 })
  }

  console.log('[unassign-number] patching Vapi phone number:', vapiPhoneNumberId)

  // PATCH the Vapi phone number: clear assistantId, ensure serverUrl is set
  const patchRes = await fetch(`${VAPI_BASE}/phone-number/${vapiPhoneNumberId}`, {
    method: 'PATCH',
    headers: {
      Authorization:  `Bearer ${vapiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      assistantId: null,
      serverUrl:   SERVER_URL,
    }),
  })

  const patchBody = await patchRes.json() as Record<string, unknown>
  console.log('[unassign-number] Vapi PATCH status:', patchRes.status, '| body:', JSON.stringify(patchBody))

  if (!patchRes.ok) {
    return NextResponse.json({
      error:   'Vapi PATCH failed',
      status:  patchRes.status,
      details: patchBody,
    }, { status: 502 })
  }

  const resultAssistantId = patchBody.assistantId ?? null
  const resultServerUrl   = patchBody.serverUrl   ?? null

  console.log('[unassign-number] done — assistantId:', resultAssistantId, '| serverUrl:', resultServerUrl)

  return NextResponse.json({
    ok:           true,
    vapiPhoneNumberId,
    assistantId:  resultAssistantId,
    serverUrl:    resultServerUrl,
    message:      resultAssistantId
      ? 'WARNING: assistantId still set — Vapi may have rejected the null patch'
      : 'Success — assistantId cleared, number will now use assistant-request webhook',
  })
}
