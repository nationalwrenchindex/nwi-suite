import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import { logHDCustomer } from '@/lib/hd/customer-logging'
import { missingMigration142Column, withoutMigration142Columns } from '@/lib/migration-142'
import { isMissingTaxBreakdownColumn, withoutTaxBreakdown } from '@/lib/tax'
import { addressFrom } from '@/lib/address'

export const dynamic = 'force-dynamic'

/**
 * True when the write failed only because hd_quotes.customer_id is not there yet.
 *
 * Narrow on purpose, and separate from missingMigration142Column: that helper
 * leaves customer_id out of its strip list so an LD invoice cannot be orphaned by
 * a retry, which means this one table needs its own check.
 */
function isMissingHdQuoteCustomerId(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown }
  const text = String(e.message ?? '').toLowerCase()
  const looksMissing =
    text.includes('does not exist') ||
    text.includes('could not find') ||
    text.includes('schema cache') ||
    String(e.code ?? '') === 'PGRST204' ||
    String(e.code ?? '') === '42703'
  return looksMissing && text.includes('customer_id')
}

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

  // company_name is a customers-table field, not an hd_quotes column — pull it out
  // of the insert body and use it only for customer logging.
  //
  // customer_id USED TO BE DISCARDED HERE. hd_invoices got one in migration 118;
  // hd_quotes did not, so the route resolved a customer, returned the id to the
  // caller, and threw it away rather than storing it. A quote could not be found
  // from a customer record and the customer could not be corrected from the quote.
  // Migration 142 adds the column.
  const { company_name, customer_id: clientCustomerId, ...quoteBody } = body

  const { count } = await supabase
    .from('hd_quotes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  const year = new Date().getFullYear()
  const seq = String((count ?? 0) + 1).padStart(4, '0')
  const quote_number = `Q-${year}-${seq}`

  // RESOLVED BEFORE THE INSERT, so the id can actually be written. It was after it.
  //
  // Still best-effort: wrapped, because a contacts failure must not cost the tech
  // the quote they just typed. A null customer_id is the old behaviour, which is
  // a quote that saves without a link rather than a quote that does not save.
  let customer_id: string | null = null
  try {
    customer_id = await logHDCustomer({
      userId:        user.id,
      customerName:  typeof body.customer_name  === 'string' ? body.customer_name  : null,
      customerPhone: typeof body.customer_phone === 'string' ? body.customer_phone : null,
      customerEmail: typeof body.customer_email === 'string' ? body.customer_email : null,
      companyName:   typeof company_name        === 'string' ? company_name        : null,
      // Carry the address onto the customer so the NEXT document for this customer
      // prefills it. Without this the prefill has nothing to read.
      address:       addressFrom(body),
    })
  } catch (err) {
    console.error('[hd/quotes] customer logging failed, saving the quote without a link:',
      err instanceof Error ? err.message : String(err))
  }
  // A caller that already knows the customer wins over the resolver — it had a real
  // selection, the resolver only had a name and a phone number to match on.
  const linkedCustomerId =
    (typeof clientCustomerId === 'string' && clientCustomerId) || customer_id || null

  const quoteRow = { ...quoteBody, user_id: user.id, quote_number, customer_id: linkedCustomerId }

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

  // Migration 142 adds hd_quotes.customer_id and is applied by hand, so there is a
  // window where this writes a column that does not exist.
  //
  // customer_id IS STRIPPED EXPLICITLY, not through withoutMigration142Columns.
  // That helper deliberately leaves customer_id alone, because invoices.customer_id
  // and hd_invoices.customer_id have existed since migrations 001 and 118 and
  // stripping the name globally would orphan an LD invoice on any retry. hd_quotes
  // is the one table where the column really is new, so it is handled here.
  if (error && isMissingHdQuoteCustomerId(error)) {
    console.error('[hd/quotes] customer_id missing — run migration 142', error.message)
    const { customer_id: _drop, ...withoutLink } = withoutMigration142Columns(withoutTaxBreakdown(quoteRow))
    void _drop
    ;({ data, error } = await supabase
      .from('hd_quotes')
      .insert(withoutLink)
      .select()
      .single())
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ quote: data, customer_id: linkedCustomerId }, { status: 201 })
}
