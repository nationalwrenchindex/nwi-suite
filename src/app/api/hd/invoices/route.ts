import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { logHDCustomer } from '@/lib/hd/customer-logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const { data, error } = await supabase
    .from('hd_invoices')
    .select('id, invoice_number, customer_name, unit_manufacturer, unit_model, total, status, payment_terms, created_at, paid_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invoices: data })
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

  // company_name is a customers-table field, not an hd_invoices column.
  const { company_name, ...invoiceBody } = body

  const { count } = await supabase
    .from('hd_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  const invoice_number = `INV-${year}-${seq}`

  const { data, error } = await supabase
    .from('hd_invoices')
    .insert({ ...invoiceBody, user_id: user.id, invoice_number })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-log the customer into the tech's contacts (best-effort, never blocks).
  const customer_id = await logHDCustomer({
    userId:        user.id,
    customerName:  typeof body.customer_name  === 'string' ? body.customer_name  : null,
    customerPhone: typeof body.customer_phone === 'string' ? body.customer_phone : null,
    customerEmail: typeof body.customer_email === 'string' ? body.customer_email : null,
    companyName:   typeof company_name        === 'string' ? company_name        : null,
  })

  return NextResponse.json({ invoice: data, customer_id }, { status: 201 })
}
