import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { checkHDAccess } from '@/lib/hd-access'

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

  const {
    unit_id, work_order_id, pm_type,
    invoice_action, invoice_id,
    checklist_data, safety_initials, safety_acknowledged,
    safety_acknowledged_at, alarm_codes_found, alarm_codes_cleared,
    battery_cca, flagged_items, signature_base64, tech_name,
  } = body

  if (!pm_type) return NextResponse.json({ error: 'pm_type required' }, { status: 400 })

  const svc = createServiceClient()

  // ── Resolve the invoice link: existing / create-new / standalone ──
  let linkedInvoiceId: string | null = null
  if (invoice_action === 'existing' && typeof invoice_id === 'string') {
    linkedInvoiceId = invoice_id
  } else if (invoice_action === 'create') {
    // Pull unit + fleet-account details to auto-populate the invoice.
    let customerName = 'Fleet Customer'
    let customerPhone: string | null = null
    let customerEmail: string | null = null
    let unitRow: { manufacturer?: string; model?: string; serial_number?: string; year?: number | null } | null = null
    if (unit_id) {
      const { data: unit } = await svc
        .from('hd_units')
        .select('manufacturer, model, serial_number, year, fleet_account_id')
        .eq('id', unit_id)
        .eq('user_id', user.id)
        .single()
      unitRow = unit ?? null
      if (unit?.fleet_account_id) {
        const { data: fa } = await svc
          .from('hd_fleet_accounts')
          .select('fleet_name, contact_phone, contact_email')
          .eq('id', unit.fleet_account_id)
          .single()
        if (fa?.fleet_name) customerName = fa.fleet_name as string
        customerPhone = (fa?.contact_phone as string | null) ?? null
        customerEmail = (fa?.contact_email as string | null) ?? null
      }
    }

    const { count } = await svc
      .from('hd_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, '0')}`

    const laborLine = {
      id: crypto.randomUUID(),
      type: 'labor',
      description: `Preventive Maintenance — ${pm_type}`,
      mobile_hours: 0, part_number: '', quantity: 0, unit_cost: 0, amount: 0,
    }

    const { data: newInv, error: invErr } = await svc
      .from('hd_invoices')
      .insert({
        user_id:           user.id,
        invoice_number:    invoiceNumber,
        customer_name:     customerName,
        customer_phone:    customerPhone,
        customer_email:    customerEmail,
        unit_manufacturer: unitRow?.manufacturer ?? null,
        unit_model:        unitRow?.model ?? null,
        unit_serial:       unitRow?.serial_number ?? null,
        unit_year:         unitRow?.year != null ? String(unitRow.year) : null,
        line_items:        [laborLine],
        status:            'unpaid',
        notes:             `Auto-created from PM checklist (${pm_type}) on ${new Date().toISOString().slice(0, 10)}`,
      })
      .select('id')
      .single()

    if (invErr) {
      console.error('[hd/pm-checklist] invoice create failed', invErr)
    } else {
      linkedInvoiceId = newInv?.id ?? null
    }
  }

  // Save checklist record
  const { data: checklist, error } = await svc
    .from('hd_pm_checklists')
    .insert({
      user_id:               user.id,
      unit_id:               unit_id ?? null,
      work_order_id:         work_order_id ?? null,
      invoice_id:            linkedInvoiceId,
      pm_type,
      checklist_data:        checklist_data ?? {},
      safety_acknowledged:   safety_acknowledged ?? false,
      safety_acknowledged_at: safety_acknowledged_at ?? null,
      safety_initials:       safety_initials ?? null,
      alarm_codes_found:     alarm_codes_found ?? null,
      alarm_codes_cleared:   alarm_codes_cleared ?? null,
      battery_cca:           battery_cca ?? null,
      flagged_items:         flagged_items ?? null,
      signature_base64:      signature_base64 ?? null,
      tech_name:             tech_name ?? null,
      completed_at:          new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    console.error('[hd/pm-checklist]', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Update unit with PM completion details
  if (unit_id) {
    const PM_INTERVALS: Record<string, number> = {
      dry:                1500,
      '3000hr':           3000,
      full_belts_trailer: 3000,
      full_belts_truck:   3000,
      '12month':          3000,
      '24month':          3000,
    }
    const interval    = PM_INTERVALS[pm_type as string] ?? 3000
    const today       = new Date().toISOString().slice(0, 10)

    const { data: unit } = await svc
      .from('hd_units')
      .select('total_hours')
      .eq('id', unit_id)
      .eq('user_id', user.id)
      .single()

    const currentHours  = Number(unit?.total_hours ?? 0)
    const nextPmHours   = currentHours + interval

    await svc.from('hd_units').update({
      last_pm_date:      today,
      last_pm_hours:     currentHours,
      last_pm_type:      pm_type,
      next_pm_due_hours: nextPmHours,
    }).eq('id', unit_id).eq('user_id', user.id)
  }

  // Mark work order in_progress → completed if linked
  if (work_order_id) {
    await svc.from('hd_work_orders')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', work_order_id)
      .eq('user_id', user.id)
      .eq('status', 'in_progress')
  }

  return NextResponse.json({ ok: true, id: checklist.id, invoice_id: linkedInvoiceId })
}
