import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface MappedRow {
  customer_first_name?: string
  customer_last_name?: string
  customer_full_name?: string
  customer_phone?: string
  customer_email?: string
  vehicle_year?: string
  vehicle_make?: string
  vehicle_model?: string
  vehicle_vin?: string
  job_date?: string
  job_service_type?: string
  job_notes?: string
}

function splitFullName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0], last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

function normalizePhone(p: string) {
  return p.replace(/\D/g, '').slice(-10)
}

function parseDate(raw: string): string | null {
  if (!raw?.trim()) return null
  // Try ISO format first
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim()
  // Try common formats: MM/DD/YYYY, M/D/YYYY, DD-MM-YYYY
  const d = new Date(raw)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return null
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uid = user.id
  const { rows }: { rows: MappedRow[] } = await req.json()

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 })
  }

  let customersImported = 0
  let vehiclesImported  = 0
  let jobsImported      = 0
  const errors: string[] = []

  // Cache to avoid duplicate lookups within this import batch
  const customerCache: Record<string, string> = {}  // phone|email → customer_id
  const vehicleCache:  Record<string, string> = {}  // customer_id:vin → vehicle_id

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    // ── 1. Resolve customer ─────────────────────────────────────────────────
    let customerId: string | null = null

    let firstName = row.customer_first_name?.trim() ?? ''
    let lastName  = row.customer_last_name?.trim()  ?? ''
    if (!firstName && row.customer_full_name?.trim()) {
      const split = splitFullName(row.customer_full_name)
      firstName   = split.first
      lastName    = split.last
    }

    const phone = row.customer_phone?.trim() ?? ''
    const email = row.customer_email?.trim() ?? ''

    if (firstName) {
      const cacheKey = [normalizePhone(phone), email.toLowerCase()].filter(Boolean).join('|')

      if (cacheKey && customerCache[cacheKey]) {
        customerId = customerCache[cacheKey]
      } else {
        // Try to find existing customer
        let existing: { id: string } | null = null

        if (phone) {
          const normalized = normalizePhone(phone)
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('user_id', uid)
            .ilike('phone', `%${normalized}%`)
            .limit(1)
            .maybeSingle()
          existing = data
        }

        if (!existing && email) {
          const { data } = await supabase
            .from('customers')
            .select('id')
            .eq('user_id', uid)
            .ilike('email', email)
            .limit(1)
            .maybeSingle()
          existing = data
        }

        if (existing) {
          customerId = existing.id
        } else {
          const { data, error } = await supabase
            .from('customers')
            .insert({ user_id: uid, first_name: firstName, last_name: lastName || 'Unknown', phone: phone || null, email: email || null })
            .select('id')
            .single()
          if (error) {
            errors.push(`Row ${i + 1}: customer insert failed — ${error.message}`)
          } else {
            customerId = data.id
            customersImported++
          }
        }

        if (customerId && cacheKey) customerCache[cacheKey] = customerId
      }
    }

    // ── 2. Resolve vehicle ──────────────────────────────────────────────────
    let vehicleId: string | null = null

    const vYear  = row.vehicle_year?.trim() ?? ''
    const vMake  = row.vehicle_make?.trim() ?? ''
    const vModel = row.vehicle_model?.trim() ?? ''
    const vVin   = row.vehicle_vin?.trim()  ?? ''

    if (customerId && (vMake || vModel || vVin)) {
      const vcKey = `${customerId}:${vVin || `${vYear}${vMake}${vModel}`}`

      if (vehicleCache[vcKey]) {
        vehicleId = vehicleCache[vcKey]
      } else {
        let existing: { id: string } | null = null

        if (vVin) {
          const { data } = await supabase
            .from('vehicles')
            .select('id')
            .eq('customer_id', customerId)
            .ilike('vin', vVin)
            .limit(1)
            .maybeSingle()
          existing = data
        }

        if (!existing && vMake && vModel) {
          const q = supabase
            .from('vehicles')
            .select('id')
            .eq('customer_id', customerId)
            .ilike('make', vMake)
            .ilike('model', vModel)
          if (vYear) q.eq('year', parseInt(vYear) || 0)
          const { data } = await q.limit(1).maybeSingle()
          existing = data
        }

        if (existing) {
          vehicleId = existing.id
        } else {
          const year = parseInt(vYear) || null
          const { data, error } = await supabase
            .from('vehicles')
            .insert({ customer_id: customerId, year, make: vMake || 'Unknown', model: vModel || 'Unknown', vin: vVin || null })
            .select('id')
            .single()
          if (error) {
            errors.push(`Row ${i + 1}: vehicle insert failed — ${error.message}`)
          } else {
            vehicleId = data.id
            vehiclesImported++
          }
        }

        vehicleCache[vcKey] = vehicleId ?? ''
      }
    }

    // ── 3. Create job ───────────────────────────────────────────────────────
    const service = row.job_service_type?.trim() ?? ''
    const rawDate = row.job_date?.trim() ?? ''
    const jobDate = parseDate(rawDate) ?? new Date().toISOString().slice(0, 10)

    if (service || customerId) {
      const { error } = await supabase.from('jobs').insert({
        user_id:      uid,
        customer_id:  customerId,
        vehicle_id:   vehicleId,
        job_date:     jobDate,
        service_type: service || 'Imported service',
        status:       'completed',
        notes:        row.job_notes?.trim() || null,
      })
      if (error) {
        errors.push(`Row ${i + 1}: job insert failed — ${error.message}`)
      } else {
        jobsImported++
      }
    }
  }

  return NextResponse.json({ customersImported, vehiclesImported, jobsImported, errors: errors.slice(0, 10) })
}
