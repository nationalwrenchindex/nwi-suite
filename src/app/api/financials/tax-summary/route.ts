import { NextResponse, type NextRequest } from 'next/server'
import { parseBreakdown, isMissingTaxBreakdownColumn } from '@/lib/tax'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetch-all'
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

  // A tax year runs to thousands of invoices, and PostgREST silently truncates at
  // 1,000 rows — which would under-report tax owed to the state. Both sides are paged
  // to exhaustion, ordered by `id` so the range windows walk a stable sequence.
  // tax_breakdown only exists after migration 140, so each side has a "with" and a
  // "without" variant and the select strings are written out literally in both.
  // A template literal in .select() defeats Supabase's type inference entirely and
  // collapses the row type to a ParserError, so the duplication buys working types.
  const fetchLD = () => fetchAllRows((from, to) =>
    supabase
      .from('invoices')
      .select('id, subtotal, tax_amount, invoice_date, tax_breakdown')
      .eq('user_id', user.id)
      .in('invoice_status', LD_ISSUED)
      .gte('invoice_date', fromDate)
      .lte('invoice_date', toDate)
      .order('id', { ascending: true })
      .range(from, to)
  )
  const fetchLDLegacy = () => fetchAllRows((from, to) =>
    supabase
      .from('invoices')
      .select('id, subtotal, tax_amount, invoice_date')
      .eq('user_id', user.id)
      .in('invoice_status', LD_ISSUED)
      .gte('invoice_date', fromDate)
      .lte('invoice_date', toDate)
      .order('id', { ascending: true })
      .range(from, to)
  )

  // hd_invoices has no invoice_date column, so the issue date is created_at.
  const fetchHD = () => fetchAllRows((from, to) =>
    supabase
      .from('hd_invoices')
      .select('id, subtotal_labor, subtotal_parts, diagnostic_fee, road_call_fee, tax_amount, created_at, tax_breakdown')
      .eq('user_id', user.id)
      .in('status', HD_ISSUED)
      .gte('created_at', `${fromDate}T00:00:00.000Z`)
      .lte('created_at', `${toDate}T23:59:59.999Z`)
      .order('id', { ascending: true })
      .range(from, to)
  )
  const fetchHDLegacy = () => fetchAllRows((from, to) =>
    supabase
      .from('hd_invoices')
      .select('id, subtotal_labor, subtotal_parts, diagnostic_fee, road_call_fee, tax_amount, created_at')
      .eq('user_id', user.id)
      .in('status', HD_ISSUED)
      .gte('created_at', `${fromDate}T00:00:00.000Z`)
      .lte('created_at', `${toDate}T23:59:59.999Z`)
      .order('id', { ascending: true })
      .range(from, to)
  )

  // The two variants differ only by one optional key, so both read through one shape.
  type LdRow = {
    subtotal: number | string | null
    tax_amount: number | string | null
    invoice_date: string
    tax_breakdown?: unknown
  }
  type HdRow = {
    subtotal_labor: number | string | null
    subtotal_parts: number | string | null
    diagnostic_fee: number | string | null
    road_call_fee: number | string | null
    tax_amount: number | string | null
    created_at: string
    tax_breakdown?: unknown
  }
  let ldInvoices: LdRow[]
  let hdInvoices: HdRow[]

  try {
    const [ld, hd] = await Promise.all([fetchLD(), fetchHD()])
    ldInvoices = ld as unknown as LdRow[]
    hdInvoices = hd as unknown as HdRow[]
  } catch (err) {
    if (!isMissingTaxBreakdownColumn(err)) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Failed to load tax summary' },
        { status: 500 },
      )
    }
    // Pre-140. Every invoice then counts toward unsplit_tax, which is the honest
    // answer: none of them recorded which part of its subtotal was parts.
    console.error('[tax-summary] tax_breakdown missing — run migration 140')
    try {
      const [ld, hd] = await Promise.all([fetchLDLegacy(), fetchHDLegacy()])
      ldInvoices = ld as unknown as LdRow[]
      hdInvoices = hd as unknown as HdRow[]
    } catch (retryErr) {
      return NextResponse.json(
        { error: retryErr instanceof Error ? retryErr.message : 'Failed to load tax summary' },
        { status: 500 },
      )
    }
  }

  const monthMap = new Map<string, { invoice_count: number; taxable_amount: number; tax_collected: number }>()
  for (const m of monthsBetween(fromDate, toDate)) {
    monthMap.set(m, { invoice_count: 0, taxable_amount: 0, tax_collected: 0 })
  }

  let ld_tax = 0
  let hd_tax = 0

  // Broken out by what the tax was assessed ON, which is the split a filing actually
  // asks for. Only invoices written after migration 140 carry a breakdown; anything
  // older contributes to unsplit_tax instead of being guessed at, because a pre-140
  // invoice genuinely does not record which part of its subtotal was parts.
  let tax_on_parts    = 0
  let tax_on_labor    = 0
  let tax_on_services = 0
  let unsplit_tax     = 0
  let untaxed_labor   = 0

  function accumulateSplit(raw: unknown, totalTax: number) {
    const b = parseBreakdown(raw)
    if (!b) { unsplit_tax += totalTax; return }
    tax_on_parts    += b.parts?.amount    ?? 0
    tax_on_labor    += b.labor?.amount    ?? 0
    tax_on_services += b.services?.amount ?? 0
    // The exempt base is worth reporting on its own: it is the number that answers
    // "how much labor did we sell without charging tax on it".
    if (b.labor && !b.labor.taxed) untaxed_labor += b.labor.base
  }

  // LD: tax_amount = subtotal × tax_rate, so the taxable base is subtotal.
  for (const inv of ldInvoices) {
    const bucket = monthMap.get(String(inv.invoice_date).slice(0, 7))
    if (!bucket) continue
    const tax = Number(inv.tax_amount ?? 0)
    bucket.invoice_count++
    bucket.taxable_amount += Number(inv.subtotal ?? 0)
    bucket.tax_collected  += tax
    ld_tax += tax
    accumulateSplit(inv.tax_breakdown, tax)
  }

  // HD: taxable base mirrors the invoice form — labor + parts + diagnostic + road call.
  for (const inv of hdInvoices) {
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
    accumulateSplit(inv.tax_breakdown, tax)
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
      tax_on_parts:    round2(tax_on_parts),
      tax_on_labor:    round2(tax_on_labor),
      tax_on_services: round2(tax_on_services),
      // Tax from invoices that predate the parts/labor split. Reported separately
      // rather than folded into parts, so the three figures above always add up to
      // tax_collected minus this, and nothing is silently miscategorised on a return.
      unsplit_tax:     round2(unsplit_tax),
      untaxed_labor:   round2(untaxed_labor),
    },
  })
}
