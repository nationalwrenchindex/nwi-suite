import { NextResponse, type NextRequest } from 'next/server'
import { logHDCustomer } from '@/lib/hd/customer-logging'
import { createClient } from '@/lib/supabase/server'
import {
  EQUIPMENT_FORMS, EQUIPMENT_TYPE_LABEL, EQUIPMENT_INSPECTION_HOURS, isEquipmentType,
} from '@/lib/hd/equipment/forms'
import {
  collectDeficiencies, hasCriticalDeficiency, overallResult, unansweredCount,
  type EquipmentInspectionData, type EquipmentType,
} from '@/types/equipment'

// ─── POST /api/hd/equipment-inspections ──────────────────────────────────────
// Creates a signed, locked construction/heavy-equipment inspection record.
//
// Mirrors the aerial route: everything the client sends about the *result* is
// recomputed here from inspection_data, so a tampered or stale client cannot
// record a pass on a machine that failed.

interface Body {
  equipment_type:   EquipmentType
  unit_id:          string | null
  work_order_id:    string | null
  invoice_id:       string | null
  invoice_action:   'existing' | 'create' | 'none' | null
  inspection_date:  string
  shift:            string | null
  operator_name:    string | null
  operator_cert_current: boolean | null
  unit_identifier:  string | null
  unit_make:        string | null
  unit_model:       string | null
  unit_serial:      string | null
  hour_meter:       number | null
  last_frequent_date: string | null
  last_annual_date:   string | null
  load_test_performed: boolean | null
  load_test_date:      string | null
  load_test_notes:     string | null
  inspection_data:  EquipmentInspectionData
  removed_from_service: boolean
  inspector_name:   string | null
  inspector_cert_number: string | null
  signature_data:   string | null
}

/** Human-readable reference, matching the aerial and DOT conventions. */
const ID_PREFIX: Record<EquipmentType, string> = {
  excavator: 'EXC', mini_excavator: 'MEX', skid_steer: 'SKD', dozer: 'DZR',
  backhoe: 'BHL', trencher: 'TRN', telehandler: 'TLH', forklift: 'FKL',
  crane_frequent: 'CRF', crane_annual: 'CRA', compactor: 'CMP', utv: 'UTV',
}

