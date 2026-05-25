import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

function normalize(name: string) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}

function parseAmount(s: string | undefined): number | null {
  if (!s?.trim()) return null
  const n = parseFloat(s.replace(/[$,\s]/g, ''))
  return isNaN(n) ? null : n
}

function parseDate(s: string | undefined): string | null {
  if (!s?.trim()) return null
  const v = s.trim()
  const m1 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) return `${m1[3]}-${m1[1].padStart(2, '0')}-${m1[2].padStart(2, '0')}`
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  const m2 = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  const m3 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m3) {
    const yr = parseInt(m3[3]) < 50 ? `20${m3[3]}` : `19${m3[3]}`
    return `${yr}-${m3[1].padStart(2, '0')}-${m3[2].padStart(2, '0')}`
  }
  return null
}

function mapStatus(s: string | undefined): string {
  const v = (s ?? '').toLowerCase().trim()
  if (v === 'completed') return 'completed'
  if (['invoiced', 'closed', 'paid', 'finalized'].some(k => v.includes(k))) return 'invoiced'
  if (['in progress', 'in-progress', 'inprogress', 'active', 'open wo'].some(k => v.includes(k))) return 'in_progress'
  return 'open'
}

// Flexible column lookup — handles minor header variations
function col(row: Record<string, string | undefined>, ...keys: string[]): string {
  for (const k of keys) {
    const found = Object.entries(row).find(
      ([h]) => h.toLowerCase().trim() === k.toLowerCase().trim()
    )?.[1]
    if (found !== undefined) return found.trim()
  }
  return ''
}

