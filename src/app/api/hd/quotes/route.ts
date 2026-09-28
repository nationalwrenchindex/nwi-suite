import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { logHDCustomer } from '@/lib/hd/customer-logging'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'
import { addressFrom } from '@/lib/address'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_quotes')
    .select('id, quote_number, customer_name, unit_manufacturer, unit_model, total, status, created_at, valid_until')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ quotes: data })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  if (!body.customer_name) {
    return NextResponse.json({ error: 'customer_name required' }, { status: 400 })
  }

  // company_name is a customers-table field, not an hd_quotes column — pull it
  // out of the insert body and use it only for customer logging. customer_id is
  // resolved separately via logHDCustomer and is not an hd_quotes column either.
  const { company_name, customer_id: _customerId, ...quoteBody } = body
  void _customerId

  const { count } = await supabase
    .from('hd_quotes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  const quote_number = `Q-${year}-${seq}`

  const quoteRow = { ...quoteBody, user_id: user.id, quote_number }

  let { data, error } = await supabase
    .from('hd_quotes')
    .insert(quoteRow)
    .select()
    .single()

  // Migration 140 is applied by hand and a preview deploy runs against the same
  // database, so there is a window where this writes tax_breakdown and the column
  // does not exist yet. The quote is complete without it -- tax_amount and the total
  // are already correct -- so retry rather than cost the tech the quote they typed.
  if (error && isMissingTaxBreakdownColumn(error)) {
    console.error('[hd/quotes] tax_breakdown missing — run migration 140', error.message)
    ;({ data, error } = await supabase
      .from('hd_quotes')
      .insert(withoutTaxBreakdown(quoteRow))
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-log the customer into the tech's contacts (best-effort, never blocks).
  const customer_id = await logHDCustomer({
    userId:        user.id,
    customerName:  typeof body.customer_name  === 'string' ? body.customer_name  : null,
    customerPhone: typeof body.customer_phone === 'string' ? body.customer_phone : null,
    customerEmail: typeof body.customer_email === 'string' ? body.customer_email : null,
    companyName:   typeof company_name        === 'string' ? company_name        : null,
    // Carry the address onto the customer so the NEXT document for this customer
    // prefills it. Without this the prefill has nothing to read.
    address:       addressFrom(body),
  })

  return NextResponse.json({ quote: data, customer_id }, { status: 201 })
}
