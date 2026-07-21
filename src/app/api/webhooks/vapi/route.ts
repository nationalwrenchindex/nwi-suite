// Vapi webhook — receives all Foreman call events.
// MUST return 200 to Vapi on all paths to prevent retry storms.

import { NextResponse, type NextRequest } from 'next/server'
import * as chrono from 'chrono-node'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSubscriberSms } from '@/lib/twilio'
import { SERVICE_DURATIONS } from '@/lib/foreman/system-prompt'

const SERVER_URL = 'https://tools.nationalwrenchindex.com/api/webhooks/vapi'

// ── Types ─────────────────────────────────────────────────────────────────────

type Svc = ReturnType<typeof createServiceClient>

interface VapiCall {
  id?:            string
  phoneNumberId?: string
  phoneNumber?:   { number?: string; id?: string }
  customer?:      { number?: string; name?: string }
  startedAt?:     string
  endedAt?:       string
  recordingUrl?:  string
  status?:        string
  endedReason?:   string
}

interface VapiMessage {
  type:           string
  call?:          VapiCall
  phoneNumber?:   { number?: string }  // top-level fallback in some Vapi events
  functionCall?:  { name: string; parameters?: Record<string, unknown> }
  toolCallList?:  { id?: string; type?: string; function?: { name: string; arguments?: string | Record<string, unknown> } }[]
  summary?:       string
  transcript?:    string
}

interface ResolvedSubscriber {
  userId: string
  source: 'foreman_calls' | 'phone_number'
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    console.error('[vapi] invalid JSON body')
    return NextResponse.json({ ok: true }) // always 200
  }

  // Vapi wraps events in a `message` field; some older versions send the event directly
  const message    = (body.message ?? body) as VapiMessage
  const type       = message.type as string | undefined
  const vapiCallId = message.call?.id

  console.log('[FULL VAPI PAYLOAD]', JSON.stringify(body, null, 2))
  console.log('[vapi] ── INCOMING ──────────────────────────────────')
  console.log('[vapi] body:', JSON.stringify(body))
  console.log('[vapi] event type:', type, '| callId:', vapiCallId)
  console.log('[vapi] toolCallList:', JSON.stringify(message.toolCallList ?? null))

  // Resolve subscriber once up front — used by all event handlers
  const svc        = createServiceClient()
  const subscriber = await resolveSubscriberId(svc, vapiCallId, message)
  console.log('[vapi] subscriber lookup result:', subscriber
    ? `userId=${subscriber.userId} (source=${subscriber.source})`
    : 'NOT FOUND — phone number could not be matched to any foreman_settings row')

  try {
    switch (type) {
      case 'assistant-request':
      case 'server-request': {
        console.log('[vapi] action: handleAssistantRequest')
        return await handleAssistantRequest(svc, message, subscriber?.userId ?? null)
      }

      case 'tool-calls':
      case 'function-call': {
        console.log('[vapi] action: handleFunctionCall | toolCallList length:', message.toolCallList?.length ?? 0)
        return await handleFunctionCall(svc, message, subscriber)
      }

      case 'end-of-call-report': {
        console.log('[vapi] action: handleEndOfCall')
        await handleEndOfCall(svc, message, subscriber?.userId ?? null)
        const eocRes = { ok: true }
        console.log('[vapi] RESPONSE for end-of-call-report:', JSON.stringify(eocRes))
        return NextResponse.json(eocRes)
      }

      default: {
        const defaultRes = { ok: true }
        console.log('[vapi] RESPONSE for unhandled event type', type, ':', JSON.stringify(defaultRes))
        return NextResponse.json(defaultRes)
      }
    }
  } catch (err) {
    console.error('[vapi] unhandled error for event', type, ':', err instanceof Error ? err.message : String(err))
    const errRes = { ok: true }
    console.log('[vapi] RESPONSE (error fallback):', JSON.stringify(errRes))
    return NextResponse.json(errRes) // always 200 to Vapi
  }
}

// ── Subscriber resolution — the critical lookup ────────────────────────────────

async function resolveSubscriberId(
  svc: Svc,
  vapiCallId: string | undefined,
  message: VapiMessage,
): Promise<ResolvedSubscriber | null> {

  // ── Step 1: foreman_calls row (created during assistant-request) ──────────
  if (vapiCallId) {
    console.log('[vapi] subscriber lookup: trying foreman_calls for callId=', vapiCallId)
    const { data } = await svc
      .from('foreman_calls')
      .select('user_id')
      .eq('vapi_call_id', vapiCallId)
      .single()
    if (data?.user_id) {
      console.log('[vapi] subscriber lookup: foreman_calls → userId=', data.user_id)
      return { userId: data.user_id as string, source: 'foreman_calls' }
    }
    console.log('[vapi] subscriber lookup: foreman_calls → no row found for callId=', vapiCallId)
  } else {
    console.log('[vapi] subscriber lookup: no callId in message, skipping foreman_calls lookup')
  }

  // ── Step 2: match called phone number against foreman_settings.phone_number ─
  const calledRaw = extractCalledNumber(message)
  console.log('[vapi] subscriber lookup: extracted called number from message =', calledRaw)

  if (!calledRaw) {
    console.log('[vapi] subscriber lookup: no called phone number found in any known path')
    return null
  }

  const normalized = normalizeE164(calledRaw)
  console.log('[vapi] subscriber lookup: normalized called number =', normalized)

  if (!normalized) {
    console.log('[vapi] subscriber lookup: could not normalize', calledRaw, 'to E.164 — giving up')
    return null
  }

  const userId = await findUserIdByPhoneNumber(svc, normalized)
  if (userId) {
    console.log('[vapi] subscriber lookup: phone_number', normalized, '→ userId=', userId)
    return { userId, source: 'phone_number' }
  }

  console.log('[vapi] subscriber lookup: phone_number', normalized, '→ NOT FOUND in foreman_settings')
  return null
}