type FullbayRow = Record<string, string | undefined>

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rows: FullbayRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { rows } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  }

  // Load existing state
  const [{ data: existingFleets }, { data: existingUnits }, { data: existingWOs }] = await Promise.all([
    supabase.from('hd_fleet_accounts').select('id, fleet_name').eq('user_id', user.id),
    supabase.from('hd_units').select('id, unit_number, fleet_account_id').eq('user_id', user.id),
    supabase.from('hd_work_orders').select('work_order_number').eq('user_id', user.id).not('work_order_number', 'is', null),
  ])

  const fleetMap = new Map<string, string>()
  for (const f of existingFleets ?? []) fleetMap.set(normalize(f.fleet_name), f.id)

  // Unit key: normalized(fleet_id + "_" + unit_number)
  const unitMap = new Map<string, string>()
  for (const u of existingUnits ?? []) {
    const key = `${u.fleet_account_id ?? 'none'}_${normalize(u.unit_number)}`
    unitMap.set(key, u.id)
  }

  const existingWONums = new Set((existingWOs ?? []).map(w => w.work_order_number))

  // --- Pass 1: collect unique new fleet accounts ---
  const newClientKeys   = new Set<string>()
  const matchedClientKeys = new Set<string>()
  const newFleetInserts: { user_id: string; fleet_name: string }[] = []

  for (const row of rows) {
    const customer = col(row, 'Customer Name', 'Customer', 'Fleet', 'Client')
    if (!customer) continue
    const key = normalize(customer)
    if (fleetMap.has(key)) {
      matchedClientKeys.add(key)
    } else if (!newClientKeys.has(key)) {
      newClientKeys.add(key)
      newFleetInserts.push({ user_id: user.id, fleet_name: customer })
    }
  }

  if (newFleetInserts.length > 0) {
    const { data: created } = await supabase
      .from('hd_fleet_accounts')
      .insert(newFleetInserts)
      .select('id, fleet_name')
    for (const f of created ?? []) fleetMap.set(normalize(f.fleet_name), f.id)
  }

  // --- Pass 2: collect unique new units ---
  const newUnitKeys   = new Set<string>()
  const newUnitInserts: Record<string, unknown>[] = []

  for (const row of rows) {
    const customer   = col(row, 'Customer Name', 'Customer', 'Fleet', 'Client')
    const unitNumber = col(row, 'Unit Number', 'Unit #', 'Unit No', 'Unit')
    if (!unitNumber) continue

    const fleetId = customer ? (fleetMap.get(normalize(customer)) ?? null) : null
    const unitKey = `${fleetId ?? 'none'}_${normalize(unitNumber)}`

    if (!unitMap.has(unitKey) && !newUnitKeys.has(unitKey)) {
      newUnitKeys.add(unitKey)

      const year  = parseInt(col(row, 'Year')) || null
      const hours = parseAmount(col(row, 'Engine Hours', 'Hours'))

      newUnitInserts.push({
        user_id:         user.id,
        fleet_account_id: fleetId,
        unit_number:     unitNumber,
        manufacturer:    col(row, 'Make', 'Manufacturer', 'Brand') || 'Unknown',
        model:           col(row, 'Model')                         || 'Unknown',
        year,
        serial_number:   col(row, 'VIN', 'Serial Number', 'Serial') || null,
        engine_hours:    hours,
        total_hours:     hours,
        unit_type:       'trailer',
      })
    }
  }

  if (newUnitInserts.length > 0) {
    const { data: created } = await supabase
      .from('hd_units')
      .insert(newUnitInserts)
      .select('id, unit_number, fleet_account_id')
    for (const u of created ?? []) {
      const key = `${u.fleet_account_id ?? 'none'}_${normalize(u.unit_number)}`
      unitMap.set(key, u.id)
    }
  }

  // --- Pass 3: create work orders ---
  const importedWONums = new Set<string>()
  const woInserts: Record<string, unknown>[] = []
  let wosSkipped  = 0
  let totalRevenue = 0
  const dates: string[] = []

  for (const row of rows) {
    const woNum      = col(row, 'Work Order Number', 'Work Order #', 'WO Number', 'WO#', 'Work Order')
    const customer   = col(row, 'Customer Name', 'Customer', 'Fleet', 'Client')
    const unitNumber = col(row, 'Unit Number', 'Unit #', 'Unit No', 'Unit')

    if (woNum && (existingWONums.has(woNum) || importedWONums.has(woNum))) {
      wosSkipped++
      continue
    }
    if (woNum) importedWONums.add(woNum)

    const fleetId = customer ? (fleetMap.get(normalize(customer)) ?? null) : null
    const unitKey = unitNumber ? `${fleetId ?? 'none'}_${normalize(unitNumber)}` : null
    const unitId  = unitKey ? (unitMap.get(unitKey) ?? null) : null

    const total       = parseAmount(col(row, 'Total', 'Grand Total', 'Invoice Total'))
    const laborTotal  = parseAmount(col(row, 'Labor Total', 'Labor'))
    const partsTotal  = parseAmount(col(row, 'Parts Total', 'Parts'))
    const tax         = parseAmount(col(row, 'Tax'))
    const amountPaid  = parseAmount(col(row, 'Amount Paid', 'Paid', 'Payment'))
    const balanceDue  = parseAmount(col(row, 'Balance Due', 'Balance', 'Owed'))
    const serviceDate = parseDate(col(row, 'Service Date', 'Date', 'Start Date', 'Work Date'))
    const completedDate = parseDate(col(row, 'Completed Date', 'Completion Date', 'End Date'))
    const status      = mapStatus(col(row, 'Status'))
    const tech        = col(row, 'Technician', 'Tech', 'Tech Name', 'Assigned To')
    const serviceDesc = col(row, 'Service Description', 'Description', 'Services', 'Work Done')
    const internalNotes = col(row, 'Internal Notes', 'Notes', 'Comments')

    if (total && total > 0) totalRevenue += total
    if (serviceDate) dates.push(serviceDate)

    const comments = [
      serviceDesc && `Service: ${serviceDesc}`,
      internalNotes && `Notes: ${internalNotes}`,
      'Imported from Fullbay',
    ].filter(Boolean).join('\n')

    woInserts.push({
      user_id:           user.id,
      fleet_account_id:  fleetId,
      unit_id:           unitId,
      work_order_number: woNum || null,
      service_type:      'Fullbay Import',
      status,
      tech_name:         tech || null,
      total_amount:      total,
      service_requests:  serviceDesc || null,
      comments:          comments || 'Imported from Fullbay',
      started_at:        serviceDate   ? `${serviceDate}T00:00:00Z`   : null,
      completed_at:      completedDate ? `${completedDate}T00:00:00Z` : null,
      flagged_items: {
        import: {
          source:       'fullbay',
          labor_total:  laborTotal,
          parts_total:  partsTotal,
          tax,
          amount_paid:  amountPaid,
          balance_due:  balanceDue,
        },
      },
    })
  }

  if (woInserts.length > 0) {
    const { error } = await supabase.from('hd_work_orders').insert(woInserts)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const sortedDates = dates.sort()
  return NextResponse.json({
    fleet_accounts_created: newClientKeys.size,
    fleet_accounts_matched: matchedClientKeys.size,
    units_created:          newUnitKeys.size,
    work_orders_imported:   woInserts.length,
    work_orders_skipped:    wosSkipped,
    total_revenue:          Math.round(totalRevenue * 100) / 100,
    date_range: sortedDates.length > 0
      ? { min: sortedDates[0], max: sortedDates[sortedDates.length - 1] }
      : null,
  })
}
