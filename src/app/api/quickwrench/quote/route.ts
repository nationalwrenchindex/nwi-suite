// POST /api/quickwrench/quote
// Saves a completed QuickWrench quote.
// When save_invoice=true, creates a real draft invoice in Financials with
// customer/vehicle lookup-or-create, sequential invoice number, and source tracking.

import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuoteSaveRequest } from '@/types/quickwrench'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pad2(n: number) { return String(n).padStart(2, '0') }

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dueDateISO(daysOut = 14) {
  const d = new Date()
  d.setDate(d.getDate() + daysOut)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// Sequential INV-YYYY-XXXX numbering, scoped per user per calendar year.
async function genInvoiceNumber(supabase: SupabaseClient, userId: string): Promise<string> {
  const year   = new Date().getFullYear()
  const prefix = `INV-${year}-`

  const { data } = await supabase
    .from('invoices')
    .select('invoice_number')
    .eq('user_id', userId)
    .like('invoice_number', `${prefix}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)

  let seq = 1
  if (data && data.length > 0) {
    const parts  = data[0].invoice_number.split('-')
    const parsed = parseInt(parts[parts.length - 1], 10)
    if (!isNaN(parsed)) seq = parsed + 1
  }

  return `${prefix}${String(seq).padStart(4, '0')}`
}

// Looks up a customer by phone, or creates one if not found.
// Returns null if neither name nor phone is provided (walk-up, no info).
async function resolveCustomer(
  supabase: SupabaseClient,
  userId:  string,
  name:    string,
  phone:   string,
): Promise<string | null> {
  if (!name.trim() && !phone.trim()) return null

  // Try to find by exact phone match first
  if (phone.trim()) {
    const { data } = await supabase
      .from('customers')
      .select('id')
      .eq('user_id', userId)
      .eq('phone', phone.trim())
      .limit(1)
    if (data && data.length > 0) return data[0].id
  }

  // Create new customer record
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

// Looks up a vehicle by VIN across this user's customers.
// Creates a new vehicle record if VIN not found and we have a customer.
async function resolveVehicle(
  supabase:   SupabaseClient,
  userId:     string,
  vin:        string | null | undefined,
  vehicleData: { year: string; make: string; model: string; trim?: string; engine?: string },
  customerId: string | null,
): Promise<string | null> {
  if (!vin) return null

  // Collect all customer IDs for this user
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

  // No existing vehicle — create one if we have a customer to attach it to
  if (!customerId) return null

  const yearInt = vehicleData.year ? parseInt(vehicleData.year, 10) : null
  const { data: created } = await supabase
    .from('vehicles')
    .insert({
      customer_id: customerId,
      year:        yearInt && yearInt >= 1900 && yearInt <= 2100 ? yearInt : null,
      make:        vehicleData.make,
      model:       vehicleData.model,
      trim:        vehicleData.trim  || null,
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
      vin:            vehicle.vin   || null,
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

  if (quoteErr) {
    console.error('[quote] insert failed:', quoteErr)
    return NextResponse.json({ error: 'Failed to save quote.' }, { status: 500 })
  }

  // ── Optionally create draft invoice ───────────────────────────────────────
  let invoiceId:     string | null = null
  let invoiceNumber: string | null = null

  if (save_invoice) {
    // Resolve customer and vehicle records
    const customerId = await resolveCustomer(supabase, user.id, customer_name ?? '', customer_phone ?? '')
    const vehicleId  = await resolveVehicle(supabase, user.id, vehicle.vin, vehicle, customerId)

    const invNum = await genInvoiceNumber(supabase, user.id)

    const lineItems = [
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

    const subtotal    = lineItems.reduce((s, li) => s + li.total, 0)
    const taxRate     = subtotal > 0 ? (tax_amount / subtotal) * 100 : 0
    const vehicleLabel = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

    let notes = `Vehicle: ${vehicleLabel}`
    if (vehicle.vin)          notes += ` (VIN: ${vehicle.vin})`
    if (customer_name?.trim()) notes += `\nCustomer: ${customer_name.trim()}`
    if (customer_phone?.trim()) notes += customer_name?.trim() ? ` · ${customer_phone.trim()}` : `\nPhone: ${customer_phone.trim()}`

    const { data: inv, error: invErr } = await supabase
      .from('invoices')
      .insert({
        user_id:         user.id,
        invoice_number:  invNum,
        invoice_date:    todayISO(),
        due_date:        dueDateISO(14),
        customer_id:     customerId,
        vehicle_id:      vehicleId,
        job_id:          null,
        line_items:      lineItems,
        subtotal:        Math.round(subtotal * 100) / 100,
        tax_rate:        Math.round(taxRate * 100) / 100,
        tax_amount:      Math.round(tax_amount * 100) / 100,
        discount_amount: 0,
        total:           Math.round(grand_total * 100) / 100,
        status:          'draft',
        source:          'quickwrench',
        job_category:    job.categoryLabel,
        job_subtype:     job.name,
        notes,
        terms:           null,
      })
      .select('id')
      .single()

    if (invErr) {
      console.error('[quote] invoice insert failed:', invErr)
      // Non-fatal — quote was already saved; return partial success
    } else if (inv) {
      invoiceId     = inv.id
      invoiceNumber = invNum
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

  return NextResponse.json({ quote, invoiceId, invoiceNumber, smsSent })
}
