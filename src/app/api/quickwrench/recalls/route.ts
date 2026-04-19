import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface RecallResult {
  campaignNumber: string
  component:      string
  summary:        string
  consequence:    string
  remedy:         string
  reportDate:     string
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
    const url = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`
    const res  = await fetch(url, { next: { revalidate: 3600 } })

    if (!res.ok) {
      return NextResponse.json({ error: `NHTSA API error: ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    const raw  = (data.results ?? []) as any[]

    const recalls: RecallResult[] = raw.map(r => ({
      campaignNumber: r.NHTSACampaignNumber ?? '',
      component:      r.Component ?? '',
      summary:        r.Summary ?? '',
      consequence:    r.Consequence ?? '',
      remedy:         r.Remedy ?? '',
      reportDate:     r.ReportReceivedDate
        ? new Date(parseInt(r.ReportReceivedDate.replace(/\/Date\((\d+)\)\//, '$1'), 10)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '',
    }))

    return NextResponse.json({ recalls, count: recalls.length })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch recalls: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    )
  }
}
