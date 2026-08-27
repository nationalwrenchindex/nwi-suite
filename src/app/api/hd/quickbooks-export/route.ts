import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDAccess } from '@/lib/hd-access'
import type { QBInvoice, QBLineItem } from '@/lib/hd/quickbooks-export'

export const dynamic = 'force-dynamic'

// hd_invoices has no invoice_date column — created_at is the issue date.
const INVOICE_COLUMNS = `
  id, invoice_number, customer_name, created_at, due_date, payment_terms,
  line_items, subtotal_labor, subtotal_parts, diagnostic_fee, road_call_fee,
  tax_amount, total, status
`

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function pad2(n: number) { return String(n).padStart(2, '0') }

// The day AFTER to_date, as a UTC midnight timestamp. The range is queried as
// [from 00:00Z, next-midnight) rather than `lte to_date` so invoices stamped later in
// the day on to_date are not truncated off the end of the range.
function nextMidnightUTC(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}T00:00:00.000Z`
}

// ─── GET /api/hd/quickbooks-export ────────────────────────────────────────────
// Query params: from_date + to_date (YYYY-MM-DD), defaulting to the current year to date.
// Returns the caller's invoices with parsed line items; the client builds the IIF/CSV.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const hasAccess = await checkHDAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  const sp    = req.nextUrl.searchParams
  const now   = new Date()
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  const fromDate = sp.get('from_date') ?? `${now.getFullYear()}-01-01`
  const toDate   = sp.get('to_date')   ?? today

  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate)) {
    return NextResponse.json({ error: 'from_date and to_date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'from_date must not be after to_date' }, { status: 400 })
  }

  const [{ data: rows, error }, { data: profile }] = await Promise.all([
    supabase
      .from('hd_invoices')
      .select(INVOICE_COLUMNS)
      .eq('user_id', user.id)
      .gte('created_at', `${fromDate}T00:00:00.000Z`)
      .lt('created_at', nextMidnightUTC(toDate))
      .order('created_at', { ascending: true }),

    supabase
      .from('profiles')
      .select('business_name')
      .eq('id', user.id)
      .maybeSingle(),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Voids are dropped in JS rather than with `.neq('status', 'void')`, because PostgREST's
  // neq is SQL `<>` — it evaluates to NULL for a NULL status and quietly discards those
  // rows. Legacy hd_invoices with a NULL status are real unpaid invoices and belong in the
  // export. Same reasoning as the explicit status allow-list in /api/financials/tax-summary.
  const invoices: QBInvoice[] = (rows ?? [])
    .map(r => r as unknown as Omit<QBInvoice, 'line_items'> & { line_items: unknown })
    .filter(r => r.status !== 'void')
    .map(r => ({
      id:             r.id,
      invoice_number: r.invoice_number,
      customer_name:  r.customer_name,
      created_at:     r.created_at,
      due_date:       r.due_date,
      payment_terms:  r.payment_terms,
      subtotal_labor: r.subtotal_labor,
      subtotal_parts: r.subtotal_parts,
      diagnostic_fee: r.diagnostic_fee,
      road_call_fee:  r.road_call_fee,
      tax_amount:     r.tax_amount,
      total:          r.total,
      status:         r.status,
      // line_items is JSONB. Supabase hands back a parsed value, but older rows were
      // written as a JSON string, so both shapes are normalised to an array here.
      line_items:     parseLineItems(r.line_items),
    }))

  const total = invoices.reduce((s, inv) => s + Number(inv.total ?? 0), 0)

  return NextResponse.json({
    company_name:  profile?.business_name ?? null,
    from_date:     fromDate,
    to_date:       toDate,
    invoice_count: invoices.length,
    total:         Math.round(total * 100) / 100,
    invoices,
  })
}

function parseLineItems(value: unknown): QBLineItem[] {
  if (Array.isArray(value)) return value as QBLineItem[]
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed as QBLineItem[] : []
    } catch {
      return []
    }
  }
  return []
}
