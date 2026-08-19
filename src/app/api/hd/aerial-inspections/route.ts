import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AERIAL_FORMS, AERIAL_TYPE_LABEL } from '@/lib/hd/aerial/forms'
import {
  collectDeficiencies, hasCriticalDeficiency, overallResult, unansweredCount,
  type AerialInspectionData, type AerialInspectionType,
} from '@/types/aerial'

// ─── POST /api/hd/aerial-inspections ─────────────────────────────────────────
// Creates a signed, locked ANSI A92 aerial inspection record.
//
// Everything the client sends about the *result* is recomputed here from the
// raw item data. A compliance record that says "pass" has to mean the items say
// pass — a client that posts overall_result:'pass' alongside a failed
// safety-critical item must not be able to write that, whether through a bug or
// a crafted request.

interface Body {
  inspection_type:  AerialInspectionType
  unit_id:          string | null
  work_order_id:    string | null
  /** Invoice this inspection was billed on (migration 103), so it can appear in
   *  that invoice's Attached Reports the way a DOT inspection does. */
  invoice_id:       string | null
  /** 'existing' uses invoice_id, 'create' bills a new invoice for this inspection,
   *  'none' (or absent) leaves the record standalone. Mirrors the DOT flow. */
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
  inspection_data:  AerialInspectionData
  removed_from_service: boolean
  inspector_name:   string | null
  inspector_cert_number: string | null
  signature_data:   string | null
}

/** Human-readable reference, matching the DOT inspection_id convention. */
function makeInspectionId(type: AerialInspectionType): string {
  const prefix = type === 'pre_use' ? 'APU' : type === 'frequent' ? 'AFQ' : 'AAN'
  const stamp  = new Date().toISOString().slice(2, 10).replace(/-/g, '')
  const rand   = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `${prefix}-${stamp}-${rand}`
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Body
  try { body = await request.json() as Body } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const def = AERIAL_FORMS[body.inspection_type]
  if (!def) return NextResponse.json({ error: 'Unknown inspection type.' }, { status: 400 })

  const data = body.inspection_data
  if (!data?.sections) return NextResponse.json({ error: 'Missing inspection data.' }, { status: 400 })

  // Re-validate completeness server-side. The form blocks submission, but the
  // form is not the authority on whether the document is complete.
  const missing = unansweredCount(def, data)
  if (missing > 0) {
    return NextResponse.json({ error: `${missing} item(s) unanswered.` }, { status: 400 })
  }
  if (!body.inspector_name?.trim()) {
    return NextResponse.json({ error: 'Inspector name is required.' }, { status: 400 })
  }
  if (!body.signature_data) {
    return NextResponse.json({ error: 'Signature is required.' }, { status: 400 })
  }
  // ANSI A92.20 — the annual must be performed by a qualified person.
  if (def.requiresInspectorCert && !body.inspector_cert_number?.trim()) {
    return NextResponse.json({ error: 'Inspector certification number is required for an annual inspection.' }, { status: 400 })
  }

  const deficiencies = collectDeficiencies(def, data)
  const result       = overallResult(deficiencies)
  const critical     = hasCriticalDeficiency(deficiencies)

  // OSHA 1926.453: a machine with a critical defect may not be operated. The
  // record must not be able to claim otherwise.
  if (critical && !body.removed_from_service) {
    return NextResponse.json(
      { error: 'A safety-critical item failed — removal from service must be confirmed.' },
      { status: 400 },
    )
  }

  // ── Resolve the invoice link: existing / create-new / standalone ──
  // Mirrors the DOT flow (083). Unlike DOT, the aerial form carries no customer
  // fields, so a new invoice takes its billing identity from the selected unit's
  // fleet account — the only customer context an aerial inspection actually has.
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
    // The three cadences are very different jobs: a pre-use walkaround is minutes,
    // the annual is a teardown-level inspection. Billing them all at the DOT annual's
    // 2.0 hours would overcharge two of the three.
    const hours  = body.inspection_type === 'pre_use' ? 0.5 : body.inspection_type === 'frequent' ? 1.0 : 2.0
    const amount = Math.round(hours * laborRate * 100) / 100

    const laborLine = {
      id: crypto.randomUUID(), type: 'labor',
      description: `ANSI A92 Aerial Inspection — ${AERIAL_TYPE_LABEL[body.inspection_type] ?? ''}`.trim(),
      book_hours: hours, mobile_hours: hours,
      part_number: '', quantity: 0, unit_cost: 0, amount,
    }

    const { data: newInv, error: invErr } = await supabase
      .from('hd_invoices')
      .insert({
        user_id:           user.id,
        invoice_number:    invoiceNumber,
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
        notes:             `Auto-created from aerial inspection on ${new Date().toISOString().slice(0, 10)}`,
      })
      .select('id')
      .single()

    if (invErr) { console.error('[aerial-inspections] invoice create failed', invErr); invoiceError = invErr.message }
    else linkedInvoiceId = newInv?.id ?? null
  }

  const now = new Date().toISOString()
  const { data: inserted, error } = await supabase
    .from('hd_aerial_inspections')
    .insert({
      user_id:               user.id,
      fleet_account_id:      fleetAccountId,
      unit_id:               body.unit_id,
      work_order_id:         body.work_order_id,
      invoice_id:            linkedInvoiceId ?? body.invoice_id ?? null,
      inspection_type:       body.inspection_type,
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
      inspection_id:         makeInspectionId(body.inspection_type),
    })
    .select('id, inspection_id')
    .single()

  if (error) {
    console.error('[aerial-inspections] insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // invoice_error is surfaced rather than thrown: the inspection is a signed
  // compliance record and must survive a billing failure.
  return NextResponse.json({
    id:             inserted.id,
    inspection_id:  inserted.inspection_id,
    invoice_id:     linkedInvoiceId,
    invoice_error:  invoiceError,
  })
}
