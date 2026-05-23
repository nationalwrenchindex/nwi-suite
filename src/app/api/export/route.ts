import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id

  const [
    { data: customers },
    { data: jobs },
    { data: invoices },
    { data: expenses },
    { data: qwQuotes },
  ] = await Promise.all([
    supabase.from('customers')
      .select('id, first_name, last_name, phone, email')
      .eq('user_id', uid),
    supabase.from('jobs')
      .select('id, job_date, job_time, service_type, status, customer_id, vehicle_id, actual_labor_minutes, suggested_labor_minutes, drive_minutes, notes')
      .eq('user_id', uid)
      .order('job_date', { ascending: false }),
    supabase.from('invoices')
      .select('id, invoice_date, customer_id, invoice_number, total, status, line_items')
      .eq('user_id', uid)
      .order('invoice_date', { ascending: false }),
    supabase.from('expenses')
      .select('id, expense_date, category, amount, description, vendor')
      .eq('user_id', uid)
      .order('expense_date', { ascending: false }),
    supabase.from('quickwrench_quotes')
      .select('created_at, vehicle_year, vehicle_make, vehicle_model, vin, job_name, parts_total, labor_hours, labor_total, grand_total, customer_name, status')
      .eq('user_id', uid)
      .order('created_at', { ascending: false }),
  ])

  const customerIds = (customers ?? []).map(c => c.id)
  let vehicles: { id: string; customer_id: string; year: number | null; make: string; model: string; vin: string | null }[] = []
  if (customerIds.length > 0) {
    const { data } = await supabase
      .from('vehicles')
      .select('id, customer_id, year, make, model, vin')
      .in('customer_id', customerIds)
    vehicles = data ?? []
  }

  // Build lookup maps
  const customerMap: Record<string, { first_name: string; last_name: string }> = {}
  for (const c of customers ?? []) customerMap[c.id] = c

  const vehicleMap: Record<string, { year: number | null; make: string; model: string }> = {}
  for (const v of vehicles) vehicleMap[v.id] = { year: v.year, make: v.make, model: v.model }

  const vehicleCountByCustomer: Record<string, number> = {}
  for (const v of vehicles) {
    vehicleCountByCustomer[v.customer_id] = (vehicleCountByCustomer[v.customer_id] ?? 0) + 1
  }

  return NextResponse.json({
    customers: (customers ?? []).map(c => ({
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
    jobs: (jobs ?? []).map(j => ({
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
    invoices: (invoices ?? []).map(i => ({
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
    expenses: (expenses ?? []).map(e => ({
      Date:        e.expense_date,
      Category:    e.category,
      Amount:      `$${Number(e.amount).toFixed(2)}`,
      Description: e.description,
      Vendor:      e.vendor ?? '',
    })),
    quickwrench_quotes: (qwQuotes ?? []).map(q => ({
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
}
