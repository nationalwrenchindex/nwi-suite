// POST /api/quickwrench/quote
// Saves a completed QuickWrench quote.
// Creates a record in the quotes table (not invoices — that happens at Phase 3 conversion).
// When send_sms=true, sets status='sent', records sent_at, and fires an SMS.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { hasQuickWrenchAccess } from '@/lib/subscription'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuoteSaveRequest } from '@/types/quickwrench'

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

// Looks up a customer by phone, or creates one if not found.
async function resolveCustomer(
  supabase: SupabaseClient,
  userId:  string,
  name:    string,
  phone:   string,
): Promise<string | null> {
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

  const parts     = name.trim().split(/\s+/)
  const firstName = parts[0] || 'Walk-up'
  const lastName  = parts.slice(1).join(' ') || 'Customer'

  const { data: created } = await supabase
    .from('customers')
    .insert({ user_id: userId, first_name: firstName, last_name: lastName, phone: phone.trim() || null })
    .select('id')
    .single()

  return created?.id ?? null
}

// Looks up a vehicle by VIN; creates one if not found and we have a customer.
async function resolveVehicle(
  supabase:    SupabaseClient,
  userId:      string,
  vin:         string | null | undefined,
  vehicleData: { year: string; make: string; model: string; trim?: string; engine?: string },
  customerId:  string | null,
): Promise<string | null> {
  if (!vin) return null

  const { data: customerRows } = await supabase
    .from('customers')
    .select('id')
    .eq('user_id', userId)

  if (customerRows && customerRows.length > 0) {
    const ids = customerRows.map((r: { id: string }) => r.id)
    const { data: existing } = await supabase
      .from('vehicles')
      .select('id')
      .eq('vin', vin)
      .in('customer_id', ids)
      .limit(1)
    if (existing && existing.length > 0) return existing[0].id
  }

  if (!customerId) return null

  const yearInt = vehicleData.year ? parseInt(vehicleData.year, 10) : null
  const { data: created } = await supabase
    .from('vehicles')
    .insert({
      customer_id: customerId,
      year:        yearInt && yearInt >= 1900 && yearInt <= 2100 ? yearInt : null,
      make:        vehicleData.make,
      model:       vehicleData.model,
      trim:        vehicleData.trim   || null,
      vin,
      engine:      vehicleData.engine || null,
    })
    .select('id')
    .single()

  return created?.id ?? null
}

async function sendSMS(to: string, body: string) {
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
    vehicle, job, jobs,
    parts, parts_total, labor_hours, labor_rate, labor_total,
    markup_percent, tax_amount, grand_total,
    customer_name, customer_phone,
    send_sms, save_quote,
  } = body

  const isMultiJob = Array.isArray(jobs) && jobs.length > 0

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
      parts_total,
      labor_hours,
      labor_rate,
      labor_total,
      markup_percent,
      tax_amount,
      grand_total,
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
    const customerId = await resolveCustomer(supabase, user.id, customer_name ?? '', customer_phone ?? '')
    const vehicleId  = await resolveVehicle(supabase, user.id, vehicle.vin, vehicle, customerId)

    const qtNum = await genQuoteNumber(supabase, user.id)

    // ── Build line items and parts subtotal ──────────────────────────────────
    let lineItems: Array<{ description: string; quantity: number; unit_price: number; total: number }>
    let partsSubtotal: number
    let jobCategoryLabel: string
    let jobSubtype: string

    if (isMultiJob && jobs) {
      // Multi-job: build line items grouped by job
      lineItems = []
      partsSubtotal = 0
      for (const j of jobs as import('@/types/quickwrench').MultiJobEntry[]) {
        for (const p of j.parts) {
          lineItems.push({
            description: p.name,
            quantity:    p.qty,
            unit_price:  Math.round(p.unit_price * 100) / 100,
            total:       Math.round(p.unit_price * p.qty * 100) / 100,
          })
          partsSubtotal += p.unit_cost * p.qty
        }
        lineItems.push({
          description: `Labor — ${j.subtype}`,
          quantity:    j.labor_hours,
          unit_price:  j.labor_rate,
          total:       Math.round(j.labor_hours * j.labor_rate * 100) / 100,
        })
      }
      partsSubtotal = Math.round(partsSubtotal * 100) / 100
      jobCategoryLabel = job.categoryLabel
      jobSubtype = jobs.length > 1 ? `${jobs.length} Services` : (jobs as import('@/types/quickwrench').MultiJobEntry[])[0]?.subtype ?? job.name
    } else {
      // Single-job legacy path
      lineItems = [
        ...parts
          .filter((p) => p.included)
          .map((p) => {
            const supplierPrice =
              p.selected_supplier === 'autozone' ? p.price_autozone :
              p.selected_supplier === 'orielly'  ? p.price_orielly  :
              p.selected_supplier === 'napa'     ? p.price_napa     :
              p.selected_supplier === 'rockauto' ? p.price_rockauto :
              p.custom_price
            const unitPrice = supplierPrice * (1 + markup_percent / 100)
            return {
              description: p.name,
              quantity:    p.qty,
              unit_price:  Math.round(unitPrice * 100) / 100,
              total:       Math.round(unitPrice * p.qty * 100) / 100,
            }
          }),
        {
          description: `Labor — ${job.name}`,
          quantity:    labor_hours,
          unit_price:  labor_rate,
          total:       labor_total,
        },
      ]
      partsSubtotal = parts
        .filter(p => p.included)
        .reduce((s, p) => {
          const supplierPrice =
            p.selected_supplier === 'autozone' ? p.price_autozone :
            p.selected_supplier === 'orielly'  ? p.price_orielly  :
            p.selected_supplier === 'napa'     ? p.price_napa     :
            p.selected_supplier === 'rockauto' ? p.price_rockauto :
            p.custom_price
          return s + supplierPrice * p.qty
        }, 0)
      jobCategoryLabel = job.categoryLabel
      jobSubtype = job.name
    }

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
        job_category:         jobCategoryLabel,
        job_subtype:          jobSubtype,
        line_items:           lineItems,
        labor_hours,
        labor_rate,
        parts_subtotal:       Math.round(partsSubtotal * 100) / 100,
        parts_markup_percent: markup_percent,
        labor_subtotal:       Math.round(labor_total * 100) / 100,
        tax_percent:          grand_total > 0
          ? Math.round(((tax_amount / (grand_total - tax_amount)) * 100) * 100) / 100
          : 0,
        tax_amount:           Math.round(tax_amount * 100) / 100,
        grand_total:          Math.round(grand_total * 100) / 100,
        notes,
        source:               'quickwrench',
        sent_at:              send_sms ? now : null,
        public_token:         publicToken,
        times_sent:           send_sms ? 1 : 0,
        sent_to_phone:        send_sms && customer_phone ? customer_phone.trim() : null,
        quote_expires_at:     expiresAt,
        // Phase 8: multi-job JSONB
        jobs:                 isMultiJob ? jobs : [],
      })
      .select('id')
      .single()

    if (qtErr) {
      console.error('[quote] quotes insert failed:', qtErr)
      // Non-fatal — raw log was already saved
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
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

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
        `Parts:  ${fmt(parts_total)}`,
        `Labor:  ${fmt(labor_total)} (${labor_hours}h @ ${fmt(labor_rate)}/hr)`,
        `Tax:    ${fmt(tax_amount)}`,
        `TOTAL:  ${fmt(grand_total)}`,
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
