import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// ─── P&L helpers ─────────────────────────────────────────────────────────────

function r2(n: number) { return Math.round(n * 100) / 100 }

interface InvoiceForBreakdown {
  total: number
  tax_amount: number
  shop_supplies: Array<{ qty: number; unit_cost: number; total: number }> | null
  additional_parts: Array<{ qty: number; unit_cost: number; total: number }> | null
  additional_labor: Array<{ subtotal: number }> | null
  source_quote: {
    parts_subtotal: number | null
    parts_markup_percent: number | null
    labor_subtotal: number | null
  } | null
}

function calcBreakdown(inv: InvoiceForBreakdown) {
  const sq        = inv.source_quote
  const markupPct = Number(sq?.parts_markup_percent ?? 0)

  // Parts
  const quotedPartsCost        = Number(sq?.parts_subtotal ?? 0)
  const additionalParts        = Array.isArray(inv.additional_parts) ? inv.additional_parts : []
  const additionalPartsCost    = additionalParts.reduce((s, p) => s + p.unit_cost * p.qty, 0)
  const totalPartsCost         = r2(quotedPartsCost + additionalPartsCost)
  const quotedPartsRevenue     = r2(quotedPartsCost * (1 + markupPct / 100))
  const additionalPartsRevenue = additionalParts.reduce((s, p) => s + p.total, 0)
  const partsGrossProfit       = r2((quotedPartsRevenue + additionalPartsRevenue) - totalPartsCost)

  // Labor
  const additionalLabor        = Array.isArray(inv.additional_labor) ? inv.additional_labor : []
  const quotedLaborSubtotal    = Number(sq?.labor_subtotal ?? 0)
  const laborIncome            = r2(quotedLaborSubtotal + additionalLabor.reduce((s, l) => s + l.subtotal, 0))

  // Shop supplies (no markup — cost = charged amount)
  const shopSupplies           = Array.isArray(inv.shop_supplies) ? inv.shop_supplies : []
  const shopSuppliesTotal      = r2(shopSupplies.reduce((s, ss) => s + ss.total, 0))

  // COGS
  const cogsTotal  = r2(totalPartsCost + shopSuppliesTotal)
  const taxAmount  = Number(inv.tax_amount ?? 0)
  const grandTotal = Number(inv.total ?? 0)
  const netProfit  = r2(grandTotal - cogsTotal - taxAmount)

  return {
    parts_cost:          totalPartsCost,
    labor_income:        laborIncome,
    shop_supplies_total: shopSuppliesTotal,
    parts_gross_profit:  partsGrossProfit,
    cogs_total:          cogsTotal,
    net_profit:          netProfit,
  }
}

const INVOICE_SELECT = `
  *,
  customer:customers(id, first_name, last_name, phone, email),
  vehicle:vehicles(id, year, make, model, vin),
  source_quote:quotes!invoices_source_quote_id_fkey(id, quote_number, line_items, labor_hours, labor_rate, parts_subtotal, parts_markup_percent, labor_subtotal, tax_percent, tax_amount, grand_total)
`

// ─── GET /api/invoices/[id] ───────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  const { data, error } = await supabase
    .from('invoices')
    .select(INVOICE_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  return NextResponse.json({ invoice: data })
}

// ─── PATCH /api/invoices/[id] ────────────────────────────────────────────────
// Body: { payment_instructions: string }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  let body: Record<string, unknown>
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if ('payment_instructions' in body) updates.payment_instructions = body.payment_instructions ?? null

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'Update failed.' }, { status: 500 })
  }

  return NextResponse.json({ invoice: data })
}

// ─── PUT /api/invoices/[id] ───────────────────────────────────────────────────
// Body: { status: 'paid' | 'unpaid' | 'overdue', payment_method?: string }
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { status, payment_method, payment_reference, payment_notes } = body as {
    status?: string
    payment_method?: string
    payment_reference?: string | null
    payment_notes?: string | null
  }

  if (!status) {
    return NextResponse.json({ error: 'status is required' }, { status: 400 })
  }

  // 'unpaid' is a UI-friendly alias for 'sent' (outstanding but not past due)
  const dbStatus = status === 'unpaid' ? 'sent' : status

  const validStatuses = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled']
  if (!validStatuses.includes(dbStatus)) {
    return NextResponse.json(
      { error: 'status must be one of: paid, unpaid, overdue, draft, sent, viewed, cancelled' },
      { status: 400 }
    )
  }

  const updates: Record<string, unknown> = { status: dbStatus }

  if (dbStatus === 'paid') {
    updates.paid_at        = new Date().toISOString()
    updates.invoice_status = 'paid'
    if (payment_method)                updates.payment_method    = payment_method
    if (payment_reference !== undefined) updates.payment_reference = payment_reference ?? null
    if (payment_notes     !== undefined) updates.payment_notes     = payment_notes     ?? null
  } else {
    // Revert paid fields when un-marking as paid
    updates.paid_at = null
    if (dbStatus !== 'sent') updates.payment_method = null
    if (dbStatus === 'cancelled') updates.invoice_status = 'void'
  }

  const { data, error } = await supabase
    .from('invoices')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(INVOICE_SELECT)
    .single()

  if (error) {
    console.error('[PUT /api/invoices/[id]]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // ── Phase 6: Auto-Financial Breakdown ─────────────────────────────────────
  // Runs exactly once per invoice when it is first marked paid.
  // financials_posted acts as an idempotency guard.
  const inv = data as Record<string, unknown>
  if (dbStatus === 'paid' && !inv.financials_posted) {
    try {
      const bd         = calcBreakdown(inv as unknown as InvoiceForBreakdown)
      const paidDate   = new Date().toISOString().slice(0, 10)
      const invNumber  = String(inv.invoice_number ?? id)

      const expenseInserts: Record<string, unknown>[] = []

      if (bd.parts_cost > 0) {
        expenseInserts.push({
          user_id:           user.id,
          expense_date:      paidDate,
          category:          'parts_cogs',
          description:       `Parts cost for ${invNumber}`,
          amount:            bd.parts_cost,
          linked_invoice_id: id,
          transaction_type:  'auto_invoice',
        })
      }

      if (bd.shop_supplies_total > 0) {
        expenseInserts.push({
          user_id:           user.id,
          expense_date:      paidDate,
          category:          'shop_supplies',
          description:       `Shop supplies for ${invNumber}`,
          amount:            bd.shop_supplies_total,
          linked_invoice_id: id,
          transaction_type:  'auto_invoice',
        })
      }

      if (expenseInserts.length > 0) {
        await supabase.from('expenses').insert(expenseInserts)
      }

      await supabase
        .from('invoices')
        .update({
          cogs_total:           bd.cogs_total,
          labor_income:         bd.labor_income,
          shop_supplies_total:  bd.shop_supplies_total,
          parts_gross_profit:   bd.parts_gross_profit,
          net_profit:           bd.net_profit,
          financials_posted:    true,
          financials_posted_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', user.id)

      // Re-fetch so response reflects posted P&L fields
      const { data: refreshed } = await supabase
        .from('invoices')
        .select(INVOICE_SELECT)
        .eq('id', id)
        .eq('user_id', user.id)
        .single()

      if (refreshed) return NextResponse.json({ invoice: refreshed })
    } catch (breakdownErr) {
      console.error('[PUT /api/invoices/[id]] breakdown error', breakdownErr)
      // Still return the paid invoice — breakdown failure should not block payment confirmation
    }
  }

  return NextResponse.json({ invoice: data })
}
