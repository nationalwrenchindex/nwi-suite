import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface TSBResult {
  nhtsa_id:   string
  oem_id:     string
  subject:    string
  component:  string
  dateAdded:  string
  summary:    string
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
    const url = `https://api.nhtsa.gov/tsbs/tsbsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`
    const res  = await fetch(url, { next: { revalidate: 3600 } })

    if (!res.ok) {
      return NextResponse.json({ error: `NHTSA API error: ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    const raw  = (data.results ?? []) as any[]

    const tsbs: TSBResult[] = raw.map(r => ({
      nhtsa_id:  r.nhtsa_id   ?? '',
      oem_id:    r.oem_id     ?? r.TSBNumber ?? '',
      subject:   r.subject    ?? r.Subject   ?? '',
      component: r.component  ?? '',
      dateAdded: r.dateAdded  ?? r.DateAdded ?? '',
      summary:   r.summary    ?? r.Summary   ?? '',
    }))

    return NextResponse.json({ tsbs, count: tsbs.length })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch TSBs: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }
}
