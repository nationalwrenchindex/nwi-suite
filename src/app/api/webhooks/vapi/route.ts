// Vapi webhook — receives all Foreman call events.
// MUST return 200 to Vapi on all paths to prevent retry storms.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendSubscriberSms } from '@/lib/twilio'
import { buildSystemPrompt, SERVICE_DURATIONS } from '@/lib/foreman/system-prompt'

const SERVER_URL = 'https://tools.nationalwrenchindex.com/api/webhooks/vapi'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  functionCall?:  { name: string; parameters?: Record<string, unknown> }
  toolCallList?:  { id?: string; type?: string; function?: { name: string; arguments?: string } }[]
  summary?:       string
  transcript?:    string
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
  const message = (body.message ?? body) as VapiMessage
  const type    = message.type as string | undefined

  console.log('[vapi] ── INCOMING ──────────────────────────────────')
  console.log('[vapi] body:', JSON.stringify(body))
  console.log('[vapi] event type:', type, '| callId:', message.call?.id)
  console.log('[vapi] toolCallList:', JSON.stringify(message.toolCallList ?? null))

  try {
    switch (type) {
      case 'assistant-request':
      case 'server-request': {
        console.log('[vapi] action: handleAssistantRequest')
        return await handleAssistantRequest(message)
      }

      case 'tool-calls':
      case 'function-call': {
        console.log('[vapi] action: handleFunctionCall | toolCallList length:', message.toolCallList?.length ?? 0)
        return await handleFunctionCall(message)
      }

      case 'end-of-call-report': {
        console.log('[vapi] action: handleEndOfCall')
        await handleEndOfCall(message)
        const eocRes = { ok: true }
        console.log('[vapi] RESPONSE for end-of-call-report:', JSON.stringify(eocRes))
        return NextResponse.json(eocRes)
      }

      default: {
        // status-update, transcript, hang, speech-update — no action needed
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

// ── assistant-request: identify subscriber, return personalized config ─────────

async function handleAssistantRequest(message: VapiMessage): Promise<NextResponse> {
  const svc  = createServiceClient()
  const call = message.call ?? {}

  const vapiCallId        = call.id
  const vapiPhoneNumberId = call.phoneNumberId ?? call.phoneNumber?.id
  const calledNumber      = call.phoneNumber?.number
  const callerNumber      = call.customer?.number

  console.log('[vapi assistant-request] vapiCallId:', vapiCallId, '| vapiPhoneNumberId:', vapiPhoneNumberId, '| calledNumber:', calledNumber, '| callerNumber:', callerNumber)

  // Look up subscriber — try vapi_phone_number_id first, then raw phone number
  let userId: string | null = null

  if (vapiPhoneNumberId) {
    const { data } = await svc
      .from('foreman_settings')
      .select('user_id')
      .eq('vapi_phone_number_id', vapiPhoneNumberId)
      .single()
    userId = data?.user_id ?? null
  }

  if (!userId && calledNumber) {
    const { data } = await svc
      .from('foreman_settings')
      .select('user_id')
      .eq('phone_number', calledNumber)
      .single()
    userId = data?.user_id ?? null
  }

  if (!userId) {
    console.error('[vapi assistant-request] could not identify subscriber — vapiPhoneNumberId:', vapiPhoneNumberId, 'calledNumber:', calledNumber)
    const fallback = {
      assistant: {
        firstMessage: "Thanks for calling. I'm a virtual assistant. How can I help you today?",
        serverUrl: SERVER_URL,
        model: {
          provider: 'anthropic',
          model:    'claude-haiku-4-5-20251001',
          messages: [{ role: 'system', content: "You are a polite receptionist. Collect the caller's name, phone number, and what they need, then let them know someone will call back." }],
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
    }
  }

  const systemPrompt = buildSystemPrompt({
    businessName,
    mechanicName,
    laborRate,
    servicesListWithDurations,
    workingHoursStart: hoursStart,
    workingHoursEnd:   hoursEnd,
    workingDays,
  })

  const firstMessage = `Thanks for calling ${businessName}. This is Foreman, your virtual assistant. How can I help you today?`

  const vapiTools = [
    {
      type: 'function',
      function: {
        name:        'check_availability',
        description: 'Check available appointment time slots for a service. Always call this before offering any times to the caller.',
        parameters:  {
          type: 'object',
          properties: {
            service_type: {
              type:        'string',
              description: `The service the customer needs. Valid values: ${Object.keys(SERVICE_DURATIONS).join(', ')}`,
            },
            preferred_date: {
              type:        'string',
              description: 'Optional preferred date as YYYY-MM-DD. Omit to check the next available dates.',
            },
          },
          required: ['service_type'],
        },
      },
      server: { url: SERVER_URL, timeoutSeconds: 20 },
    },
    {
      type: 'function',
      function: {
        name:        'book_appointment',
        description: 'Book an appointment after the caller has confirmed a specific date and time. Only call this after the caller has verbally agreed to a slot.',
        parameters:  {
          type: 'object',
          properties: {
            customer_name: {
              type:        'string',
              description: "Caller's full name",
            },
            customer_phone: {
              type:        'string',
              description: "Caller's callback phone number",
            },
            vehicle_info: {
              type:        'string',
              description: "Vehicle description, e.g. '2018 Honda Civic'",
            },
            service_type: {
              type:        'string',
              description: 'Service to be performed',
            },
            appointment_datetime: {
              type:        'string',
              description: 'Confirmed date and time in ISO 8601 format, e.g. 2026-05-20T10:00:00',
            },
          },
          required: ['customer_name', 'service_type', 'appointment_datetime'],
        },
      },
      server: { url: SERVER_URL, timeoutSeconds: 30 },
    },
  ]

  const assistantResponse = {
    assistant: {
      firstMessage,
      serverUrl: SERVER_URL,
      model: {
        provider: 'anthropic',
        model:    'claude-haiku-4-5-20251001',
        messages: [{ role: 'system', content: systemPrompt }],
        tools:    vapiTools,
      },
      voice: { provider: '11labs', voiceId: 'burt' },
      variableValues: {
        business_name:       businessName,
        mechanic_first_name: mechanicName,
        mechanic_phone:      settings?.mechanic_phone ?? '',
        labor_rate:          String(laborRate),
        working_hours_start: hoursStart,
        working_hours_end:   hoursEnd,
        working_days:        workingDays,
      },
    },
  }

  console.log('[vapi assistant-request] RESPONSE for userId:', userId, '| businessName:', businessName, '| firstMessage:', firstMessage)
  return NextResponse.json(assistantResponse)
}

// ── tool-calls / function-call: route to check_availability or book_appointment ─

async function handleFunctionCall(message: VapiMessage): Promise<NextResponse> {
  const call       = message.call ?? {}
  const vapiCallId = call.id

  // New Vapi format (tool-calls event, or function-call with toolCallList):
  // toolCallList has IDs — respond with { results: [{ toolCallId, result }] }
  if (message.toolCallList && message.toolCallList.length > 0) {
    const results: Array<{ toolCallId: string; result: string }> = []

    for (const tc of message.toolCallList) {
      const toolCallId = tc.id ?? ''
      const fnName     = tc.function?.name
      let fnParams: Record<string, unknown> = {}
      try {
        fnParams = tc.function?.arguments ? JSON.parse(tc.function.arguments) as Record<string, unknown> : {}
      } catch {
        fnParams = {}
      }

      console.log('[vapi tool-call] fn:', fnName, '| toolCallId:', toolCallId, '| callId:', vapiCallId, '| params:', JSON.stringify(fnParams))

      let result: string
      try {
        result = await dispatchToolCall(vapiCallId, fnName, fnParams)
      } catch (err) {
        console.error('[vapi tool-call] error in', fnName, ':', err instanceof Error ? err.message : String(err))
        result = "I'm sorry, I ran into a technical issue. Let me take your information and have someone follow up."
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

    console.log('[vapi function-call] fn:', fnName, '| callId:', vapiCallId, '| params:', JSON.stringify(fnParams))

    let result: string
    try {
      result = await dispatchToolCall(vapiCallId, fnName, fnParams)
    } catch (err) {
      console.error('[vapi function-call] error in', fnName, ':', err instanceof Error ? err.message : String(err))
      result = "I'm sorry, I ran into a technical issue. Let me take your information and have someone follow up."
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
  vapiCallId: string | undefined,
  fnName: string | undefined,
  fnParams: Record<string, unknown>,
): Promise<string> {
  switch (fnName) {
    case 'check_availability':
      return await handleCheckAvailability(vapiCallId, {
        service_type:   String(fnParams.service_type ?? ''),
        preferred_date: fnParams.preferred_date ? String(fnParams.preferred_date) : undefined,
      })

    case 'book_appointment':
      return await handleBookAppointment(vapiCallId, {
        customer_name:        String(fnParams.customer_name ?? ''),
        customer_phone:       fnParams.customer_phone ? String(fnParams.customer_phone) : undefined,
        vehicle_info:         fnParams.vehicle_info  ? String(fnParams.vehicle_info)  : undefined,
        service_type:         String(fnParams.service_type ?? ''),
        appointment_datetime: String(fnParams.appointment_datetime ?? ''),
      })

    default:
      console.warn('[vapi dispatchToolCall] unknown function:', fnName)
      return 'Function not recognized. Ask the caller to repeat their request.'
  }
}

// ── check_availability ─────────────────────────────────────────────────────────

async function handleCheckAvailability(
  vapiCallId: string | undefined,
  params: { service_type: string; preferred_date?: string },
): Promise<string> {
  const svc = createServiceClient()

  const userId = await getUserIdFromCallId(svc, vapiCallId)
  if (!userId) {
    return 'Unable to look up the appointment schedule right now. Offer to take a message and have someone call the customer back.'
  }

  const { data: settings } = await svc
    .from('foreman_settings')
    .select('working_hours_start, working_hours_end, working_days, mechanic_first_name')
    .eq('user_id', userId)
    .single()

  const workingDays   = settings?.working_days ?? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
  const hoursStart    = String(settings?.working_hours_start ?? '08:00').slice(0, 5)
  const hoursEnd      = String(settings?.working_hours_end   ?? '18:00').slice(0, 5)
  const mechanicName  = settings?.mechanic_first_name ?? 'the mechanic'

  const serviceName = params.service_type || 'Oil Change'
  const duration    = SERVICE_DURATIONS[serviceName] ?? 60

  const [oh, om] = hoursStart.split(':').map(Number)
  const [ch, cm] = hoursEnd.split(':').map(Number)
  const openMin  = oh * 60 + om
  const closeMin = ch * 60 + cm

  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const slots: { label: string; datetime: string }[] = []

  const now = new Date()

  // Search up to 14 days out to find 3 slots
  for (let offset = 1; offset <= 14 && slots.length < 3; offset++) {
    const date    = new Date(now)
    date.setDate(date.getDate() + offset)
    date.setHours(0, 0, 0, 0)

    const dayAbbr = DAY_ABBR[date.getDay()]
    if (!workingDays.includes(dayAbbr)) continue

    const dateStr = toDateStr(date)

    // If caller specified a preferred date, only check that date
    if (params.preferred_date && dateStr !== params.preferred_date) continue

    const { data: bookedJobs } = await svc
      .from('jobs')
      .select('job_time, estimated_duration_minutes')
      .eq('user_id', userId)
      .eq('job_date', dateStr)
      .neq('status', 'cancelled')
      .neq('status', 'no_show')

    const existingIntervals = (bookedJobs ?? []).flatMap(job => {
      if (!job.job_time) return []
      const [h, m] = String(job.job_time).slice(0, 5).split(':').map(Number)
      const start  = h * 60 + m
      const end    = start + ((job.estimated_duration_minutes as number | null) ?? 60)
      return [{ start, end }]
    })

    for (let m = openMin; m + duration <= closeMin && slots.length < 3; m += 60) {
      const slotEnd     = m + duration
      const hasConflict = existingIntervals.some(
        ({ start, end }) => !(slotEnd <= start || m >= end),
      )
      if (hasConflict) continue

      const h      = Math.floor(m / 60)
      const min    = m % 60
      const period = h >= 12 ? 'PM' : 'AM'
      const h12    = h % 12 || 12
      const timeLabel  = `${h12}:${String(min).padStart(2, '0')} ${period}`
      const dateLabel  = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const isoTime    = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`

      slots.push({ label: `${dateLabel} at ${timeLabel}`, datetime: `${dateStr}T${isoTime}` })
    }
  }

  if (slots.length === 0) {
    return `No available slots in the next two weeks for ${serviceName}. Offer to take a message or check a different week. ${mechanicName} will follow up.`
  }

  const slotLabels = slots.map(s => s.label).join(', ')
  return `Available slots for ${serviceName}: ${slotLabels}. Ask which time works best for the caller.`
}

// ── book_appointment ───────────────────────────────────────────────────────────

async function handleBookAppointment(
  vapiCallId: string | undefined,
  params: {
    customer_name:        string
    customer_phone?:      string
    vehicle_info?:        string
    service_type:         string
    appointment_datetime: string
  },
): Promise<string> {
  const svc = createServiceClient()

  const userId = await getUserIdFromCallId(svc, vapiCallId)
  if (!userId) {
    return "Unable to identify the account. Tell the caller you'll have someone follow up to confirm their booking."
  }

  // Parse ISO datetime
  const isoMatch = params.appointment_datetime.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/)
  let jobDate: string
  let jobTime: string

  if (isoMatch) {
    jobDate = isoMatch[1]
    jobTime = isoMatch[2]
  } else {
    const parsed = new Date(params.appointment_datetime)
    if (isNaN(parsed.getTime())) {
      return "Booking failed: couldn't read that date and time. Ask the caller to confirm the date and time again, then call book_appointment once more."
    }
    jobDate = toDateStr(parsed)
    jobTime = `${String(parsed.getHours()).padStart(2, '0')}:${String(parsed.getMinutes()).padStart(2, '0')}`
  }

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
    const [eh, em]  = String(job.job_time).slice(0, 5).split(':').map(Number)
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

  // Parse vehicle info: "2018 Honda Civic" → year, make, model
  let vehicleYear: number | null  = null
  let vehicleMake: string | null  = null
  let vehicleModel: string | null = null

  if (params.vehicle_info) {
    const parts  = params.vehicle_info.trim().split(/\s+/)
    const yearN  = parseInt(parts[0], 10)
    if (!isNaN(yearN) && yearN > 1900 && yearN < 2100) {
      vehicleYear  = yearN
      vehicleMake  = parts[1] ?? null
      vehicleModel = parts.slice(2).join(' ') || null
    } else {
      vehicleMake  = parts[0] ?? null
      vehicleModel = parts.slice(1).join(' ') || null
    }
  }

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

  // Create vehicle
  let vehicleId: string | null = null
  if (vehicleMake) {
    const { data: vehicle } = await svc
      .from('vehicles')
      .insert({ customer_id: customerId, year: vehicleYear, make: vehicleMake, model: vehicleModel ?? '' })
      .select('id')
      .single()
    vehicleId = vehicle?.id ?? null
  }

  // Create job
  const { data: job, error: jobErr } = await svc
    .from('jobs')
    .insert({
      user_id:                    userId,
      customer_id:                customerId,
      vehicle_id:                 vehicleId,
      job_date:                   jobDate,
      job_time:                   jobTime,
      service_type:               serviceName,
      status:                     'scheduled',
      estimated_duration_minutes: duration,
      notes:                      'Booked by Foreman AI receptionist.',
      sms_consent:                rawPhone.length >= 10,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    console.error('[book_appointment] job insert error:', jobErr)
    return "Booking failed: trouble saving the appointment. Tell the caller you'll have someone follow up to confirm."
  }

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

  // SMS to mechanic (fire-and-forget)
  if (settings?.mechanic_phone) {
    const body = `Foreman booked: ${firstName} ${lastName} · ${serviceName} · ${dateLabel} at ${timeLabel}${rawPhone.length >= 10 ? ' · ' + params.customer_phone : ''} — NWI Suite`
    sendSubscriberSms({ to: settings.mechanic_phone, body }).catch(e =>
      console.error('[book_appointment] mechanic SMS error:', e),
    )
  }

  // SMS confirmation to customer (fire-and-forget)
  if (params.customer_phone && rawPhone.length >= 10) {
    const biz  = settings?.business_name ?? 'your mechanic'
    const body = `Appointment confirmed with ${biz}: ${serviceName} on ${dateLabel} at ${timeLabel}. See you then! — National Wrench Index`
    sendSubscriberSms({ to: params.customer_phone, body }).catch(e =>
      console.error('[book_appointment] customer SMS error:', e),
    )
  }

  const longDateLabel = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const smsNote = rawPhone.length >= 10 ? ' Customer will receive SMS confirmation shortly.' : ''
  return `Appointment booked. Job ID: ${job.id}. ${serviceName} confirmed for ${longDateLabel} at ${timeLabel}.${smsNote}`
}

// ── end-of-call-report: log call, notify mechanic ─────────────────────────────

async function handleEndOfCall(message: VapiMessage): Promise<void> {
  const svc  = createServiceClient()
  const call = message.call ?? {}

  const vapiCallId = call.id
  if (!vapiCallId) {
    console.warn('[vapi end-of-call] no call.id in event')
    return
  }

  const startedAt = call.startedAt ? new Date(call.startedAt) : null
  const endedAt   = call.endedAt   ? new Date(call.endedAt)   : null
  const durationSeconds = startedAt && endedAt
    ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
    : null

  const summary      = message.summary      ?? null
  const recordingUrl = call.recordingUrl    ?? null

  // Look up the in-progress row
  const { data: existingCall } = await svc
    .from('foreman_calls')
    .select('user_id, appointment_booked, caller_phone')
    .eq('vapi_call_id', vapiCallId)
    .single()

  if (!existingCall) {
    console.warn('[vapi end-of-call] no foreman_calls row for callId:', vapiCallId)
    console.warn('[vapi end-of-call] cannot determine user_id — skipping record creation')
    return
  }

  const outcome      = existingCall.appointment_booked ? 'booked' : 'no_booking'
  const callerName   = extractCallerName(summary)
  const callerPhone  = call.customer?.number ?? existingCall.caller_phone ?? null

  await svc
    .from('foreman_calls')
    .update({
      call_duration_seconds: durationSeconds,
      call_summary:          summary,
      recording_url:         recordingUrl,
      status:                'completed',
      outcome,
      caller_name:           callerName,
      caller_phone:          callerPhone,
    })
    .eq('vapi_call_id', vapiCallId)

  // Notify mechanic
  const { data: settings } = await svc
    .from('foreman_settings')
    .select('mechanic_phone, mechanic_first_name')
    .eq('user_id', existingCall.user_id)
    .single()

  if (settings?.mechanic_phone) {
    const dur        = durationSeconds != null ? `${Math.round(durationSeconds / 60)}m` : '—'
    const outcomeStr = existingCall.appointment_booked ? 'booked a job' : 'did not book'
    const snippet    = summary ? ` "${summary.slice(0, 80).trim()}${summary.length > 80 ? '…' : ''}"` : ''
    const smsBody    = `Foreman call: ${outcomeStr} (${dur}).${snippet} — View at nationalwrenchindex.com`
    sendSubscriberSms({ to: settings.mechanic_phone, body: smsBody }).catch(e =>
      console.error('[end-of-call] mechanic SMS error:', e),
    )
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserIdFromCallId(
  svc: ReturnType<typeof createServiceClient>,
  vapiCallId: string | undefined,
): Promise<string | null> {
  if (!vapiCallId) return null
  const { data } = await svc
    .from('foreman_calls')
    .select('user_id')
    .eq('vapi_call_id', vapiCallId)
    .single()
  return data?.user_id ?? null
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