// Extract the CALLED number (Foreman's number, not the caller's number)
// from multiple possible paths in the Vapi event body.
function extractCalledNumber(message: VapiMessage): string | null {
  const candidates: (string | null | undefined)[] = [
    message.call?.phoneNumber?.number,   // most common: message.call.phoneNumber.number
    message.phoneNumber?.number,          // top-level fallback seen in some Vapi events
    // NOTE: message.call?.customer?.number is the CALLER — do NOT use for subscriber lookup
  ]

  for (const [i, candidate] of candidates.entries()) {
    console.log('[vapi] subscriber lookup: path[' + i + '] =', candidate ?? '(empty)')
    if (candidate) return candidate
  }

  return null
}

// Normalize any US phone number string to E.164 (+1XXXXXXXXXX)
function normalizeE164(num: string): string | null {
  const digits = num.replace(/\D/g, '')
  if (digits.length === 10)                      return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  if (num.startsWith('+') && digits.length >= 10) return `+${digits.slice(-10 - (digits.length === 11 ? 1 : 0))}`
  return null
}

// Query foreman_settings by phone_number — try E.164 then variations
async function findUserIdByPhoneNumber(svc: Svc, normalized: string): Promise<string | null> {
  // Exact match (most likely stored format)
  const { data: exact } = await svc
    .from('foreman_settings')
    .select('user_id')
    .eq('phone_number', normalized)
    .maybeSingle()
  if (exact?.user_id) {
    console.log('[vapi] subscriber lookup: exact phone_number match found')
    return exact.user_id as string
  }

  // Without leading '+' (in case stored without it)
  const withoutPlus = normalized.replace(/^\+/, '')
  const { data: noPlusData } = await svc
    .from('foreman_settings')
    .select('user_id')
    .eq('phone_number', withoutPlus)
    .maybeSingle()
  if (noPlusData?.user_id) {
    console.log('[vapi] subscriber lookup: no-plus phone_number match found')
    return noPlusData.user_id as string
  }

  // Last-resort: last 10 digits wildcard
  const last10 = normalized.replace(/\D/g, '').slice(-10)
  const { data: last10Data } = await svc
    .from('foreman_settings')
    .select('user_id')
    .ilike('phone_number', `%${last10}`)
    .maybeSingle()
  if (last10Data?.user_id) {
    console.log('[vapi] subscriber lookup: last-10-digits match found')
    return last10Data.user_id as string
  }

  return null
}

// ── assistant-request: identify subscriber, return personalized config ─────────

