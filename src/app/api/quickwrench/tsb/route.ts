import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface ComplaintGroup {
  component:     string
  count:         number
  complaints:    ComplaintDetail[]
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

  try {
    const makeUpper  = make.toUpperCase()
    const modelUpper = model.toUpperCase()
    console.log('[complaints] querying NHTSA:', { make: makeUpper, model: modelUpper, year })
    const url = `https://api.nhtsa.gov/complaints/complaintsByVehicle?make=${encodeURIComponent(makeUpper)}&model=${encodeURIComponent(modelUpper)}&modelYear=${encodeURIComponent(year)}`
    const res  = await fetch(url, { next: { revalidate: 3600 } })

    console.log('[complaints] NHTSA response status:', res.status)

    // NHTSA returns 404 when no complaints exist for a vehicle — treat as empty, not an error
    if (res.status === 404) {
      console.log('[complaints] 404 = no complaints on record')
      return NextResponse.json({ groups: [], total: 0 })
    }

    if (!res.ok) {
      const body = await res.text()
      console.error('[complaints] NHTSA error body:', body)
      return NextResponse.json({ error: `NHTSA API error: ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    console.log('[complaints] NHTSA count:', data.Count ?? data.count ?? '?')
    // Count 0 with 200 = valid empty response
    const raw  = (data.results ?? data.Results ?? []) as any[]

    // Group complaints by component, sorted by count descending
    const map = new Map<string, { count: number; complaints: ComplaintDetail[] }>()
    for (const r of raw) {
      const component = (r.components ?? r.component ?? 'Unknown Component').toString().trim()
      const existing  = map.get(component) ?? { count: 0, complaints: [] }
      existing.count++
      existing.complaints.push({
        dateOfIncident: r.dateOfIncident ?? r.incidentDate ?? '',
        summary:        r.summary ?? r.description ?? '',
        crash:          !!r.crash,
        fire:           !!r.fire,
      })
      map.set(component, existing)
    }

    const groups: ComplaintGroup[] = Array.from(map.entries())
      .map(([component, data]) => ({ component, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15) // top 15 components

    return NextResponse.json({ groups, total: raw.length })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch complaints: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }
}
