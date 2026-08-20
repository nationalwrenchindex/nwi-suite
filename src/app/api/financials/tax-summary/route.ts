import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { TaxMonthRow } from '@/types/financials'

// LD invoices carry two status columns. The legacy `status` enum is stale — invoices
// that have been finalized and sent still read 'draft' there — so the lifecycle column
// `invoice_status` (migration 012) is the authoritative one.
// Issued = locked in and owed to the state; 'in_progress' and 'void' are excluded.
const LD_ISSUED = ['finalized', 'awaiting_payment', 'paid']

// HD invoices have no draft state — every row is a real invoice — so only voids drop out.
const HD_ISSUED = ['unpaid', 'sent', 'paid', 'partial', 'overdue']

function pad2(n: number) { return String(n).padStart(2, '0') }

// Every month between two YYYY-MM-DD dates, inclusive, so zero-activity months
// still appear as rows rather than silently collapsing the table.
function monthsBetween(fromDate: string, toDate: string): string[] {
  const out: string[] = []
  const [fy, fm] = fromDate.split('-').map(Number)
  const [ty, tm] = toDate.split('-').map(Number)
  let y = fy, m = fm
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${pad2(m)}`)
    if (++m > 12) { m = 1; y++ }
  }
  return out
}

// ─── GET /api/financials/tax-summary ──────────────────────────────────────────
// Query params:
//   from_date + to_date (YYYY-MM-DD) — defaults to Jan 1 of the current year → today
// Returns tax collected per month across both LD and HD invoices, plus period totals.
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp  = request.nextUrl.searchParams
  const now = new Date()
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`

  const fromDate = sp.get('from_date') ?? `${now.getFullYear()}-01-01`
  const toDate   = sp.get('to_date')   ?? today

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return NextResponse.json({ error: 'from_date and to_date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (fromDate > toDate) {
    return NextResponse.json({ error: 'from_date must not be after to_date' }, { status: 400 })
  }

  const [ldResult, hdResult] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, subtotal, tax_amount, invoice_date')
      .eq('user_id', user.id)
      .in('invoice_status', LD_ISSUED)
      .gte('invoice_date', fromDate)
      .lte('invoice_date', toDate),

    // hd_invoices has no invoice_date column, so the issue date is created_at.
    supabase
      .from('hd_invoices')
      .select('id, subtotal_labor, subtotal_parts, diagnostic_fee, road_call_fee, tax_amount, created_at')
      .eq('user_id', user.id)
      .in('status', HD_ISSUED)
      .gte('created_at', `${fromDate}T00:00:00.000Z`)
      .lte('created_at', `${toDate}T23:59:59.999Z`),
  ])

  if (ldResult.error) return NextResponse.json({ error: ldResult.error.message }, { status: 500 })
  if (hdResult.error) return NextResponse.json({ error: hdResult.error.message }, { status: 500 })

  const monthMap = new Map<string, { invoice_count: number; taxable_amount: number; tax_collected: number }>()
  for (const m of monthsBetween(fromDate, toDate)) {
    monthMap.set(m, { invoice_count: 0, taxable_amount: 0, tax_collected: 0 })
  }

  let ld_tax = 0
  let hd_tax = 0

  // LD: tax_amount = subtotal × tax_rate, so the taxable base is subtotal.
  for (const inv of ldResult.data ?? []) {
    const bucket = monthMap.get(String(inv.invoice_date).slice(0, 7))
    if (!bucket) continue
    const tax = Number(inv.tax_amount ?? 0)
    bucket.invoice_count++
    bucket.taxable_amount += Number(inv.subtotal ?? 0)
    bucket.tax_collected  += tax
    ld_tax += tax
  }

  // HD: taxable base mirrors the invoice form — labor + parts + diagnostic + road call.
  for (const inv of hdResult.data ?? []) {
    const bucket = monthMap.get(String(inv.created_at).slice(0, 7))
    if (!bucket) continue
    const tax = Number(inv.tax_amount ?? 0)
    bucket.invoice_count++
    bucket.taxable_amount += Number(inv.subtotal_labor  ?? 0)
                          +  Number(inv.subtotal_parts  ?? 0)
                          +  Number(inv.diagnostic_fee  ?? 0)
                          +  Number(inv.road_call_fee   ?? 0)
    bucket.tax_collected  += tax
    hd_tax += tax
  }

  const round2 = (n: number) => Math.round(n * 100) / 100

  const rows: TaxMonthRow[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month,
      invoice_count:  m.invoice_count,
      taxable_amount: round2(m.taxable_amount),
      tax_collected:  round2(m.tax_collected),
    }))

  return NextResponse.json({
    tax_summary: {
      from_date:      fromDate,
      to_date:        toDate,
      rows,
      invoice_count:  rows.reduce((s, r) => s + r.invoice_count,  0),
      taxable_amount: round2(rows.reduce((s, r) => s + r.taxable_amount, 0)),
      tax_collected:  round2(rows.reduce((s, r) => s + r.tax_collected,  0)),
      ld_tax:         round2(ld_tax),
      hd_tax:         round2(hd_tax),
    },
  })
}