async function handleAssistantRequest(
  svc: Svc,
  message: VapiMessage,
  preResolvedUserId: string | null,
): Promise<NextResponse> {
  const call = message.call ?? {}

  const vapiCallId        = call.id
  const vapiPhoneNumberId = call.phoneNumberId ?? call.phoneNumber?.id
  const calledNumber      = call.phoneNumber?.number
  const callerNumber      = call.customer?.number

  console.log('[vapi assistant-request] vapiCallId:', vapiCallId, '| vapiPhoneNumberId:', vapiPhoneNumberId, '| calledNumber:', calledNumber, '| callerNumber:', callerNumber)

  // Use pre-resolved userId if available; otherwise do assistant-request-specific lookup
  // (which also tries vapi_phone_number_id — a column tool-calls events don't always carry)
  let userId: string | null = preResolvedUserId

  if (!userId && vapiPhoneNumberId) {
    const { data } = await svc
      .from('foreman_settings')
      .select('user_id')
      .eq('vapi_phone_number_id', vapiPhoneNumberId)
      .single()
    userId = data?.user_id ?? null
    if (userId) console.log('[vapi assistant-request] found via vapi_phone_number_id')
  }

  if (!userId) {
    console.error('[vapi assistant-request] could not identify subscriber — vapiPhoneNumberId:', vapiPhoneNumberId, 'calledNumber:', calledNumber)
    const fallback = {
      assistant: {
        name:         'Foreman Fallback',
        firstMessage: 'Thanks for calling. Our system is updating — please call back in a moment.',
        serverUrl:    SERVER_URL,
        model: {
          provider: 'anthropic',
          model:    'claude-haiku-4-5-20251001',
          messages: [{ role: 'system', content: "You are a polite receptionist. Apologize that the system is temporarily unavailable. Collect the caller's name and phone number and let them know someone will call back shortly." }],
        },
        voice: { provider: '11labs', voiceId: 'burt' },
      },
    }
    console.log('[vapi assistant-request] RESPONSE (no subscriber fallback):', JSON.stringify(fallback))
    return NextResponse.json(fallback)
  }

  console.log('[vapi assistant-request] subscriber identified — userId:', userId)

  // Fetch settings + profile in parallel
  const [{ data: settings }, { data: profile }] = await Promise.all([
    svc.from('foreman_settings').select('*').eq('user_id', userId).single(),
    svc.from('profiles').select('business_name, phone, default_labor_rate, full_name').eq('id', userId).single(),
  ])

  const businessName  = settings?.business_name ?? profile?.business_name ?? 'your mechanic'
  const mechanicName  = settings?.mechanic_first_name ?? ((profile?.full_name ?? '').split(' ')[0] || 'the mechanic')
  const laborRate     = (settings as Record<string, unknown> | null)?.labor_rate as number | null
    ?? profile?.default_labor_rate
    ?? 125
  const hoursStart    = String(settings?.working_hours_start ?? '08:00').slice(0, 5)
  const hoursEnd      = String(settings?.working_hours_end   ?? '18:00').slice(0, 5)
  const workingDays   = (settings?.working_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).join(', ')

  console.log('[vapi assistant-request] businessName:', businessName, '| mechanicName:', mechanicName, '| hours:', hoursStart, '-', hoursEnd, '| days:', workingDays)

  const servicesListWithDurations = Object.entries(SERVICE_DURATIONS)
    .map(([svcName, mins]) => `${svcName} (~${mins} min)`)
    .join(', ')

  // Log the call — upsert in case of assistant-request retry
  if (vapiCallId) {
    const { error: callErr } = await svc.from('foreman_calls').upsert({
      user_id:      userId,
      vapi_call_id: vapiCallId,
      caller_phone: callerNumber ?? null,
      status:       'in_progress',
      created_at:   new Date().toISOString(),
    }, { onConflict: 'vapi_call_id' })

    if (callErr) {
      console.error('[vapi assistant-request] foreman_calls upsert error:', callErr.message)
    } else {
      console.log('[vapi assistant-request] foreman_calls row upserted for callId:', vapiCallId)
    }
  }

  // after_hours_message is subscriber-configurable; fall back to a sensible default
  const afterHoursMsg = (settings?.after_hours_message as string | null | undefined)
    ?? 'Thanks for calling. We are currently closed. Please call back during business hours.'

  const firstMessage = `Thanks for calling ${businessName}. This is Foreman, your virtual assistant. How can I help you today?`

  const masterAssistantId = process.env.VAPI_ASSISTANT_ID
  if (!masterAssistantId) {
    console.error('[vapi assistant-request] VAPI_ASSISTANT_ID env var not set — cannot return assistantId')
    return NextResponse.json({
      assistant: {
        name:         'Foreman Config Error',
        firstMessage: 'Thanks for calling. Our system is updating — please call back in a moment.',
      },
    })
  }

  // Return assistantId + assistantOverrides — the canonical Vapi multi-tenancy pattern.
  // Vapi uses the master Foreman assistant (voice, transcriber, tools, {{variable}} prompt)
  // and applies per-subscriber overrides for this call only.
  const assistantResponse = {
    assistantId: masterAssistantId,
    assistantOverrides: {
      firstMessage,
      variableValues: {
        business_name:       businessName,
        mechanic_first_name: mechanicName,
        working_hours_start: hoursStart,
        working_hours_end:   hoursEnd,
        working_days:        workingDays,
        after_hours_message: afterHoursMsg,
        labor_rate:          String(laborRate),
        services_list:       servicesListWithDurations,
      },
    },
  }

  console.log('[vapi assistant-request] RESPONSE for userId:', userId, '| businessName:', businessName, '| assistantId:', masterAssistantId)
  console.log('[vapi assistant-request] variableValues:', JSON.stringify(assistantResponse.assistantOverrides.variableValues))
  return NextResponse.json(assistantResponse)
}

// ── tool-calls / function-call: route to check_availability or book_appointment ─

