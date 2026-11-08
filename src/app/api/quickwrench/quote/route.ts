// POST /api/quickwrench/quote
// Saves a completed QuickWrench quote.
// Creates a record in the quotes table (not invoices — that happens at Phase 3 conversion).
// When send_sms=true, sets status='sent', records sent_at, and fires an SMS.
//
// THE MONEY IS PRICED HERE, through lib/quickwrench-money -> lib/document-money, under
// the shop's settings read server-side (lib/document-defaults): shop supplies, drive time
// and mileage per the billing method picker, the service call fee taxed per its setting,
// the tax split into a parts and a labor bucket. The request carries only what the tech
// typed - rates, hours, miles, prices, the fee. It used to store the client's totals as
// sent, which never had supplies, travel, mileage or a service call in them, with
// tax_percent back-derived from the total and parts_subtotal holding the store cost.
//
// THE CUSTOMER AND THE VEHICLE ARE REAL RECORDS. The customer is the one QuickWrench
// already saved to Intel Hub when it sends its id; the vehicle decoded from the VIN is
// that customer's own vehicle row, found or created, and is attached to the quote - so
// the work order made from it has its unit and the invoice carries it. This used to
// reuse ANY vehicle in the shop with that VIN, whoever owned it, leaving the customer
// with no vehicle at all.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuoteSaveRequest } from '@/types/quickwrench'
import { money } from '@/lib/format'
import type { MultiJobEntry } from '@/types/quickwrench'
import { splitCustomerName } from '@/lib/customer-name'
import { loadDocumentDefaults } from '@/lib/document-defaults.server'
import { newDocumentServiceCall } from '@/lib/document-defaults'
import { quickwrenchMoney, partsCostTotal, type QwJob } from '@/lib/quickwrench-money'
import { readLaborEstimate } from '@/lib/labor-estimate'

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Sequential QT-YYYY-XXXX numbering, scoped per user per calendar year.
async function genQuoteNumber(supabase: SupabaseClient, userId: string): Promise<string> {
  const year   = new Date().getFullYear()
  const prefix = `QT-${year}-`

  const { data } = await supabase
    .from('quotes')
    .select('quote_number')
    .eq('user_id', userId)
    .like('quote_number', `${prefix}%`)
    .order('quote_number', { ascending: false })
    .limit(1)

  let seq = 1
  if (data && data.length > 0) {
    const parts  = data[0].quote_number.split('-')
    const parsed = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(parsed)) seq = parsed + 1
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}

// The quote's customer: the one QuickWrench already saved (its id, checked to be this
// shop's), else a match on phone, else a new one - named exactly as typed, never with an
// invented surname (lib/customer-name).
async function resolveCustomer(
  supabase:   SupabaseClient,
  userId:     string,
  customerId: string | null | undefined,
  name:       string,
  phone:      string,
): Promise<string | null> {
  if (customerId) {
    const { data } = await supabase.from('customers').select('id').eq('id', customerId).eq('user_id', userId).maybeSingle()
    if (data) return data.id as string
  }
  if (!name.trim() && !phone.trim()) return null

  if (phone.trim()) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .eq('phone', phone.trim())
      .limit(1)
    if (data && data.length > 0) return data[0].id
  }

  const split = splitCustomerName(name)
  const { data: created } = await supabase
    .from('customers')
    // No name at all: "Walk-up", the label for an unnamed customer - and no surname.
    .insert({ user_id: userId, first_name: split?.first_name ?? 'Walk-up', last_name: split?.last_name ?? '', phone: phone.trim() || null })
    .select('id')
    .single()

  return created?.id ?? null
}

// THE CUSTOMER'S OWN vehicle for this VIN: found among that customer's vehicles, else
// created for them from the decode (year, make, model, trim, VIN, engine). Never another
// customer's row - a VIN on file under someone else is a different customer's record of
// the truck, and borrowing it left this customer with no vehicle and an empty picker.
async function resolveVehicle(
  supabase:    SupabaseClient,
  vin:         string | null | undefined,
  vehicleData: { year: string; make: string; model: string; trim?: string; engine?: string },
  customerId:  string | null,
): Promise<string | null> {
  if (!customerId || !vehicleData.make || !vehicleData.model) return null

  if (vin) {
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('customer_id', customerId)
      .eq('vin', vin)
      .limit(1)
    if (existing && existing.length > 0) return existing[0].id
  }

  const yearInt = vehicleData.year ? parseInt(vehicleData.year, 10) : null
  const { data: created, error } = await supabase
    .from('vehicles')
    .insert({
      customer_id: customerId,
      year:        yearInt && yearInt >= 1900 && yearInt <= 2100 ? yearInt : null,
      make:        vehicleData.make,
      model:       vehicleData.model,
      trim:        vehicleData.trim   || null,
      vin:         vin || null,
      engine:      vehicleData.engine || null,
    })
    .select('id')
    .single()
  if (error) console.error('[quickwrench/quote] vehicle insert failed:', error.message)

  return created?.id ?? null
}

