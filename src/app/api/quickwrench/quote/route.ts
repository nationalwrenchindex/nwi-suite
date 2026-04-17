// POST /api/quickwrench/quote
// Saves a completed QuickWrench quote to quickwrench_quotes table.
// Optionally creates a draft invoice in the invoices table.
// Optionally sends an SMS to the customer via Twilio.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { QuoteSaveRequest } from '@/types/quickwrench'

function pad2(n: number) { return String(n).padStart(2, '0') }

function genQuoteNumber() {
  const d   = new Date()
  const yy  = String(d.getFullYear()).slice(2)
  const mm  = pad2(d.getMonth() + 1)
  const dd  = pad2(d.getDate())
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase()
  return `QW-${yy}${mm}${dd}-${rnd}`
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dueDateISO(daysOut = 14) {
  const d = new Date()
  d.setDate(d.getDate() + daysOut)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

async function sendSMS(to: string, body: string) {
  const sid   = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from  = process.env.TWILIO_PHONE_NUMBER
  if (!sid || !token || !from) return

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const params = new URLSearchParams({ To: to, From: from, Body: body })

  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: QuoteSaveRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const {
    vehicle, job, parts,
    parts_total, labor_hours, labor_rate, labor_total,
    markup_percent, tax_amount, grand_total,
    customer_name, customer_phone,
    send_sms, save_invoice,
  } = body

  // ── Save quote record ──────────────────────────────────────────────────────
  const { data: quote, error: quoteErr } = await supabase
    .from('quickwrench_quotes')
    .insert({
      user_id:        user.id,
      vin:            vehicle.vin || null,
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
      customer_name:  customer_name || null,
      customer_phone: customer_phone || null,
      status:         'draft',
    })
    .select()
    .single()

  if (quoteErr) {
    console.error('[quote] insert failed:', quoteErr)
    return NextResponse.json({ error: 'Failed to save quote.' }, { status: 500 })
  }

  // ── Optionally create draft invoice ───────────────────────────────────────
  let invoiceId: string | null = null
  if (save_invoice) {
    const lineItems = [
      ...parts
        .filter((p) => p.included)
        .map((p) => {
          const supplierPrice =
            p.selected_supplier === 'autozone'  ? p.price_autozone  :
            p.selected_supplier === 'orielly'   ? p.price_orielly   :
            p.selected_supplier === 'napa'      ? p.price_napa      :
            p.selected_supplier === 'rockauto'  ? p.price_rockauto  :
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

    const subtotal = lineItems.reduce((s, li) => s + li.total, 0)
    const taxRate  = subtotal > 0 ? (tax_amount / subtotal) * 100 : 0
    const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

    const { data: inv, error: invErr } = await supabase
      .from('invoices')
      .insert({
        user_id:        user.id,
        invoice_number: genQuoteNumber(),
        invoice_date:   todayISO(),
        due_date:       dueDateISO(14),
        customer_id:    null,
        job_id:         null,
        line_items:     lineItems,
        subtotal:       Math.round(subtotal * 100) / 100,
        tax_rate:       Math.round(taxRate * 100) / 100,
        tax_amount:     Math.round(tax_amount * 100) / 100,
        discount:       0,
        total:          Math.round(grand_total * 100) / 100,
        status:         'draft',
        notes:          customer_name
          ? `Customer: ${customer_name}${customer_phone ? ` · ${customer_phone}` : ''}\nVehicle: ${vehicleLabel}`
          : `Vehicle: ${vehicleLabel}`,
        terms:          null,
      })
      .select('id')
      .single()

    if (!invErr && inv) invoiceId = inv.id
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
      const bizName = profile?.business_name ?? 'Your technician'

      const fmt = (n: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

      const message = [
        `Hi ${customer_name || 'there'}, here's your service quote from ${bizName}:`,
        '',
        `Vehicle: ${vehicleLabel}`,
        `Service: ${job.name}`,
        '',
        `Parts:  ${fmt(parts_total)}`,
        `Labor:  ${fmt(labor_total)} (${labor_hours}h @ ${fmt(labor_rate)}/hr)`,
        `Tax:    ${fmt(tax_amount)}`,
        `TOTAL:  ${fmt(grand_total)}`,
        '',
        'Reply YES to confirm. Thank you!',
      ].join('\n')

      await sendSMS(customer_phone, message)
      smsSent = true
    } catch (err) {
      console.warn('[quote] SMS failed (non-fatal):', err)
    }
  }

  return NextResponse.json({ quote, invoiceId, smsSent })
}