async function handleFunctionCall(
  svc: Svc,
  message: VapiMessage,
  subscriber: ResolvedSubscriber | null,
): Promise<NextResponse> {
  const vapiCallId = message.call?.id

  // If we resolved the subscriber by phone number (no foreman_calls row yet),
  // create that row now so end-of-call-report can find it.
  if (subscriber?.source === 'phone_number' && vapiCallId) {
    const callerPhone = message.call?.customer?.number ?? null
    const { error: upsertErr } = await svc.from('foreman_calls').upsert({
      user_id:      subscriber.userId,
      vapi_call_id: vapiCallId,
      caller_phone: callerPhone,
      status:       'in_progress',
      created_at:   new Date().toISOString(),
    }, { onConflict: 'vapi_call_id' })
    if (upsertErr) {
      console.error('[vapi handleFunctionCall] foreman_calls upsert error:', upsertErr.message)
    } else {
      console.log('[vapi handleFunctionCall] created foreman_calls row for callId:', vapiCallId, 'userId:', subscriber.userId)
    }
  }

  const errorResult = 'Unable to identify the business account — please confirm you called the right number.'

  // New Vapi format (tool-calls event or function-call with toolCallList):
  // toolCallList carries IDs → respond with { results: [{ toolCallId, result }] }
  if (message.toolCallList && message.toolCallList.length > 0) {
    const results: Array<{ toolCallId: string; result: string }> = []

    for (const tc of message.toolCallList) {
      const toolCallId = tc.id ?? ''
      const fnName     = tc.function?.name
      let fnParams: Record<string, unknown> = {}
      try {
        const rawArgs = tc.function?.arguments as unknown
        if (!rawArgs) {
          fnParams = {}
        } else if (typeof rawArgs === 'string') {
          fnParams = JSON.parse(rawArgs) as Record<string, unknown>
        } else if (typeof rawArgs === 'object') {
          fnParams = rawArgs as Record<string, unknown>
        }
      } catch {
        fnParams = {}
      }
      console.log('[DIAG-3.1] fn:', fnName, '| arguments type:', typeof tc.function?.arguments, '| fnParams keys:', Object.keys(fnParams))

      if (fnName === 'book_appointment') {
        console.log('[BOOK APPOINTMENT RAW TOOL CALL]', JSON.stringify(tc, null, 2))
        console.log('[BOOK APPOINTMENT ARGS KEYS]', Object.keys(fnParams))
        console.log('[BOOK APPOINTMENT ARGS VALUES]', JSON.stringify(fnParams, null, 2))
      }

      console.log('[vapi tool-call] fn:', fnName, '| toolCallId:', toolCallId, '| callId:', vapiCallId, '| userId:', subscriber?.userId ?? 'UNKNOWN', '| params:', JSON.stringify(fnParams))

      let result: string
      if (!subscriber) {
        result = errorResult
      } else {
        try {
          result = await dispatchToolCall(svc, vapiCallId, subscriber.userId, fnName, fnParams)
        } catch (err) {
          console.error('[vapi tool-call] error in', fnName, ':', err instanceof Error ? err.message : String(err))
          result = "I ran into a technical issue. Let me take your information and have someone follow up."
        }
      }

      console.log('[vapi tool-call] fn:', fnName, '| result:', result)
      results.push({ toolCallId, result })
    }

    const response = { results }
    console.log('[vapi tool-calls] RESPONSE to Vapi:', JSON.stringify(response))
    return NextResponse.json(response)
  }

  // Legacy format: message.functionCall (older Vapi versions without toolCallList)
  if (message.functionCall) {
    const fnName   = message.functionCall.name
    const fnParams = message.functionCall.parameters ?? {}

    console.log('[vapi function-call] fn:', fnName, '| callId:', vapiCallId, '| userId:', subscriber?.userId ?? 'UNKNOWN', '| params:', JSON.stringify(fnParams))

    let result: string
    if (!subscriber) {
      result = errorResult
    } else {
      try {
        result = await dispatchToolCall(svc, vapiCallId, subscriber.userId, fnName, fnParams)
      } catch (err) {
        console.error('[vapi function-call] error in', fnName, ':', err instanceof Error ? err.message : String(err))
        result = "I ran into a technical issue. Let me take your information and have someone follow up."
      }
    }

    const response = { result }
    console.log('[vapi function-call] RESPONSE to Vapi:', JSON.stringify(response))
    return NextResponse.json(response)
  }

  console.warn('[vapi function-call] no functionCall or toolCallList in message')
  const noDataResponse = { result: 'No tool call data found in request.' }
  console.log('[vapi function-call] RESPONSE (no tool data):', JSON.stringify(noDataResponse))
  return NextResponse.json(noDataResponse)
}

// ── dispatchToolCall: routes function name to its handler ─────────────────────

