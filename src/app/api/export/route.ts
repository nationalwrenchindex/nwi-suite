import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/supabase/fetch-all'

// PostgREST caps every response at 1,000 rows and still answers 200, so each
// list below is paged to exhaustion. An unpaged export silently ships a short file.
const PAGE_SIZE = 500

// `.in()` travels in the query string, so a customer list past a few hundred ids
// blows the URL length limit once the customers query itself is unbounded.
const IN_CHUNK = 200

interface CustomerRow { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }
interface VehicleRow  { id: string; customer_id: string; year: number | null; make: string; model: string; vin: string | null }
interface JobRow {
  id: string; job_date: string; job_time: string | null; service_type: string; status: string
  customer_id: string | null; vehicle_id: string | null
  actual_labor_minutes: number | null; suggested_labor_minutes: number | null; drive_minutes: number | null
  notes: string | null
}
interface InvoiceRow {
  id: string; invoice_date: string; customer_id: string | null; invoice_number: string
  total: number | string; status: string; line_items: unknown
}
interface ExpenseRow { id: string; expense_date: string; category: string; amount: number | string; description: string; vendor: string | null }
interface QuoteRow {
  created_at: string; vehicle_year: number | null; vehicle_make: string | null; vehicle_model: string | null
  vin: string | null; job_name: string | null; parts_total: number | null; labor_hours: number | null
  labor_total: number | null; grand_total: number | null; customer_name: string | null; status: string | null
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id

  try {
    // Each query keeps the ordering it already had, plus `id` as a tiebreaker:
    // range paging needs a TOTAL order, and a date column alone leaves ties free
    // to shuffle between pages, which duplicates some rows and drops others.
    const [customers, jobs, invoices, expenses, qwQuotes] = await Promise.all([
      fetchAllRows<CustomerRow>((from, to) => supabase.from('customers')
        .select('id, first_name, last_name, phone, email')
        .eq('user_id', uid)
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE),

      fetchAllRows<JobRow>((from, to) => supabase.from('jobs')
        .select('id, job_date, job_time, service_type, status, customer_id, vehicle_id, actual_labor_minutes, suggested_labor_minutes, drive_minutes, notes')
        .eq('user_id', uid)
        .order('job_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE),

      fetchAllRows<InvoiceRow>((from, to) => supabase.from('invoices')
        .select('id, invoice_date, customer_id, invoice_number, total, status, line_items')
        .eq('user_id', uid)
        .order('invoice_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE),

      fetchAllRows<ExpenseRow>((from, to) => supabase.from('expenses')
        .select('id, expense_date, category, amount, description, vendor')
        .eq('user_id', uid)
        .order('expense_date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE),

      fetchAllRows<QuoteRow>((from, to) => supabase.from('quickwrench_quotes')
        .select('created_at, vehicle_year, vehicle_make, vehicle_model, vin, job_name, parts_total, labor_hours, labor_total, grand_total, customer_name, status')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE),
    ])

    const customerIds = customers.map(c => c.id)
    const vehicles: VehicleRow[] = []
    // Two limits apply here: the id list has to stay short enough to fit in a
    // URL, and each chunk's own result set can still exceed 1,000 rows.
    for (const ids of chunk(customerIds, IN_CHUNK)) {
      const rows = await fetchAllRows<VehicleRow>((from, to) => supabase
        .from('vehicles')
        .select('id, customer_id, year, make, model, vin')
        .in('customer_id', ids)
        .order('id', { ascending: true })
        .range(from, to), PAGE_SIZE)
      vehicles.push(...rows)
    }

    // Build lookup maps
    const customerMap: Record<string, { first_name: string; last_name: string }> = {}
    for (const c of customers) customerMap[c.id] = c

    const vehicleMap: Record<string, { year: number | null; make: string; model: string }> = {}
    for (const v of vehicles) vehicleMap[v.id] = { year: v.year, make: v.make, model: v.model }

    const vehicleCountByCustomer: Record<string, number> = {}
    for (const v of vehicles) {
      vehicleCountByCustomer[v.customer_id] = (vehicleCountByCustomer[v.customer_id] ?? 0) + 1
    }

    return NextResponse.json({
      customers: customers.map(c => ({
        Name:          `${c.first_name} ${c.last_name}`,
        Phone:         c.phone ?? '',
        Email:         c.email ?? '',
        'Vehicle Count': vehicleCountByCustomer[c.id] ?? 0,
      })),
      vehicles: vehicles.map(v => ({
        Year:          v.year ?? '',
        Make:          v.make,
        Model:         v.model,
        VIN:           v.vin ?? '',
        'Customer Name': customerMap[v.customer_id]
          ? `${customerMap[v.customer_id].first_name} ${customerMap[v.customer_id].last_name}`
          : '',
      })),
      jobs: jobs.map(j => ({
        Date:                j.job_date,
        Time:                j.job_time ?? '',
        Customer:            j.customer_id && customerMap[j.customer_id]
          ? `${customerMap[j.customer_id].first_name} ${customerMap[j.customer_id].last_name}`
          : '',
        Vehicle:             j.vehicle_id && vehicleMap[j.vehicle_id]
          ? `${vehicleMap[j.vehicle_id].year} ${vehicleMap[j.vehicle_id].make} ${vehicleMap[j.vehicle_id].model}`
          : '',
        Service:             j.service_type,
        Status:              j.status,
        'Labor Time (min)':  j.suggested_labor_minutes ?? '',
        'Actual Time (min)': j.actual_labor_minutes ?? '',
        'Drive Time (min)':  j.drive_minutes ?? '',
        Notes:               j.notes ?? '',
      })),
      invoices: invoices.map(i => ({
        'Invoice #':   i.invoice_number,
        Date:          i.invoice_date,
        Customer:      i.customer_id && customerMap[i.customer_id]
          ? `${customerMap[i.customer_id].first_name} ${customerMap[i.customer_id].last_name}`
          : '',
        Total:         `$${Number(i.total).toFixed(2)}`,
        Status:        i.status,
        'Line Items':  Array.isArray(i.line_items)
          ? i.line_items.map((li: { description?: string; total?: number }) =>
              `${li.description ?? ''}${li.total != null ? ` ($${Number(li.total).toFixed(2)})` : ''}`
            ).join(' | ')
          : '',
      })),
      expenses: expenses.map(e => ({
        Date:        e.expense_date,
        Category:    e.category,
        Amount:      `$${Number(e.amount).toFixed(2)}`,
        Description: e.description,
        Vendor:      e.vendor ?? '',
      })),
      quickwrench_quotes: qwQuotes.map(q => ({
        Date:       q.created_at.slice(0, 10),
        Vehicle:    [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(' '),
        VIN:        q.vin ?? '',
        Service:    q.job_name ?? '',
        'Parts ($)': q.parts_total != null ? `$${Number(q.parts_total).toFixed(2)}` : '',
        'Labor (hrs)': q.labor_hours ?? '',
        'Total ($)': q.grand_total != null ? `$${Number(q.grand_total).toFixed(2)}` : '',
        Customer:   q.customer_name ?? '',
        Status:     q.status ?? '',
      })),
    })
  } catch (err) {
    // Better a failed export than a quietly short one.
    const message = err instanceof Error ? err.message : 'Export failed'
    console.error('[export] load failed:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
