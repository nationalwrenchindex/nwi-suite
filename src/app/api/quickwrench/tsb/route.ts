import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface ComplaintGroup {
  component:  string
  count:      number
  complaints: ComplaintDetail[]
}

export interface ComplaintDetail {
  dateOfIncident: string
  summary:        string
  crash:          boolean
  fire:           boolean
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const make  = searchParams.get('make')?.trim()
  const model = searchParams.get('model')?.trim()
  const year  = searchParams.get('year')?.trim()

  if (!make || !model || !year) {
    return NextResponse.json({ error: 'make, model, and year are required' }, { status: 400 })
  }

  // Top-level catch — never surface a 5xx to the client
  try {
    const makeUpper     = make.toUpperCase()
    const modelUpper    = model.toUpperCase()
    const modelNoSpaces = modelUpper.replace(/\s+/g, '')

    async function attemptFetch(modelVariant: string) {
      const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(makeUpper)}&model=${encodeURIComponent(modelVariant)}&modelYear=${encodeURIComponent(year!)}`
      console.log('[complaints] fetching:', url)
      const res  = await fetch(url, { cache: 'no-store' })
      console.log('[complaints] status:', res.status, 'model:', modelVariant)

      const bodyText = await res.text()
      let parsed: any = null
      try { parsed = JSON.parse(bodyText) } catch { /* non-JSON response */ }

      return { res, parsed }
    }

    function isEmptyResult(parsed: any): boolean {
      if (!parsed) return false
      if (parsed.count === 0) return true
      if (parsed.Count === 0) return true
      if (typeof parsed.message === 'string' && parsed.message.toLowerCase().includes('results returned')) return true
      if (typeof parsed.Message === 'string' && parsed.Message.toLowerCase().includes('results returned')) return true
      if (!parsed.results && !parsed.Results) return true
      const results = parsed.results ?? parsed.Results ?? []
      return results.length === 0
    }

    let { res, parsed } = await attemptFetch(modelUpper)

    // Retry with spaces stripped on 400 or 404
    if ((res.status === 400 || res.status === 404) && modelNoSpaces !== modelUpper) {
      ;({ res, parsed } = await attemptFetch(modelNoSpaces))
    }

    // Empty result check — NHTSA returns 400/404 with count:0 for vehicles with no complaints
    if (isEmptyResult(parsed)) {
      console.log('[complaints] final result: no_complaints total: 0')
      return NextResponse.json({ groups: [], total: 0, status: 'no_complaints' })
    }

    // Non-200 with no recognisable empty payload
    if (!res.ok) {
      console.error('[complaints] unhandled NHTSA error, status:', res.status)
      console.log('[complaints] final result: unavailable total: 0')
      return NextResponse.json({ groups: [], total: 0, status: 'unavailable' })
    }

    // Process complaints into groups
    const raw = (parsed?.results ?? parsed?.Results ?? []) as any[]
    const map = new Map<string, { count: number; complaints: ComplaintDetail[] }>()

    for (const r of raw) {
      const component = (r.components ?? r.component ?? 'Unknown Component').toString().trim()
      const entry     = map.get(component) ?? { count: 0, complaints: [] }
      entry.count++
      entry.complaints.push({
        dateOfIncident: r.dateOfIncident ?? r.incidentDate ?? '',
        summary:        r.summary ?? r.description ?? '',
        crash:          !!r.crash,
        fire:           !!r.fire,
      })
      map.set(component, entry)
    }

    const groups: ComplaintGroup[] = Array.from(map.entries())
      .map(([component, d]) => ({ component, ...d }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)

    const total = raw.length
    console.log('[complaints] final result: found total:', total)
    return NextResponse.json({ groups, total, status: 'found' })

  } catch (err) {
    console.error('[complaints] unexpected error:', err)
    return NextResponse.json({ groups: [], total: 0, status: 'unavailable' })
  }
}