async function dispatchToolCall(
  svc: Svc,
  vapiCallId: string | undefined,
  userId: string,
  fnName: string | undefined,
  fnParams: Record<string, unknown>,
): Promise<string> {
  console.log('[DIAG] dispatchToolCall called — fnName:', fnName, '| fnParams:', JSON.stringify(fnParams, null, 2))

  switch (fnName) {
    case 'check_availability':
      return await handleCheckAvailability(svc, userId, vapiCallId, {
        service_type:   String(fnParams.service_type ?? ''),
        preferred_date: fnParams.preferred_date ? String(fnParams.preferred_date) : undefined,
      })

    case 'book_appointment': {
      // Log every possible key path so we can see exactly where the slot is hiding
      const possibleSlotKeys = [
        'appointment_datetime', 'appointment_time', 'confirmed_slot_datetime',
        'confirmedSlotDatetime', 'slot_datetime', 'slot', 'datetime', 'time', 'when',
      ]
      for (const key of possibleSlotKeys) {
        console.log(`[DIAG] args.${key} =`, JSON.stringify(fnParams[key]))
      }

      // Pick the first non-empty string value
      let rawDatetime = ''
      for (const key of possibleSlotKeys) {
        const val = fnParams[key]
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          rawDatetime = String(val).trim()
          console.log('[DIAG] book_appointment datetime found under key:', key, '=', rawDatetime)
          break
        }
      }

      console.log('[SLOT INPUT TYPE]', typeof rawDatetime)
      console.log('[SLOT INPUT VALUE]', JSON.stringify(rawDatetime))
      console.log('[SLOT INPUT LENGTH]', rawDatetime.length)

      if (!rawDatetime) {
        console.error('[DIAG] book_appointment: ALL slot keys empty. Full fnParams:', JSON.stringify(fnParams, null, 2))
        return "I'm missing the appointment time. Please ask the caller to state the exact date and time again — like 'Monday May eighteenth at 9 AM' — then call book_appointment with that datetime in the appointment_datetime field."
      }

      return await handleBookAppointment(svc, userId, vapiCallId, {
        customer_name:        String(fnParams.customer_name ?? ''),
        customer_phone:       fnParams.customer_phone ? String(fnParams.customer_phone) : undefined,
        vehicle_info:         fnParams.vehicle_info  ? String(fnParams.vehicle_info)  : undefined,
        engine_size:          fnParams.engine_size   ? String(fnParams.engine_size)   : undefined,
        service_type:         String(fnParams.service_type ?? ''),
        appointment_datetime: rawDatetime,
      })
    }

    default:
      console.warn('[vapi dispatchToolCall] unknown function:', fnName)
      return 'Function not recognized. Ask the caller to repeat their request.'
  }
}

// ── check_availability ─────────────────────────────────────────────────────────