function makeInspectionId(type: EquipmentType): string {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const rand  = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `${ID_PREFIX[type]}-${stamp}-${rand}`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { checkHDStarterAccess } = await import('@/lib/hd-access')
  const hasAccess = await checkHDStarterAccess(user.id)
  if (!hasAccess) return NextResponse.json({ error: 'HD subscription required' }, { status: 403 })

  let body: Body
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!isEquipmentType(body.equipment_type)) {
    return NextResponse.json({ error: 'Unknown equipment type.' }, { status: 400 })
  }
  const def = EQUIPMENT_FORMS[body.equipment_type]

  const data = body.inspection_data
  if (!data || typeof data !== 'object' || !data.sections) {
    return NextResponse.json({ error: 'Inspection data missing.' }, { status: 400 })
  }
  if (!body.inspection_date) {
    return NextResponse.json({ error: 'Inspection date is required.' }, { status: 400 })
  }
  if (unansweredCount(def, data) > 0) {
    return NextResponse.json({ error: 'Every item must be marked before signing.' }, { status: 400 })
  }
  if (!body.inspector_name?.trim()) {
    return NextResponse.json({ error: 'Inspector name is required.' }, { status: 400 })
  }
  if (!body.signature_data) {
    return NextResponse.json({ error: 'Inspector signature is required.' }, { status: 400 })
  }
  if (def.requiresInspectorCert && !body.inspector_cert_number?.trim()) {
    return NextResponse.json({ error: 'Inspector certification number is required.' }, { status: 400 })
  }

  // Recomputed server-side — never trusted from the client.
  const deficiencies = collectDeficiencies(def, data)
  const result       = overallResult(deficiencies)
  const critical     = hasCriticalDeficiency(deficiencies)

  // A machine with a safety-critical defect may not be operated. The record must
  // not be able to claim otherwise.
  if (critical && !body.removed_from_service) {
    return NextResponse.json(
      { error: 'A safety-critical item failed — removal from service must be confirmed.' },
      { status: 400 },
    )
  }

  // ── Resolve the invoice link: existing / create-new / standalone ──
  // Same flow as the aerial route. A newly created invoice takes its billing
  // identity from the selected unit's fleet account, the only customer context an
  // equipment inspection carries.
  let linkedInvoiceId: string | null = null
  let invoiceError:    string | null = null
  let fleetAccountId:  string | null = null

  if (body.unit_id) {
    const { data: unitRow } = await supabase
      .from('hd_units')
      .select('fleet_account_id')
      .eq('id', body.unit_id)
      .eq('user_id', user.id)
      .maybeSingle()
    fleetAccountId = (unitRow?.fleet_account_id as string | null) ?? null
  }

  if (body.invoice_action === 'existing' && typeof body.invoice_id === 'string') {
    linkedInvoiceId = body.invoice_id
  } else if (body.invoice_action === 'create') {
    let customerName:  string | null = null
    let customerPhone: string | null = null
    let customerEmail: string | null = null
    if (fleetAccountId) {
      const { data: fa } = await supabase
        .from('hd_fleet_accounts')
        .select('fleet_name, contact_phone, contact_email')
        .eq('id', fleetAccountId)
        .eq('user_id', user.id)
        .maybeSingle()
      customerName  = (fa?.fleet_name    as string | null) ?? null
      customerPhone = (fa?.contact_phone as string | null) ?? null
      customerEmail = (fa?.contact_email as string | null) ?? null
    }

    const { count } = await supabase
      .from('hd_invoices')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(4, '0')}`

    const { data: rateRow } = await supabase
      .from('profiles')
      .select('hd_labor_rate')
      .eq('id', user.id)
      .maybeSingle()
    const laborRate = Number(rateRow?.hd_labor_rate ?? 125)
    const hours     = EQUIPMENT_INSPECTION_HOURS[body.equipment_type]
    const amount    = Math.round(hours * laborRate * 100) / 100

    const laborLine = {
      id: crypto.randomUUID(), type: 'labor',
      description: `${EQUIPMENT_TYPE_LABEL[body.equipment_type]} Inspection`,
      book_hours: hours, mobile_hours: hours,
      part_number: '', quantity: 0, unit_cost: 0, amount,
    }

    // Resolve (or create) the customers row before billing, so this invoice has a
    // route back to that customer's no_sms / no_email flags. Without it, an invoice
    // generated from an inspection stays invisible to contact suppression and the
    // send paths silently text someone who asked not to be texted.
    const linkedCustomerId = await logHDCustomer({
      userId:        user.id,
      customerName:  customerName,
      customerPhone: customerPhone,
      customerEmail: customerEmail,
      companyName:   null,
    })

    const { data: newInv, error: invErr } = await supabase
      .from('hd_invoices')
      .insert({
        user_id:           user.id,
        customer_id:       linkedCustomerId,
        invoice_number:    invoiceNumber,
        // Fleet Pro linkage — fleetAccountId is already resolved from the unit above.
        unit_id:           body.unit_id,
        fleet_account_id:  fleetAccountId,
        customer_name:     customerName || 'Fleet Customer',
        customer_phone:    customerPhone,
        customer_email:    customerEmail,
        unit_manufacturer: body.unit_make   ?? null,
        unit_model:        body.unit_model  ?? null,
        unit_serial:       body.unit_serial ?? null,
        line_items:        [laborLine],
        labor_rate:        laborRate,
        subtotal_labor:    amount,
        subtotal_parts:    0,
        total:             amount,
        status:            'unpaid',
        notes:             `Auto-created from ${EQUIPMENT_TYPE_LABEL[body.equipment_type]} inspection on ${new Date().toISOString().slice(0, 10)}`,
      })
      .select('id')
      .single()

    if (invErr) { console.error('[equipment-inspections] invoice create failed', invErr); invoiceError = invErr.message }
    else linkedInvoiceId = newInv?.id ?? null
  }

  const now = new Date().toISOString()
  const { data: inserted, error } = await supabase
    .from('hd_equipment_inspections')
    .insert({
      user_id:               user.id,
      fleet_account_id:      fleetAccountId,
      unit_id:               body.unit_id,
      work_order_id:         body.work_order_id,
      invoice_id:            linkedInvoiceId ?? body.invoice_id ?? null,
      equipment_type:        body.equipment_type,
      inspection_date:       body.inspection_date,
      shift:                 body.shift,
      operator_name:         body.operator_name,
      operator_cert_current: body.operator_cert_current,
      unit_identifier:       body.unit_identifier,
      unit_make:             body.unit_make,
      unit_model:            body.unit_model,
      unit_serial:           body.unit_serial,
      hour_meter:            body.hour_meter,
      last_frequent_date:    body.last_frequent_date,
      last_annual_date:      body.last_annual_date,
      load_test_performed:   def.requiresLoadTest ? !!body.load_test_performed : false,
      load_test_date:        def.requiresLoadTest ? body.load_test_date  : null,
      load_test_notes:       def.requiresLoadTest ? body.load_test_notes : null,
      inspection_data:       data,
      deficiencies,
      overall_result:        result,
      removed_from_service:  critical ? true : !!body.removed_from_service,
      inspector_name:        body.inspector_name.trim(),
      inspector_cert_number: body.inspector_cert_number?.trim() || null,
      signature_data:        body.signature_data,
      // Locked on creation: these are signed documents, not drafts.
      locked:                true,
      locked_at:             now,
      inspection_id:         makeInspectionId(body.equipment_type),
    })
    .select('id, inspection_id')
    .single()

  if (error) {
    console.error('[equipment-inspections] insert failed:', error.message)
    return NextResponse.json({ error: 'Failed to save inspection.' }, { status: 500 })
  }

  // invoice_error is surfaced rather than thrown: the inspection is a signed
  // compliance record and must survive a billing failure.
  return NextResponse.json({
    id:            inserted.id,
    inspection_id: inserted.inspection_id,
    invoice_id:    linkedInvoiceId,
    invoice_error: invoiceError,
  })
}
