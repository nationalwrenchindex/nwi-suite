import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkHDStarterAccess } from '@/lib/hd-access'
import { CATEGORY_ITEMS, itemLabel } from '@/lib/hd/dot-categories'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const hasAccess = await checkHDStarterAccess(user.id)
    if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

    let body: {
      unit_id?: string
      work_order_id?: string
      fleet_account_id?: string
      inspection_date: string
      inspector_name?: string
      inspector_cert_number?: string
      odometer_hours?: string
      location?: string
      carrier_address?: string
      license_plate?: string
      inspection_data: Record<string, { items: Record<string, { result: string; notes: string }> }>
      signature_data?: string
      customer_name?: string
      unit_manufacturer?: string
      unit_model?: string
      unit_serial?: string
      invoice_id?: string
      invoice_action?: string
    }

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    if (!body.inspection_date || !body.inspection_data) {
      return NextResponse.json({ error: 'inspection_date and inspection_data required' }, { status: 400 })
    }

    // Derive overall result from item-level results
    const overallResult = Object.values(body.inspection_data).some(cat =>
      Object.values(cat.items ?? {}).some(item => item.result === 'fail')
    ) ? 'fail' : 'pass'

    // Build violations list at item level
    const violations: {
      category: string
      item: string
      label: string
      notes: string
      safetyCritical: boolean
    }[] = []

    for (const [catId, catData] of Object.entries(body.inspection_data)) {
      for (const [itemId, itemData] of Object.entries(catData.items ?? {})) {
        if (itemData.result === 'fail') {
          const itemDef = CATEGORY_ITEMS[catId]?.find(i => i.id === itemId)
          violations.push({
            category: catId,
            item: itemId,
            label: itemLabel(catId, itemId),
            notes: itemData.notes ?? '',
            safetyCritical: itemDef?.safetyCritical ?? false,
          })
        }
      }
    }

    // ── Resolve the invoice link: existing / create-new / standalone ──
    let linkedInvoiceId: string | null = null
    let invoiceError: string | null = null
    if (body.invoice_action === 'existing' && typeof body.invoice_id === 'string') {
      linkedInvoiceId = body.invoice_id
    } else if (body.invoice_action === 'create') {
      let customerPhone: string | null = null
      let customerEmail: string | null = null
      if (body.fleet_account_id) {
        const { data: fa } = await supabase
          .from('hd_fleet_accounts')
          .select('contact_phone, contact_email')
          .eq('id', body.fleet_account_id)
          .eq('user_id', user.id)
          .maybeSingle()
        customerPhone = (fa?.contact_phone as string | null) ?? null
        customerEmail = (fa?.contact_email as string | null) ?? null
      }
      const { count } = await supabase
        .from('hd_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
      const invoiceNumber = `INV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, '0')}`

      // Labor rate from the tech's profile; DOT Annual Inspection = 2.0 hrs.
      const { data: rateRow } = await supabase
        .from('profiles')
        .select('hd_labor_rate')
        .eq('id', user.id)
        .maybeSingle()
      const laborRate = Number(rateRow?.hd_labor_rate ?? 125)
      const hours     = 2.0
      const amount    = Math.round(hours * laborRate * 100) / 100

      const laborLine = {
        id: crypto.randomUUID(), type: 'labor',
        description: 'DOT Annual Inspection',
        book_hours: hours, mobile_hours: hours,
        part_number: '', quantity: 0, unit_cost: 0, amount,
      }
      const { data: newInv, error: invErr } = await supabase
        .from('hd_invoices')
        .insert({
          user_id:           user.id,
          invoice_number:    invoiceNumber,
          // Fleet Pro linkage — without these the invoice never reaches the
          // customer's portal, even though the inspection itself does.
          unit_id:           body.unit_id ?? null,
          fleet_account_id:  body.fleet_account_id ?? null,
          customer_name:     body.customer_name || 'Fleet Customer',
          customer_phone:    customerPhone,
          customer_email:    customerEmail,
          unit_manufacturer: body.unit_manufacturer ?? null,
          unit_model:        body.unit_model ?? null,
          unit_serial:       body.unit_serial ?? null,
          line_items:        [laborLine],
          labor_rate:        laborRate,
          subtotal_labor:    amount,
          subtotal_parts:    0,
          total:             amount,
          status:            'unpaid',
          notes:             `Auto-created from DOT inspection on ${new Date().toISOString().slice(0, 10)}`,
        })
        .select('id')
        .single()
      if (invErr) { console.error('[dot-inspections] invoice create failed', invErr); invoiceError = invErr.message }
      else linkedInvoiceId = newInv?.id ?? null
    }

    const dateStr     = body.inspection_date.replace(/-/g, '')
    const suffix      = Math.random().toString(36).substring(2, 8).toUpperCase()
    const inspectionId = `DOT-${dateStr}-${suffix}`

    const { data, error } = await supabase
      .from('hd_dot_inspections')
      .insert({
        user_id:               user.id,
        unit_id:               body.unit_id ?? null,
        work_order_id:         body.work_order_id ?? null,
        fleet_account_id:      body.fleet_account_id ?? null,
        inspection_date:       body.inspection_date,
        inspector_name:        body.inspector_name ?? null,
        inspector_cert_number: body.inspector_cert_number ?? null,
        odometer_hours:        body.odometer_hours ?? null,
        location:              body.location ?? null,
        carrier_address:       body.carrier_address ?? null,
        license_plate:         body.license_plate ?? null,
        inspection_data:       body.inspection_data,
        violations:            violations.length > 0 ? violations : null,
        overall_result:        overallResult,
        signature_data:        body.signature_data ?? null,
        customer_name:         body.customer_name ?? null,
        unit_manufacturer:     body.unit_manufacturer ?? null,
        unit_model:            body.unit_model ?? null,
        unit_serial:           body.unit_serial ?? null,
        invoice_id:            linkedInvoiceId ?? body.invoice_id ?? null,
        locked:                true,
        locked_at:             new Date().toISOString(),
        inspection_id:         inspectionId,
      })
      .select('id, inspection_id')
      .single()

    if (error) {
      console.error('[dot-inspections] Insert error', error)
      return NextResponse.json({ error: 'Failed to save inspection' }, { status: 500 })
    }

    return NextResponse.json({ id: data.id, inspection_id: data.inspection_id, invoice_id: linkedInvoiceId, invoice_error: invoiceError })
  } catch (err) {
    console.error('[dot-inspections] Unhandled error', err)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