async function handleCheckAvailability(
  svc: Svc,
  userId: string,
  vapiCallId: string | undefined,
  params: { service_type: string; preferred_date?: string },
): Promise<string> {
  console.log('[check_availability] userId:', userId, '| callId:', vapiCallId, '| params:', JSON.stringify(params))

  const { data: settings, error: settingsErr } = await svc
    .from('foreman_settings')
    .select('working_hours_start, working_hours_end, working_days, mechanic_first_name')
    .eq('user_id', userId)
    .single()

  if (settingsErr) {
    console.error('[check_availability] settings fetch error:', settingsErr.message)
  }

  const workingDays  = settings?.working_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const hoursStart   = String(settings?.working_hours_start ?? '08:00').slice(0, 5)
  const hoursEnd     = String(settings?.working_hours_end   ?? '18:00').slice(0, 5)
  const mechanicName = settings?.mechanic_first_name ?? 'the mechanic'

  console.log('[check_availability] workingDays:', workingDays, '| hours:', hoursStart, '-', hoursEnd)

  const serviceName = params.service_type || 'Oil Change'
  const duration    = SERVICE_DURATIONS[serviceName] ?? 60

  const [oh, om] = hoursStart.split(':').map(Number)
  const [ch, cm] = hoursEnd.split(':').map(Number)
  const rawOpenMin  = oh * 60 + om
  const rawCloseMin = ch * 60 + cm

  // Clamp to sane business hours (8 AM – 6 PM) so test configs like
  // "00:00–23:59" don't produce 1 AM slots for callers
  const SANE_START = 8 * 60   // 480 = 8:00 AM
  const SANE_END   = 18 * 60  // 1080 = 6:00 PM
  const openMin  = Math.max(rawOpenMin,  SANE_START)
  const closeMin = Math.min(rawCloseMin, SANE_END)

  console.log('[check_availability] service:', serviceName, '| duration:', duration, 'min | rawOpen:', rawOpenMin, '| rawClose:', rawCloseMin, '| effectiveOpen:', openMin, '| effectiveClose:', closeMin)

  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const slots: { label: string; datetime: string }[] = []
  const now = new Date()

  // Search up to 14 days out to find 3 slots
  for (let offset = 1; offset <= 14 && slots.length < 3; offset++) {
    const date = new Date(now)
    date.setDate(date.getDate() + offset)
    date.setHours(0, 0, 0, 0)

    const dayAbbr = DAY_ABBR[date.getDay()]
    if (!workingDays.includes(dayAbbr)) continue

    const dateStr = toDateStr(date)
    if (params.preferred_date && dateStr !== params.preferred_date) continue

    const { data: bookedJobs, error: jobsErr } = await svc
      .from('jobs')
      .select('job_time, estimated_duration_minutes')
      .eq('user_id', userId)
      .eq('job_date', dateStr)
      .neq('status', 'cancelled')
      .neq('status', 'no_show')

    if (jobsErr) {
      console.error('[check_availability] jobs fetch error for', dateStr, ':', jobsErr.message)
    }

    const existingIntervals = (bookedJobs ?? []).flatMap(job => {
      if (!job.job_time) return []
      const [h, m] = String(job.job_time).slice(0, 5).split(':').map(Number)
      const start  = h * 60 + m
      const end    = start + ((job.estimated_duration_minutes as number | null) ?? 60)
      return [{ start, end }]
    })

    console.log('[check_availability] date:', dateStr, '| existing intervals:', JSON.stringify(existingIntervals))

    for (let m = openMin; m + duration <= closeMin && slots.length < 3; m += 60) {
      const slotEnd     = m + duration
      const hasConflict = existingIntervals.some(({ start, end }) => !(slotEnd <= start || m >= end))
      if (hasConflict) continue

      const h          = Math.floor(m / 60)
      const min        = m % 60
      const period     = h >= 12 ? 'PM' : 'AM'
      const h12        = h % 12 || 12
      const timeLabel  = `${h12}:${String(min).padStart(2, '0')} ${period}`
      const dateLabel  = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const isoTime    = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`

      slots.push({ label: `${dateLabel} at ${timeLabel}`, datetime: `${dateStr}T${isoTime}` })
    }
  }

  console.log('[check_availability] found', slots.length, 'slots:', JSON.stringify(slots))

  if (slots.length === 0) {
    const result = `No available slots in the next two weeks for ${serviceName}. Offer to take a message or check a different week. ${mechanicName} will follow up.`
    console.log('[check_availability] result:', result)
    return result
  }

  const slotLabels = slots.map(s => s.label).join(', ')
  const result = `Available slots for ${serviceName}: ${slotLabels}. Ask which time works best for the caller.`
  console.log('[check_availability] result:', result)
  return result
}

// ── book_appointment ───────────────────────────────────────────────────────────

async function handleBookAppointment(
  svc: Svc,
  userId: string,
  vapiCallId: string | undefined,
  params: {
    customer_name:        string
    customer_phone?:      string
    vehicle_info?:        string
    engine_size?:         string
    service_type:         string
    appointment_datetime: string
  },
): Promise<string> {
  console.log('[book_appointment] userId:', userId, '| callId:', vapiCallId, '| params:', JSON.stringify(params))

  // Parse datetime — accepts ISO strings AND natural language from Vapi
  const rawSlot = params.appointment_datetime
  console.log('[vapi] book_appointment input slot:', rawSlot)

  const parsedDate = parseSlotDatetime(rawSlot)
  if (!parsedDate) {
    console.error('[vapi] book_appointment failed to parse slot:', rawSlot)
    return "Booking failed: couldn't read that date and time. Ask the caller to confirm the date and time again, then call book_appointment once more."
  }

  const jobDate = toDateStr(parsedDate)
  const jobTime = `${String(parsedDate.getHours()).padStart(2, '0')}:${String(parsedDate.getMinutes()).padStart(2, '0')}`

  console.log('[vapi] book_appointment parsed slot:', parsedDate.toISOString(), '→ jobDate:', jobDate, '| jobTime:', jobTime)

  const serviceName = params.service_type || 'Service'
  const duration    = SERVICE_DURATIONS[serviceName] ?? 60

  // Race condition check — make sure slot is still open
  const [jh, jm] = jobTime.split(':').map(Number)
  const slotMin   = jh * 60 + jm
  const slotEnd   = slotMin + duration

  const { data: existingJobs } = await svc
    .from('jobs')
    .select('job_time, estimated_duration_minutes')
    .eq('user_id', userId)
    .eq('job_date', jobDate)
    .in('status', ['scheduled', 'en_route', 'in_progress', 'on_site'])

  for (const job of existingJobs ?? []) {
    if (!job.job_time) continue
    const [eh, em]   = String(job.job_time).slice(0, 5).split(':').map(Number)
    const existStart = eh * 60 + em
    const existEnd   = existStart + ((job.estimated_duration_minutes as number | null) ?? 60)
    if (!(slotEnd <= existStart || slotMin >= existEnd)) {
      return "Booking failed: that slot was just taken by another booking. Call check_availability again to find the next open time and offer it to the caller."
    }
  }

  // Parse customer name
  const nameParts = params.customer_name.trim().split(/\s+/)
  const firstName = nameParts[0] || 'Customer'
  const lastName  = nameParts.slice(1).join(' ') || 'Unknown'

  // Build vehicle + engine text for job notes (no separate vehicle row for inbound calls)
  const vehicleText = params.vehicle_info?.trim() || null
  const engineRaw   = params.engine_size?.trim() || null
  const engineText  = engineRaw && engineRaw.toLowerCase() !== 'unknown' ? engineRaw : null

  // Find or create customer
  const rawPhone = (params.customer_phone ?? '').replace(/\D/g, '')
  let customerId: string

  if (rawPhone.length >= 10) {
    const { data: existing } = await svc
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .ilike('phone', `%${rawPhone.slice(-10)}%`)
      .limit(1)

    if (existing && existing.length > 0) {
      customerId = existing[0].id as string
    } else {
      const { data: newCust, error: custErr } = await svc
        .from('customers')
        .insert({ user_id: userId, first_name: firstName, last_name: lastName, phone: params.customer_phone ?? null })
        .select('id')
        .single()
      if (custErr || !newCust) {
        console.error('[book_appointment] customer insert error:', custErr)
        return "Booking failed: trouble saving customer information. Tell the caller you'll have someone follow up to confirm."
      }
      customerId = newCust.id as string
    }
  } else {
    const { data: newCust, error: custErr } = await svc
      .from('customers')
      .insert({ user_id: userId, first_name: firstName, last_name: lastName, phone: null })
      .select('id')
      .single()
    if (custErr || !newCust) {
      console.error('[book_appointment] customer insert error:', custErr)
      return "Booking failed: trouble saving customer information. Tell the caller you'll have someone follow up to confirm."
    }
    customerId = newCust.id as string
  }

  // Create job
  const { data: job, error: jobErr } = await svc
    .from('jobs')
    .insert({
      user_id:                    userId,
      customer_id:                customerId,
      vehicle_id:                 null,
      job_date:                   jobDate,
      job_time:                   jobTime,
      service_type:               serviceName,
      status:                     'scheduled',
      estimated_duration_minutes: duration,
      notes:                      [
                                    vehicleText ? `Vehicle: ${vehicleText}.` : null,
                                    `Engine: ${engineText ?? 'not captured'}.`,
                                    'Booked via Foreman call.',
                                  ].filter(Boolean).join(' '),
      sms_consent:                rawPhone.length >= 10,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    console.error('[book_appointment] job insert error:', jobErr)
    return "Booking failed: trouble saving the appointment. Tell the caller you'll have someone follow up to confirm."
  }

  console.log('[book_appointment] job created:', job.id)

  // Update foreman_calls row
  if (vapiCallId) {
    await svc
      .from('foreman_calls')
      .update({ appointment_booked: true, job_id: job.id, service_type: serviceName })
      .eq('vapi_call_id', vapiCallId)
  }

  // Fetch settings for SMS
  const { data: settings } = await svc
    .from('foreman_settings')
    .select('mechanic_phone, mechanic_first_name, business_name')
    .eq('user_id', userId)
    .single()

  const timeLabel = formatTimeLabel(jh, jm)
  const dateObj   = new Date(jobDate + 'T00:00:00')
  const dateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  // SMS to mechanic (awaited so Vercel doesn't kill in-flight fetch)
  if (settings?.mechanic_phone) {
    const vehicleDesc = vehicleText
      ? (engineText ? `${vehicleText} (${engineText})` : vehicleText)
      : null
    const body = `Foreman booked: ${firstName} ${lastName}${vehicleDesc ? ` · ${vehicleDesc}` : ''} · ${serviceName} · ${dateLabel} at ${timeLabel}${rawPhone.length >= 10 ? ' · ' + params.customer_phone : ''} — LawnPlatform`
    try {
      await sendSubscriberSms({ to: settings.mechanic_phone, body })
      console.log('[booking-sms] mechanic SMS sent to', settings.mechanic_phone)
    } catch (e) {
      console.error('[booking-sms] mechanic SMS failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // SMS confirmation to customer (awaited)
  if (params.customer_phone && rawPhone.length >= 10) {
    const biz  = settings?.business_name ?? 'your mechanic'
    const body = `Appointment confirmed with ${biz}: ${serviceName} on ${dateLabel} at ${timeLabel}. See you then!`
    try {
      await sendSubscriberSms({ to: params.customer_phone, body })
      console.log('[booking-sms] customer SMS sent to', params.customer_phone)
    } catch (e) {
      console.error('[booking-sms] customer SMS failed:', e instanceof Error ? e.message : String(e))
    }
  }

  const longDateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const smsNote = rawPhone.length >= 10 ? ' Customer will receive SMS confirmation shortly.' : ''
  const result = `Appointment booked. Job ID: ${job.id}. ${serviceName} confirmed for ${longDateLabel} at ${timeLabel}.${smsNote}`
  console.log('[book_appointment] result:', result)
  return result
}

// ── end-of-call-report: log call, notify mechanic ─────────────────────────────

async function handleEndOfCall(
  svc: Svc,
  message: VapiMessage,
  preResolvedUserId: string | null,
): Promise<void> {
  const call = message.call ?? {}

  const vapiCallId = call.id
  if (!vapiCallId) {
    console.warn('[vapi end-of-call] no call.id in event')
    return
  }

  console.log('[vapi end-of-call] callId:', vapiCallId, '| preResolvedUserId:', preResolvedUserId ?? 'null')

  const startedAt = call.startedAt ? new Date(call.startedAt) : null
  const endedAt   = call.endedAt   ? new Date(call.endedAt)   : null
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
    : null

  const summary      = message.summary   ?? null
  const recordingUrl = call.recordingUrl ?? null
  const callerPhone  = call.customer?.number ?? null

  // Look up or bootstrap the foreman_calls row
  const { data: existingCall } = await svc
    .from('foreman_calls')
    .select('user_id, appointment_booked, caller_phone')
    .eq('vapi_call_id', vapiCallId)
    .single()

  console.log('[vapi end-of-call] existingCall user_id:', existingCall?.user_id ?? 'none')

  const userId = existingCall?.user_id ?? preResolvedUserId

  console.log('[vapi end-of-call] subscriber lookup result:', userId ?? 'null')

  if (!userId) {
    console.warn('[vapi end-of-call] no user_id found for callId:', vapiCallId, '| called phone not matched — skipping record')
    return
  }

  if (!existingCall) {
    console.log('[vapi end-of-call] no foreman_calls row found — creating one via upsert for callId:', vapiCallId, 'userId:', userId)
  }

  const outcome    = existingCall?.appointment_booked ? 'booked' : 'no_booking'
  const callerName = extractCallerName(summary)

  const eocRow = {
    user_id:               userId,
    vapi_call_id:          vapiCallId,
    caller_phone:          callerPhone ?? existingCall?.caller_phone ?? null,
    call_duration_seconds: durationSeconds,
    call_summary:          summary,
    recording_url:         recordingUrl,
    status:                'completed',
    outcome,
    caller_name:           callerName,
    appointment_booked:    existingCall?.appointment_booked ?? false,
  }
  console.log('[vapi end-of-call] inserting foreman_calls row:', JSON.stringify(eocRow))

  // Upsert handles both "row exists" (update) and "row missing" (create) cases
  const { error: upsertErr } = await svc
    .from('foreman_calls')
    .upsert(eocRow, { onConflict: 'vapi_call_id' })

  if (upsertErr) {
    console.error('[vapi end-of-call] foreman_calls upsert error:', upsertErr.message)
  } else {
    console.log('[vapi end-of-call] foreman_calls row upserted — callId:', vapiCallId, 'outcome:', outcome, 'duration:', durationSeconds)
  }

  // Notify mechanic
  const { data: settings } = await svc
    .from('foreman_settings')
    .select('mechanic_phone, mechanic_first_name')
    .eq('user_id', userId)
    .single()

  if (settings?.mechanic_phone) {
    const dur        = durationSeconds != null ? `${Math.round(durationSeconds / 60)}m` : '—'
    const outcomeStr = existingCall?.appointment_booked ? 'booked a job' : 'did not book'
    const snippet    = summary ? ` "${summary.slice(0, 80).trim()}${summary.length > 80 ? '…' : ''}"` : ''
    const appUrl     = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'
    const smsBody    = `Foreman call: ${outcomeStr} (${dur}).${snippet} — View at ${appUrl}`
    try {
      await sendSubscriberSms({ to: settings.mechanic_phone, body: smsBody })
      console.log('[end-of-call] mechanic SMS sent to', settings.mechanic_phone)
    } catch (e) {
      console.error('[end-of-call] mechanic SMS failed:', e instanceof Error ? e.message : String(e))
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse natural-language or ISO slot strings into a Date.
// Examples handled: "Friday May 15 at 1:00 PM", "one o'clock on Friday May fifteenth",
// "tomorrow at 2 PM", "next Tuesday at 9 AM", "2026-05-15T13:00:00"
function parseSlotDatetime(input: string, referenceDate: Date = new Date()): Date | null {
  if (!input?.trim()) return null

  console.log('[parseSlotDatetime] input:', input)

  // Fast path: already ISO format
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(input.trim())) {
    const d = new Date(input.trim())
    if (!isNaN(d.getTime())) {
      console.log('[parseSlotDatetime] ISO fast-path →', d.toISOString())
      return d
    }
  }

  // Primary: chrono-node natural language parser
  try {
    const parsed = chrono.parseDate(input, referenceDate, { forwardDate: true })
    if (parsed && !isNaN(parsed.getTime())) {
      console.log('[parseSlotDatetime] chrono parsed →', parsed.toISOString())
      return parsed
    }
    console.log('[parseSlotDatetime] chrono returned null for:', input)
  } catch (err) {
    console.error('[parseSlotDatetime] chrono threw:', err instanceof Error ? err.message : String(err))
  }

  // Last resort: native Date constructor (handles many unambiguous strings)
  try {
    const d = new Date(input)
    if (!isNaN(d.getTime())) {
      console.log('[parseSlotDatetime] native Date fallback →', d.toISOString())
      return d
    }
  } catch {
    // ignore
  }

  console.error('[parseSlotDatetime] all parsers failed for:', input)
  return null
}

function toDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatTimeLabel(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12    = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function extractCallerName(summary: string | null | undefined): string | null {
  if (!summary) return null
  const match = summary.match(/(?:caller|customer|name)[:\s]+([A-Za-z][A-Za-z\s]{1,30})/i)
  return match?.[1]?.trim() ?? null
}