// GUARDED 2026-10-08. This route had its OWN Twilio call, so disabling the outreach
// sender did nothing for it. checkSmsAllowed is now the first statement of the local
// sender: it consults do_not_contact and FAILS CLOSED if it cannot read it.
// See src/lib/sms/guard.ts.
async function sendSMS(to: string, body: string) {
  const verdict = await checkSmsAllowed(to)
  if (!verdict.allowed) {
    console.error(`[quickwrench_quote] SMS REFUSED (${verdict.reason}): ${verdict.detail}`)
    return
  }

  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return

  const url    = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const params = new URLSearchParams({ To: to, From: from, Body: body })

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}

// ─── Route handler ────────────────────────────────────────────────────────────

import { checkSmsAllowed, recordSmsSend } from '@/lib/sms/guard'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!await hasQuickWrenchAccess(user.id)) {
    return NextResponse.json({ error: 'QuickWrench requires QuickWrench or Elite plan.' }, { status: 403 })
  }

  let body: QuoteSaveRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const {
    vehicle, job, jobs, extra_labor, parts,
    customer_id, customer_name, customer_phone,
    send_sms, save_quote,
  } = body

  const isMultiJob = Array.isArray(jobs) && jobs.length > 0
  const n0 = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0 }
  const laborRate = n0(body.labor_rate)
  const markupPct = n0(body.markup_percent)

  // The jobs as priced. The single-job legacy request is folded into one job, its
  // supplier price as the store cost, marked up - exactly as it priced before.
  const qwJobs: QwJob[] = isMultiJob
    ? (jobs as MultiJobEntry[]).map(j => ({
        subtype: j.subtype, labor_hours: n0(j.labor_hours), parts: j.parts,
        // An AI estimate the hours started from - re-read, never trusted as sent.
        labor_estimate: readLaborEstimate(j.labor_estimate),
      }))
    : [{
        subtype: job.name, labor_hours: n0(body.labor_hours),
        parts: (parts ?? []).filter(p => p.included).map(p => {
          const supplierPrice =
            // The client sends custom_price only (selected_supplier 'custom'). The legacy
            // branches stay so a request carrying them prices exactly as before.
            (p.selected_supplier === 'autozone' ? p.price_autozone :
             p.selected_supplier === 'orielly'  ? p.price_orielly  :
             p.selected_supplier === 'napa'     ? p.price_napa     :
             p.selected_supplier === 'rockauto' ? p.price_rockauto :
             undefined) ?? p.custom_price
          return { name: p.name, qty: p.qty, unit_cost: supplierPrice, unit_price: supplierPrice * (1 + markupPct / 100) }
        }),
      }]
  const extraLabor = (Array.isArray(extra_labor) ? extra_labor : [])
    .map(el => ({ description: String(el.description ?? ''), hours: n0(el.hours) }))

  // Priced here, under the shop's settings - never the client's totals.
  const defaults = await loadDocumentDefaults(supabase, user.id)
  const qm = quickwrenchMoney({
    jobs: qwJobs, extraLabor, laborRate, markupPct,
    taxPct:         body.tax_percent != null ? n0(body.tax_percent) : defaults.taxPct,
    taxSettings:    defaults.taxSettings,
    defaults,
    travelHours:    n0(body.travel_hours),
    mileageMiles:   n0(body.mileage_miles),
    serviceCallFee: body.service_call_fee != null ? n0(body.service_call_fee) : (newDocumentServiceCall(defaults)?.fee ?? 0),
  })
  const m = qm.money
  const laborHoursTotal = Number(qm.columns.labor_hours ?? 0)
  const partsTotal  = Math.round(m.partsTotal * 100) / 100
  const laborTotal  = Math.round(m.laborSubtotal * 100) / 100
  const costTotal   = partsCostTotal(qwJobs)

  // ── Save raw QuickWrench quote log ─────────────────────────────────────────
  const { data: qwQuote, error: qwErr } = await supabase
    .from('quickwrench_quotes')
    .insert({
      user_id:        user.id,
      vin:            vehicle.vin    || null,
      vehicle_year:   vehicle.year,
      vehicle_make:   vehicle.make,
      vehicle_model:  vehicle.model,
      vehicle_engine: vehicle.engine,
      job_category:   job.category,
      job_name:       job.name,
      parts_list:     parts,
      parts_total:    partsTotal,
      labor_hours:    laborHoursTotal,
      labor_rate:     laborRate,
      labor_total:    laborTotal,
      markup_percent: markupPct,
      tax_amount:     m.taxAmount,
      grand_total:    m.grandTotal,
      customer_name:  customer_name  || null,
      customer_phone: customer_phone || null,
      status:         'draft',
    })
    .select()
    .single()

  if (qwErr) {
    console.error('[quote] quickwrench_quotes insert failed:', qwErr)
    return NextResponse.json({ error: 'Failed to save quote.' }, { status: 500 })
  }

  // ── Create a Quote record ──────────────────────────────────────────────────
  let quoteId:      string | null = null
  let quoteNumber:  string | null = null
  let publicToken:  string | null = null

  if (save_quote || send_sms) {
    const customerId = await resolveCustomer(supabase, user.id, customer_id, customer_name ?? '', customer_phone ?? '')
    const vehicleId  = await resolveVehicle(supabase, vehicle.vin, vehicle, customerId)

    const qtNum = await genQuoteNumber(supabase, user.id)

    const jobCategoryLabel = job.categoryLabel
    const jobSubtype = isMultiJob
      ? (jobs!.length > 1 ? `${jobs!.length} Services` : (jobs as MultiJobEntry[])[0]?.subtype ?? job.name)
      : job.name

    const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
    let notes = `Vehicle: ${vehicleLabel}`
    if (vehicle.vin)           notes += ` (VIN: ${vehicle.vin})`
    if (customer_name?.trim()) notes += `\nCustomer: ${customer_name.trim()}`
    if (customer_phone?.trim()) notes += customer_name?.trim()
      ? ` · ${customer_phone.trim()}`
      : `\nPhone: ${customer_phone.trim()}`

    const quoteStatus  = send_sms ? 'sent' : 'draft'
    const now          = new Date().toISOString()
    publicToken        = send_sms ? crypto.randomUUID().replace(/-/g, '') : null
    const expiresAt    = send_sms
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      : null

    const { data: qt, error: qtErr } = await supabase
      .from('quotes')
      .insert({
        user_id:              user.id,
        quote_number:         qtNum,
        status:               quoteStatus,
        customer_id:          customerId,
        vehicle_id:           vehicleId,
        vehicle_engine:       vehicle.engine || null,
        job_category:         jobCategoryLabel,
        job_subtype:          jobSubtype,
        // Every money column from lib/document-money (lines post-markup with each part's
        // store cost kept, labour hours, the pre-markup parts base, the shop's tax rate,
        // the split, the extras and the service call fee inside the tax and the total).
        ...qm.columns,
        parts_cost_total:     costTotal,
        notes,
        source:               'quickwrench',
        sent_at:              send_sms ? now : null,
        public_token:         publicToken,
        times_sent:           send_sms ? 1 : 0,
        sent_to_phone:        send_sms && customer_phone ? customer_phone.trim() : null,
        quote_expires_at:     expiresAt,
        // Phase 8: multi-job JSONB
        jobs:                 isMultiJob ? (jobs as MultiJobEntry[]).map(j => ({ ...j, labor_rate: laborRate })) : [],
      })
      .select('id')
      .single()

    if (qtErr) {
      console.error('[quote] quotes insert failed:', qtErr)
      // Said, not swallowed: this answered 200 with no quote number, and the tech saw a
      // save that had not happened.
      return NextResponse.json({ error: 'The quote could not be saved: ' + qtErr.message }, { status: 500 })
    } else if (qt) {
      quoteId     = qt.id
      quoteNumber = qtNum
    }
  }

  // ── Optionally send SMS ────────────────────────────────────────────────────
  let smsSent = false
  if (send_sms && customer_phone) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('business_name')
        .eq('id', user.id)
        .single()

      const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')
      const bizName      = profile?.business_name ?? 'Your technician'

      const fmt = (n: number) =>
        money(n)

      const appUrl   = process.env.NEXT_PUBLIC_APP_URL ?? 'https://tools.nationalwrenchindex.com'
      const quoteUrl = publicToken
        ? `${appUrl}/quote/${publicToken}`
        : `${appUrl}/quote`

      const serviceLabel = isMultiJob && jobs && (jobs as import('@/types/quickwrench').MultiJobEntry[]).length > 1
        ? `${(jobs as import('@/types/quickwrench').MultiJobEntry[]).length} services`
        : job.name

      const message = [
        `Hi ${customer_name || 'there'}, here's your service quote from ${bizName}:`,
        '',
        `Vehicle: ${vehicleLabel}`,
        `Service: ${serviceLabel}`,
        '',
        `Parts:  ${fmt(partsTotal)}`,
        `Labor:  ${fmt(laborTotal)} (${laborHoursTotal}h @ ${fmt(laborRate)}/hr)`,
        ...(m.subtotal - partsTotal - laborTotal > 0.004 ? [`Fees:   ${fmt(Math.round((m.subtotal - partsTotal - laborTotal) * 100) / 100)}`] : []),
        `Tax:    ${fmt(m.taxAmount)}`,
        `TOTAL:  ${fmt(m.grandTotal)}`,
        '',
        `View your quote: ${quoteUrl}`,
        '',
        'Reply YES to confirm. Thank you!',
      ].join('\n')

      await sendSMS(customer_phone, message)
      smsSent = true
    } catch (err) {
      // A2P 10DLC may not yet be approved — save the quote anyway, just log the failure
      console.warn('[quote] SMS failed (non-fatal):', err)
    }
  }

  return NextResponse.json({ quote: qwQuote, quoteId, quoteNumber, smsSent })
}
