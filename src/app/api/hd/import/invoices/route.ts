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
  // MM/DD/YYYY
  const m1 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) return `${m1[3]}-${m1[1].padStart(2, '0')}-${m1[2].padStart(2, '0')}`
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10)
  // MM-DD-YYYY
  const m2 = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
  if (m2) return `${m2[3]}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
  // M/D/YY
  const m3 = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/)
  if (m3) {
    const yr = parseInt(m3[3]) < 50 ? `20${m3[3]}` : `19${m3[3]}`
    return `${yr}-${m3[1].padStart(2, '0')}-${m3[2].padStart(2, '0')}`
  }
  return null
}

type InvoiceRow = Record<string, string | undefined>

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { rows: InvoiceRow[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const { rows } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  }

  // Load existing state
  const [{ data: existingFleets }, { data: existingWOs }] = await Promise.all([
    supabase.from('hd_fleet_accounts').select('id, fleet_name').eq('user_id', user.id),
    supabase.from('hd_work_orders').select('work_order_number').eq('user_id', user.id).not('work_order_number', 'is', null),
  ])

  const fleetMap = new Map<string, string>()
  for (const f of existingFleets ?? []) fleetMap.set(normalize(f.fleet_name), f.id)
  const existingWONums = new Set((existingWOs ?? []).map(w => w.work_order_number))

  // Collect unique client names and categorize as new vs matched
  const newClientKeys   = new Set<string>()
  const matchedClientKeys = new Set<string>()
  const newFleetInserts: { user_id: string; fleet_name: string }[] = []

  for (const row of rows) {
    const client = row['CLIENT']?.trim()
    if (!client) continue
    const key = normalize(client)
    if (fleetMap.has(key)) {
      matchedClientKeys.add(key)
    } else if (!newClientKeys.has(key)) {
      newClientKeys.add(key)
      newFleetInserts.push({ user_id: user.id, fleet_name: client })
    }
  }

  // Batch-insert new fleet accounts
  if (newFleetInserts.length > 0) {
    const { data: created } = await supabase
      .from('hd_fleet_accounts')
      .insert(newFleetInserts)
      .select('id, fleet_name')
    for (const f of created ?? []) fleetMap.set(normalize(f.fleet_name), f.id)
  }

  // Build work order inserts, tracking per-import duplicates
  const importedWONums = new Set<string>()
  const woInserts: Record<string, unknown>[] = []
  let wosSkipped = 0
  let totalRevenue = 0
  const dates: string[] = []

  for (const row of rows) {
    const client = row['CLIENT']?.trim()
    if (!client) continue

    const invNo = row['INV NO']?.trim() || null
    if (invNo && (existingWONums.has(invNo) || importedWONums.has(invNo))) {
      wosSkipped++
      continue
    }
    if (invNo) importedWONums.add(invNo)

    const total   = parseAmount(row['TOTAL'])
    const paid    = parseAmount(row['PAID'])
    const invDate = parseDate(row['INV DATE'])
    const fleetId = fleetMap.get(normalize(client)) ?? null

    const status = (paid !== null && total !== null && total > 0 && Math.abs(paid - total) < 0.01)
      ? 'invoiced'
      : 'open'

    if (total && total > 0) totalRevenue += total
    if (invDate) dates.push(invDate)

    woInserts.push({
      user_id:           user.id,
      fleet_account_id:  fleetId,
      work_order_number: invNo,
      service_type:      'Imported Invoice',
      status,
      total_amount:      total,
      started_at:        invDate ? `${invDate}T00:00:00Z` : null,
      completed_at:      ['invoiced', 'completed'].includes(status) ? (invDate ? `${invDate}T00:00:00Z` : null) : null,
      comments:          'Imported from invoice history',
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
    work_orders_imported:   woInserts.length,
    work_orders_skipped:    wosSkipped,
    total_revenue:          Math.round(totalRevenue * 100) / 100,
    date_range: sortedDates.length > 0
      ? { min: sortedDates[0], max: sortedDates[sortedDates.length - 1] }
      : null,
  })
}
